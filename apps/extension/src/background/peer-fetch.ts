import {
  SignalingChannel,
  createRtcConfiguration,
  encodeChunkRequest,
  createChunkReceiver,
  sha256Hex,
  logger,
  type RelayPool,
  type SignEventFn,
  type ChunkRequestMessage
} from "@entropy/core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_CHANNEL_LABEL = "entropy";
const CONNECT_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 15_000;

// ICE reconnection constants
const ICE_DISCONNECT_GRACE_MS = 5_000;
const ICE_RESTART_TIMEOUT_MS = 15_000;

/** Extract the ice-ufrag from an SDP string. */
function extractUfrag(sdp: string | undefined): string | null {
  if (!sdp) return null;
  const m = sdp.match(/a=ice-ufrag:(\S+)/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PeerChunkResult {
  hash: string;
  rootHash: string;
  data: ArrayBuffer;
  peerPubkey: string;
}

// ---------------------------------------------------------------------------
// fetchChunkFromPeer — one-shot WebRTC chunk download
// ---------------------------------------------------------------------------

export interface FetchChunkParams {
  chunkHash: string;
  rootHash: string;
  gatekeeperPubkey: string;
  myPubkey: string;
  relayPool: RelayPool;
  signEvent: SignEventFn;
  isPeerBanned?: (peerPubkey: string) => boolean | Promise<boolean>;
  onPeerTransferSuccess?: (peerPubkey: string, bytes: number) => void | Promise<void>;
  onPeerFailedVerification?: (peerPubkey: string) => void | Promise<void>;
}

/**
 * Connects to a single gatekeeper peer via WebRTC signaling over Nostr,
 * requests a chunk, and returns the chunk data. Cleans up the connection
 * after the transfer completes (or fails).
 */
export async function fetchChunkFromPeer(params: FetchChunkParams): Promise<PeerChunkResult | null> {
  const {
    chunkHash,
    rootHash,
    gatekeeperPubkey,
    myPubkey,
    relayPool,
    signEvent,
    isPeerBanned,
    onPeerTransferSuccess,
    onPeerFailedVerification
  } = params;

  const banned = await Promise.resolve(isPeerBanned?.(gatekeeperPubkey) ?? false);
  if (banned) {
    logger.log("[peer-fetch] skipping banned gatekeeper", gatekeeperPubkey.slice(0, 8) + "…");
    return null;
  }

  logger.log("[peer-fetch] fetchChunkFromPeer called — chunk:", chunkHash.slice(0, 12) + "…", "root:", rootHash.slice(0, 12) + "…", "gatekeeper:", gatekeeperPubkey.slice(0, 8) + "…", "myPubkey:", myPubkey.slice(0, 8) + "…");

  const channel = new SignalingChannel(relayPool, signEvent);
  const rtcConfig = createRtcConfiguration();
  logger.log("[peer-fetch] creating RTCPeerConnection with config:", JSON.stringify(rtcConfig));
  const pc = new RTCPeerConnection(rtcConfig);
  const dc = pc.createDataChannel(DATA_CHANNEL_LABEL);
  dc.binaryType = "arraybuffer";
  logger.log("[peer-fetch] RTCPeerConnection created, signalingState:", pc.signalingState);
  logger.log("[peer-fetch] DataChannel created, label:", dc.label, "id:", dc.id, "readyState:", dc.readyState, "negotiated:", dc.negotiated);

  let cleanupSignaling: (() => void) | null = null;

  function cleanup(): void {
    cleanupSignaling?.();
    cleanupSignaling = null;
    try { dc.close(); } catch { /* ignore */ }
    try { pc.close(); } catch { /* ignore */ }
  }

  return new Promise<PeerChunkResult | null>((resolve, reject) => {
    let settled = false;
    let remoteDescriptionSet = false;
    const pendingCandidates: RTCIceCandidateInit[] = [];
    // Timestamp (Nostr seconds) when the offer is sent — used to reject stale answers from previous sessions
    let offerSentAt = Math.floor(Date.now() / 1000);

    const connectTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        logger.warn("[peer-fetch] connection timeout to", gatekeeperPubkey.slice(0, 8) + "…");
        resolve(null);
      }
    }, CONNECT_TIMEOUT_MS);

    // Listen for signaling responses (answer + ICE candidates from gatekeeper)
    logger.log("[peer-fetch] subscribing to signaling for myPubkey:", myPubkey.slice(0, 8) + "…");
    cleanupSignaling = channel.onSignal(myPubkey, (signal) => {
      logger.log("[peer-fetch] received signal:", signal.type, "from:", signal.senderPubkey?.slice(0, 8) + "…", "rootHash:", signal.rootHash?.slice(0, 12) + "…");
      if (signal.senderPubkey !== gatekeeperPubkey) {
        logger.log("[peer-fetch] ignoring signal — wrong sender (expected", gatekeeperPubkey.slice(0, 8) + "…)");
        return;
      }
      if (signal.rootHash !== rootHash) {
        logger.log("[peer-fetch] ignoring signal — wrong rootHash (expected", rootHash.slice(0, 12) + "…)");
        return;
      }

      // Reject stale signals from previous sessions still cached on relays.
      // Allow 5s tolerance for clock skew between peers.
      if (signal.createdAt < offerSentAt - 5) {
        logger.warn("[peer-fetch] REJECTING stale signal:", signal.type,
          "createdAt:", signal.createdAt, "offerSentAt:", offerSentAt,
          "(delta:", offerSentAt - signal.createdAt, "s)");
        return;
      }

      void (async () => {
        try {
          if (signal.type === "answer") {
            if (remoteDescriptionSet) {
              logger.log("[peer-fetch] ignoring duplicate answer (remote description already set)");
              return;
            }
            logger.log("[peer-fetch] setting remote description (answer)");
            const sdp = signal.payload as RTCSessionDescriptionInit;
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            remoteDescriptionSet = true;

            const remoteUfrag = extractUfrag(pc.remoteDescription?.sdp);
            const localUfrag = extractUfrag(pc.localDescription?.sdp);
            const remoteHasDC = pc.remoteDescription?.sdp?.includes("m=application") ?? false;
            logger.log("[peer-fetch] remote description set OK",
              "| localUfrag:", localUfrag,
              "| remoteUfrag:", remoteUfrag,
              "| remoteHasDataChannel:", remoteHasDC,
              "| signalingState:", pc.signalingState,
              "| flushing", pendingCandidates.length, "buffered ICE candidates");
            if (!remoteHasDC) {
              logger.error("[peer-fetch] ANSWER SDP MISSING m=application — data channel will NOT work!");
            }

            // Flush buffered ICE candidates
            for (const buffered of pendingCandidates) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(buffered));
              } catch (flushErr) {
                logger.warn("[peer-fetch] error flushing buffered ICE candidate:", flushErr);
              }
            }
            pendingCandidates.length = 0;
          } else if (signal.type === "ice-candidate") {
            const candidate = signal.payload as RTCIceCandidateInit;

            // Filter out candidates with wrong usernameFragment (stale sessions)
            const remoteUfrag = extractUfrag(pc.remoteDescription?.sdp);
            const candidateUfrag = (candidate as { usernameFragment?: string }).usernameFragment;
            if (candidateUfrag && remoteUfrag && candidateUfrag !== remoteUfrag) {
              logger.warn("[peer-fetch] DROPPING ICE candidate: ufrag mismatch",
                "candidate:", candidateUfrag, "expected:", remoteUfrag);
              return;
            }

            if (!remoteDescriptionSet) {
              logger.log("[peer-fetch] buffering ICE candidate (no remote description yet), ufrag:", candidateUfrag ?? "none");
              pendingCandidates.push(candidate);
            } else {
              logger.log("[peer-fetch] adding ICE candidate, ufrag:", candidateUfrag ?? "none");
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
              logger.log("[peer-fetch] ICE candidate added OK");
            }
          }
        } catch (err) {
          logger.warn("[peer-fetch] signaling error:", err);
        }
      })();
    });

    // Forward ICE candidates to gatekeeper
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        logger.log("[peer-fetch] sending ICE candidate to gatekeeper");
        channel.sendIceCandidate({
          targetPubkey: gatekeeperPubkey,
          candidate: event.candidate.toJSON(),
          rootHash
        });
      } else {
        logger.log("[peer-fetch] ICE gathering complete (null candidate)");
      }
    };

    // ICE reconnection state
    let iceDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let iceRestartTimer: ReturnType<typeof setTimeout> | null = null;
    let iceRestartAttempted = false;

    function cancelIceTimers(): void {
      if (iceDisconnectTimer) { clearTimeout(iceDisconnectTimer); iceDisconnectTimer = null; }
      if (iceRestartTimer) { clearTimeout(iceRestartTimer); iceRestartTimer = null; }
    }

    function attemptIceRestart(): void {
      if (iceRestartAttempted || settled || pc.signalingState === "closed") return;
      iceRestartAttempted = true;
      logger.log("[peer-fetch] attempting ICE restart for", gatekeeperPubkey.slice(0, 8) + "…");

      // Allow new remote description for the restart answer
      remoteDescriptionSet = false;
      pendingCandidates.length = 0;

      iceRestartTimer = setTimeout(() => {
        iceRestartTimer = null;
        if (!settled) {
          logger.warn("[peer-fetch] ICE restart timed out for", gatekeeperPubkey.slice(0, 8) + "…");
          settled = true;
          cleanup();
          resolve(null);
        }
      }, ICE_RESTART_TIMEOUT_MS);

      void (async () => {
        try {
          pc.restartIce();
          const restartOffer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(restartOffer);
          offerSentAt = Math.floor(Date.now() / 1000);

          logger.log("[peer-fetch] sending ICE restart offer to", gatekeeperPubkey.slice(0, 8) + "…");
          channel.sendOffer({
            targetPubkey: gatekeeperPubkey,
            sdp: restartOffer,
            rootHash
          });
        } catch (err) {
          logger.error("[peer-fetch] ICE restart failed:", err);
          cancelIceTimers();
          if (!settled) {
            settled = true;
            cleanup();
            resolve(null);
          }
        }
      })();
    }

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      logger.log("[peer-fetch] ICE connection state:", iceState);

      if (iceState === "disconnected") {
        // Start grace timer — ICE may recover on its own
        if (!iceDisconnectTimer && !settled) {
          logger.log("[peer-fetch] ICE disconnected — starting", ICE_DISCONNECT_GRACE_MS + "ms grace timer");
          iceDisconnectTimer = setTimeout(() => {
            iceDisconnectTimer = null;
            if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
              attemptIceRestart();
            }
          }, ICE_DISCONNECT_GRACE_MS);
        }
      } else if (iceState === "connected" || iceState === "completed") {
        cancelIceTimers();
        if (iceRestartAttempted) {
          logger.log("[peer-fetch] ICE restart succeeded for", gatekeeperPubkey.slice(0, 8) + "…");
          iceRestartAttempted = false;
        }
      } else if (iceState === "failed") {
        cancelIceTimers();
        attemptIceRestart();
      }
    };

    pc.onconnectionstatechange = () => {
      logger.log("[peer-fetch] connection state:", pc.connectionState,
        "| signalingState:", pc.signalingState,
        "| iceGatheringState:", pc.iceGatheringState);
      if (pc.connectionState === "failed") {
        logger.error("[peer-fetch] CONNECTION FAILED — DTLS or ICE failure");
      }
    };

    pc.onicecandidateerror = (event: Event) => {
      const e = event as RTCPeerConnectionIceErrorEvent;
      logger.warn("[peer-fetch] ICE candidate error:",
        "errorCode:", e.errorCode,
        "url:", e.url,
        "errorText:", e.errorText);
    };

    // When data channel opens, send the chunk request
    dc.onopen = () => {
      clearTimeout(connectTimeout);
      logger.log("[peer-fetch] ✅ DATA CHANNEL OPEN, label:", dc.label,
        "id:", dc.id, "readyState:", dc.readyState,
        "| pc.connectionState:", pc.connectionState,
        "| pc.iceConnectionState:", pc.iceConnectionState,
        "| requesting chunk", chunkHash.slice(0, 12) + "…");

      const request: ChunkRequestMessage = {
        type: "CHUNK_REQUEST",
        requesterPubkey: myPubkey,
        rootHash,
        chunkHash
      };

      dc.send(encodeChunkRequest(request));

      // Start request timeout
      setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          logger.warn("[peer-fetch] chunk request timeout for", chunkHash.slice(0, 12) + "…");
          resolve(null);
        }
      }, REQUEST_TIMEOUT_MS);
    };

    // Handle incoming chunk data
    const receiver = createChunkReceiver();
    dc.onmessage = (event: MessageEvent) => {
      if (settled) return;
      if (!(event.data instanceof ArrayBuffer)) return;

      try {
        const message = receiver.receive(event.data);
        if (!message) return;

        if (message.type === "CHUNK_DATA" && message.chunkHash === chunkHash) {
          void sha256Hex(new Uint8Array(message.data))
            .then((actualHash) => {
              if (settled) return;

              if (actualHash !== chunkHash) {
                logger.warn(
                  "[peer-fetch] hash mismatch from peer",
                  gatekeeperPubkey.slice(0, 8) + "…",
                  "expected:",
                  chunkHash.slice(0, 12) + "…",
                  "actual:",
                  actualHash.slice(0, 12) + "…"
                );

                void Promise.resolve(onPeerFailedVerification?.(gatekeeperPubkey)).catch((callbackErr) => {
                  logger.warn("[peer-fetch] failed to record peer verification failure:", callbackErr);
                });

                settled = true;
                clearTimeout(connectTimeout);
                cleanup();
                resolve(null);
                return;
              }

              settled = true;
              clearTimeout(connectTimeout);
              logger.log("[peer-fetch] received chunk", chunkHash.slice(0, 12) + "…", message.data.byteLength, "bytes");

              void Promise.resolve(onPeerTransferSuccess?.(gatekeeperPubkey, message.data.byteLength)).catch(
                (callbackErr) => {
                  logger.warn("[peer-fetch] failed to record peer transfer success:", callbackErr);
                }
              );

              cleanup();
              resolve({
                hash: chunkHash,
                rootHash,
                data: message.data,
                peerPubkey: gatekeeperPubkey
              });
            })
            .catch((hashErr) => {
              if (settled) return;

              logger.warn("[peer-fetch] failed to verify received chunk hash:", hashErr);

              settled = true;
              clearTimeout(connectTimeout);
              cleanup();
              resolve(null);
            });
        } else if (message.type === "CHUNK_ERROR" && message.chunkHash === chunkHash) {
          settled = true;
          clearTimeout(connectTimeout);
          logger.warn("[peer-fetch] peer returned error for chunk:", message.reason);
          cleanup();
          resolve(null);
        }
      } catch (err) {
        logger.warn("[peer-fetch] failed to decode message:", err);
      }
    };

    dc.onerror = (evt) => {
      const errEvt = evt as RTCErrorEvent;
      logger.error("[peer-fetch] data channel error:", errEvt,
        "| dc.readyState:", dc.readyState,
        "| pc.connectionState:", pc.connectionState,
        "| pc.iceConnectionState:", pc.iceConnectionState);
      if (!settled) {
        settled = true;
        clearTimeout(connectTimeout);
        cancelIceTimers();
        cleanup();
        resolve(null);
      }
    };

    dc.onclose = () => {
      logger.log("[peer-fetch] data channel closed, settled:", settled,
        "| dc.readyState:", dc.readyState,
        "| pc.connectionState:", pc.connectionState,
        "| pc.iceConnectionState:", pc.iceConnectionState);
      if (!settled) {
        settled = true;
        clearTimeout(connectTimeout);
        cancelIceTimers();
        cleanup();
        resolve(null);
      }
    };

    // Create and send the SDP offer
    void (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        offerSentAt = Math.floor(Date.now() / 1000);

        const localUfrag = extractUfrag(pc.localDescription?.sdp);
        const hasDataChannel = pc.localDescription?.sdp?.includes("m=application") ?? false;
        logger.log("[peer-fetch] local description set, localUfrag:", localUfrag,
          "| hasDataChannel(m=application):", hasDataChannel,
          "| signalingState:", pc.signalingState);
        if (!hasDataChannel) {
          logger.error("[peer-fetch] SDP MISSING m=application — data channel will NOT work!");
        }

        logger.log("[peer-fetch] sending offer to", gatekeeperPubkey.slice(0, 8) + "…", "for chunk", chunkHash.slice(0, 12) + "…");
        channel.sendOffer({
          targetPubkey: gatekeeperPubkey,
          sdp: offer,
          rootHash
        });
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(connectTimeout);
          cleanup();
          reject(err);
        }
      }
    })();
  });
}
