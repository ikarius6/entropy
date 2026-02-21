import type { RelayPool } from "../nostr/client";
import {
  ENTROPY_SIGNALING_KIND_MIN,
  isEntropySignalingKind,
  type EntropySignalingEnvelope
} from "../nostr/signaling";
import type { NostrEvent, NostrFilter, EventCallback, Subscription } from "../nostr/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignalingType = "offer" | "answer" | "ice-candidate";

export interface SignalingMessage {
  type: SignalingType;
  senderPubkey: string;
  rootHash: string;
  payload: unknown;
  createdAt: number;
}

export type SignalCallback = (signal: SignalingMessage) => void;

// ---------------------------------------------------------------------------
// Signaling Channel — sends/receives WebRTC signaling via Nostr
// ---------------------------------------------------------------------------

/** Signaling kind used for WebRTC handshakes. */
const SIGNALING_KIND = ENTROPY_SIGNALING_KIND_MIN + 1; // 20001

export class SignalingChannel {
  private pool: RelayPool;
  private subscription: Subscription | null = null;

  constructor(pool: RelayPool) {
    this.pool = pool;
  }

  /** Send an SDP offer to a target peer. */
  sendOffer(params: { targetPubkey: string; sdp: unknown; rootHash: string }): void {
    this.publishSignalingEvent(params.targetPubkey, "offer", params.sdp, params.rootHash);
  }

  /** Send an SDP answer to a target peer. */
  sendAnswer(params: { targetPubkey: string; sdp: unknown; rootHash: string }): void {
    this.publishSignalingEvent(params.targetPubkey, "answer", params.sdp, params.rootHash);
  }

  /** Send an ICE candidate to a target peer. */
  sendIceCandidate(params: { targetPubkey: string; candidate: unknown; rootHash: string }): void {
    this.publishSignalingEvent(params.targetPubkey, "ice-candidate", params.candidate, params.rootHash);
  }

  /** Listen for incoming signaling events targeting our pubkey. */
  onSignal(myPubkey: string, callback: SignalCallback): () => void {
    const filters: NostrFilter[] = [
      {
        kinds: [SIGNALING_KIND],
        "#p": [myPubkey],
        since: Math.floor(Date.now() / 1000) - 60
      }
    ];

    const onEvent: EventCallback = (event: NostrEvent) => {
      if (!isEntropySignalingKind(event.kind)) {
        return;
      }

      const typeTag = event.tags.find((tag) => tag[0] === "type");
      const rootHashTag = event.tags.find((tag) => tag[0] === "x");

      if (!typeTag || !rootHashTag) {
        return;
      }

      let payload: unknown;

      try {
        payload = JSON.parse(event.content);
      } catch {
        return;
      }

      callback({
        type: typeTag[1] as SignalingType,
        senderPubkey: event.pubkey,
        rootHash: rootHashTag[1],
        payload,
        createdAt: event.created_at
      });
    };

    this.subscription = this.pool.subscribe(filters, onEvent);

    return () => {
      this.subscription?.unsubscribe();
      this.subscription = null;
    };
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private publishSignalingEvent(
    targetPubkey: string,
    type: SignalingType,
    payload: unknown,
    rootHash: string
  ): void {
    const event = {
      kind: SIGNALING_KIND,
      created_at: Math.floor(Date.now() / 1000),
      content: JSON.stringify(payload),
      tags: [
        ["p", targetPubkey],
        ["x", rootHash],
        ["type", type]
      ],
      // These will need to be filled by the signing layer before publishing
      id: "",
      pubkey: "",
      sig: ""
    };

    this.pool.publish(event);
  }
}
