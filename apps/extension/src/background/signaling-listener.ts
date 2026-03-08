import {
  SignalingChannel,
  createRtcConfiguration,
  createPrivacyRtcConfiguration,
  shouldFilterCandidate,
  logger,
  makeNip44Fns,
  type PrivacySettingsPayload,
  type RelayPool,
  type SignalingMessage,
  type SignEventFn
} from "@entropy/core";

export interface SignalingListenerOptions {
  canServeRoot?: (rootHash: string) => boolean | Promise<boolean>;
  signEvent?: SignEventFn;
  privkey?: string;
  privacySettings?: PrivacySettingsPayload;
}

function toConnectionKey(signal: Pick<SignalingMessage, "senderPubkey" | "rootHash">): string {
  return `${signal.senderPubkey}:${signal.rootHash}`;
}

function isSessionDescriptionPayload(payload: unknown): payload is RTCSessionDescriptionInit {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Partial<RTCSessionDescriptionInit>;
  return typeof candidate.type === "string";
}

function isIceCandidatePayload(payload: unknown): payload is RTCIceCandidateInit {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Partial<RTCIceCandidateInit>;
  return typeof candidate.candidate === "string";
}

/** Extract the ice-ufrag from an SDP string. */
function extractUfrag(sdp: string | undefined): string | null {
  if (!sdp) return null;
  const m = sdp.match(/a=ice-ufrag:(\S+)/);
  return m ? m[1] : null;
}


