import {
  SignalingChannel,
  createRtcConfiguration,
  type RelayPool,
  type SignalingMessage
} from "@entropy/core";

export interface SignalingListenerOptions {
  canServeRoot?: (rootHash: string) => boolean | Promise<boolean>;
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


export function startSignalingListener(
  pool: RelayPool,
  myPubkey: string,
  onPeerConnected: (pubkey: string, dataChannel: RTCDataChannel) => void,
  options: SignalingListenerOptions = {}
): () => void {
  const channel = new SignalingChannel(pool);
  const peers = new Map<string, RTCPeerConnection>();
  const canServeRoot = options.canServeRoot ?? (() => true);

  const unsubscribe = channel.onSignal(myPubkey, (signal) => {
    void (async () => {
      if (!(await Promise.resolve(canServeRoot(signal.rootHash)))) {
        return;
      }

      const key = toConnectionKey(signal);

      if (signal.type === "offer") {
        if (!isSessionDescriptionPayload(signal.payload)) {
          return;
        }

        peers.get(key)?.close();

        const peer = new RTCPeerConnection(createRtcConfiguration());
        peers.set(key, peer);

        peer.onicecandidate = (event) => {
          if (!event.candidate) {
            return;
          }

          channel.sendIceCandidate({
            targetPubkey: signal.senderPubkey,
            candidate: event.candidate.toJSON(),
            rootHash: signal.rootHash,
          });
        };

        peer.ondatachannel = (event) => {
          onPeerConnected(signal.senderPubkey, event.channel);
        };

        await peer.setRemoteDescription(signal.payload);

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        channel.sendAnswer({
          targetPubkey: signal.senderPubkey,
          sdp: answer,
          rootHash: signal.rootHash,
        });

        return;
      }

      if (signal.type === "ice-candidate") {
        if (!isIceCandidatePayload(signal.payload)) {
          return;
        }

        const peer = peers.get(key);

        if (!peer) {
          return;
        }

        await peer.addIceCandidate(signal.payload);
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