export function startSignalingListener(
  pool: RelayPool,
  myPubkey: string,
  onPeerConnected: (pubkey: string, dataChannel: RTCDataChannel) => void,
  options: SignalingListenerOptions = {}
): () => void {
  const nip44Opts = options.privkey ? makeNip44Fns(options.privkey) : undefined;
  const channel = new SignalingChannel(pool, options.signEvent, nip44Opts
    ? { encryptFn: nip44Opts.encrypt, decryptFn: nip44Opts.decrypt }
    : undefined
  );
  const peers = new Map<string, RTCPeerConnection>();
  const offerTimestamps = new Map<string, number>();
  const OFFER_DEDUP_MS = 5_000;
  const canServeRoot = options.canServeRoot ?? (() => true);

  logger.log("[signaling-listener] started, listening for signals to", myPubkey.slice(0, 8) + "…");
  const unsubscribe = channel.onSignal(myPubkey, (signal) => {
    void (async () => {
      logger.log("[signaling-listener] signal received:", signal.type, "from:", signal.senderPubkey?.slice(0, 8) + "…", "rootHash:", signal.rootHash?.slice(0, 12) + "…");
      const canServe = await Promise.resolve(canServeRoot(signal.rootHash));
      logger.log("[signaling-listener] canServeRoot(", signal.rootHash?.slice(0, 12) + "…", "):", canServe);
      if (!canServe) {
        return;
      }

      const key = toConnectionKey(signal);

      if (signal.type === "offer") {
        if (!isSessionDescriptionPayload(signal.payload)) {
          logger.warn("[signaling-listener] invalid SDP payload in offer");
          return;
        }

        // Deduplicate offers from multiple relays
        const lastOfferAt = offerTimestamps.get(key) ?? 0;
        const now = Date.now();
        if (now - lastOfferAt < OFFER_DEDUP_MS) {
          logger.log("[signaling-listener] skipping duplicate offer from", signal.senderPubkey.slice(0, 8) + "… (processed", now - lastOfferAt, "ms ago)");
          return;
        }
        offerTimestamps.set(key, now);

        // Detect ICE restart: reuse existing peer connection if present and not closed
        const existingPeer = peers.get(key);
        const isIceRestart = existingPeer
          && existingPeer.signalingState !== "closed"
          && (existingPeer.iceConnectionState === "disconnected"
            || existingPeer.iceConnectionState === "failed"
            || existingPeer.iceConnectionState === "connected"
            || existingPeer.iceConnectionState === "completed");

        if (isIceRestart && existingPeer) {
          logger.log("[signaling-listener] ICE restart offer from", signal.senderPubkey.slice(0, 8) + "… — reusing existing RTCPeerConnection");

          await existingPeer.setRemoteDescription(signal.payload);
          const answer = await existingPeer.createAnswer();
          await existingPeer.setLocalDescription(answer);

          const localUfrag = extractUfrag(existingPeer.localDescription?.sdp);
          logger.log("[signaling-listener] ICE restart answer created, localUfrag:", localUfrag);

          channel.sendAnswer({
            targetPubkey: signal.senderPubkey,
            sdp: answer,
            rootHash: signal.rootHash,
          });

          return;
        }

        logger.log("[signaling-listener] processing offer from", signal.senderPubkey.slice(0, 8) + "…");
        existingPeer?.close();

        const rtcConfig = options.privacySettings
          ? createPrivacyRtcConfiguration(options.privacySettings)
          : createRtcConfiguration();
        const peer = new RTCPeerConnection(rtcConfig);
        peers.set(key, peer);

        peer.onicecandidate = (event) => {
          if (!event.candidate) {
            return;
          }

          // Filter local/host candidates when privacy settings require it
          if (options.privacySettings && shouldFilterCandidate(event.candidate, options.privacySettings)) {
            logger.log("[signaling-listener] filtering local ICE candidate (privacy mode)");
            return;
          }

          channel.sendIceCandidate({
            targetPubkey: signal.senderPubkey,
            candidate: event.candidate.toJSON(),
            rootHash: signal.rootHash,
          });
        };

        peer.ondatachannel = (event) => {
          const ch = event.channel;
          logger.log("[signaling-listener] ✅ ondatachannel fired from", signal.senderPubkey.slice(0, 8) + "…",
            "| label:", ch.label, "id:", ch.id, "readyState:", ch.readyState,
            "| protocol:", ch.protocol, "negotiated:", ch.negotiated);
          ch.onopen = () => logger.log("[signaling-listener] data channel OPEN, label:", ch.label, "readyState:", ch.readyState);
          ch.onerror = (e) => logger.error("[signaling-listener] data channel ERROR:", e);
          ch.onclose = () => logger.log("[signaling-listener] data channel CLOSED, label:", ch.label);
          onPeerConnected(signal.senderPubkey, ch);
        };

        peer.oniceconnectionstatechange = () => {
          logger.log("[signaling-listener] ICE state (", signal.senderPubkey.slice(0, 8) + "…):", peer.iceConnectionState);
          if (peer.iceConnectionState === "failed" || peer.iceConnectionState === "closed") {
            logger.log("[signaling-listener] ICE state terminal, cleaning up peer", signal.senderPubkey.slice(0, 8) + "…");
            peers.delete(key);
            peer.close();
          }
        };

        peer.onconnectionstatechange = () => {
          logger.log("[signaling-listener] connection state (", signal.senderPubkey.slice(0, 8) + "…):", peer.connectionState,
            "| signalingState:", peer.signalingState,
            "| iceGatheringState:", peer.iceGatheringState);
          if (peer.connectionState === "failed") {
            logger.error("[signaling-listener] CONNECTION FAILED for", signal.senderPubkey.slice(0, 8) + "… — DTLS or ICE failure");
          }
          if (peer.connectionState === "failed" || peer.connectionState === "closed") {
            logger.log("[signaling-listener] connection state terminal, cleaning up peer", signal.senderPubkey.slice(0, 8) + "…");
            peers.delete(key);
            peer.close();
          }
        };

        peer.onicecandidateerror = (event: Event) => {
          const e = event as RTCPeerConnectionIceErrorEvent;
          logger.warn("[signaling-listener] ICE candidate error:",
            "errorCode:", e.errorCode, "url:", e.url, "errorText:", e.errorText);
        };

        const remoteHasDC = (signal.payload as RTCSessionDescriptionInit).sdp?.includes("m=application") ?? false;
        logger.log("[signaling-listener] offer SDP has m=application (data channel):", remoteHasDC);
        if (!remoteHasDC) {
          logger.error("[signaling-listener] OFFER SDP MISSING m=application — data channel will NOT work!");
        }

        await peer.setRemoteDescription(signal.payload);
        const remoteUfrag = extractUfrag(peer.remoteDescription?.sdp);
        logger.log("[signaling-listener] remote description set, remoteUfrag:", remoteUfrag,
          "| signalingState:", peer.signalingState);

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        const localUfrag = extractUfrag(peer.localDescription?.sdp);
        const answerHasDC = peer.localDescription?.sdp?.includes("m=application") ?? false;
        logger.log("[signaling-listener] answer created, localUfrag:", localUfrag,
          "| answerHasDataChannel:", answerHasDC,
          "| signalingState:", peer.signalingState);
        if (!answerHasDC) {
          logger.error("[signaling-listener] ANSWER SDP MISSING m=application — data channel will NOT work!");
        }
        logger.log("[signaling-listener] sending answer to", signal.senderPubkey.slice(0, 8) + "…");

        channel.sendAnswer({
          targetPubkey: signal.senderPubkey,
          sdp: answer,
          rootHash: signal.rootHash,
        });

        return;
      }

      if (signal.type === "ice-candidate") {
        if (!isIceCandidatePayload(signal.payload)) {
          logger.warn("[signaling-listener] invalid ICE candidate payload");
          return;
        }

        const peer = peers.get(key);

        if (!peer) {
          logger.warn("[signaling-listener] no peer found for ICE candidate, key:", key.slice(0, 20));
          return;
        }

        // Filter out candidates with wrong usernameFragment (stale sessions)
        const remoteUfrag = extractUfrag(peer.remoteDescription?.sdp);
        const candidateUfrag = (signal.payload as { usernameFragment?: string }).usernameFragment;
        if (candidateUfrag && remoteUfrag && candidateUfrag !== remoteUfrag) {
          logger.warn("[signaling-listener] DROPPING ICE candidate: ufrag mismatch",
            "candidate:", candidateUfrag, "expected:", remoteUfrag);
          return;
        }

        logger.log("[signaling-listener] adding ICE candidate from", signal.senderPubkey.slice(0, 8) + "…", "ufrag:", candidateUfrag ?? "none");
        try {
          await peer.addIceCandidate(signal.payload);
        } catch (iceErr) {
          logger.warn("[signaling-listener] addIceCandidate error:", iceErr);
        }
      }
    })();
  });

  return () => {
    unsubscribe();

    for (const peer of peers.values()) {
      peer.close();
    }

    peers.clear();
  };
}
