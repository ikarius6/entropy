import type { RelayPool } from "../nostr/client";
import {
  ENTROPY_SIGNALING_KIND_MIN,
  isEntropySignalingKind,
  type EntropySignalingEnvelope
} from "../nostr/signaling";
import type { NostrEvent, NostrFilter, EventCallback, Subscription } from "../nostr/client";
import type { NostrEventDraft } from "../nostr/events";
import type { EncryptFn, DecryptFn } from "../nostr/nip44";
import { logger } from "../logger";

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
export type SignEventFn = (draft: NostrEventDraft) => NostrEvent | Promise<NostrEvent>;

export interface SignalingChannelOptions {
  encryptFn?: EncryptFn;
  decryptFn?: DecryptFn;
}

// ---------------------------------------------------------------------------
// Signaling Channel — sends/receives WebRTC signaling via Nostr
// ---------------------------------------------------------------------------

/** Signaling kind used for WebRTC handshakes. */
const SIGNALING_KIND = ENTROPY_SIGNALING_KIND_MIN + 1; // 20001

export class SignalingChannel {
  private pool: RelayPool;
  private signEvent: SignEventFn | null;
  private subscription: Subscription | null = null;
  private encryptFn: EncryptFn | null;
  private decryptFn: DecryptFn | null;

  constructor(pool: RelayPool, signEvent?: SignEventFn, options?: SignalingChannelOptions) {
    this.pool = pool;
    this.signEvent = signEvent ?? null;
    this.encryptFn = options?.encryptFn ?? null;
    this.decryptFn = options?.decryptFn ?? null;
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
        since: Math.floor(Date.now() / 1000) - 5
      }
    ];

    logger.log("[SignalingChannel] subscribing for signals to", myPubkey.slice(0, 8) + "…", "filter:", JSON.stringify(filters));

    const onEvent: EventCallback = (event: NostrEvent) => {
      logger.log("[SignalingChannel] raw event received, kind:", event.kind, "from:", event.pubkey?.slice(0, 8) + "…");
      if (!isEntropySignalingKind(event.kind)) {
        logger.log("[SignalingChannel] not a signaling kind, ignoring");
        return;
      }

      const typeTag = event.tags.find((tag) => tag[0] === "type");
      const rootHashTag = event.tags.find((tag) => tag[0] === "x");

      if (!typeTag || !rootHashTag) {
        logger.log("[SignalingChannel] missing type or x tag, ignoring");
        return;
      }

      let rawContent = event.content;

      const encTag = event.tags.find((tag) => tag[0] === "enc" && tag[1] === "nip44");
      if (encTag && this.decryptFn) {
        try {
          rawContent = this.decryptFn(event.pubkey, rawContent);
        } catch (decryptErr) {
          logger.warn("[SignalingChannel] NIP-44 decryption failed, dropping event:", decryptErr);
          return;
        }
      }

      let payload: unknown;

      try {
        payload = JSON.parse(rawContent);
      } catch {
        logger.log("[SignalingChannel] failed to parse content JSON");
        return;
      }

      logger.log("[SignalingChannel] dispatching signal:", typeTag[1], "from:", event.pubkey?.slice(0, 8) + "…", "rootHash:", rootHashTag[1]?.slice(0, 12) + "…");
      callback({
        type: typeTag[1] as SignalingType,
        senderPubkey: event.pubkey,
        rootHash: rootHashTag[1],
        payload,
        createdAt: event.created_at
      });
    };

    this.subscription = this.pool.subscribe(filters, onEvent);
    logger.log("[SignalingChannel] subscription active");

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
    let content = JSON.stringify(payload);
    const tags: string[][] = [
      ["p", targetPubkey],
      ["x", rootHash],
      ["type", type]
    ];

    if (this.encryptFn) {
      content = this.encryptFn(targetPubkey, content);
      tags.push(["enc", "nip44"]);
    }

    const draft: NostrEventDraft = {
      kind: SIGNALING_KIND,
      created_at: Math.floor(Date.now() / 1000),
      content,
      tags
    };

    if (this.signEvent) {
      logger.log("[SignalingChannel] signing + publishing", type, "to", targetPubkey.slice(0, 8) + "…", "rootHash:", rootHash.slice(0, 12) + "…");
      void Promise.resolve(this.signEvent(draft)).then((signed) => {
        logger.log("[SignalingChannel] event signed, publishing id:", signed.id?.slice(0, 12) + "…");
        this.pool.publish(signed);
      }).catch((err) => {
        logger.error("[SignalingChannel] sign/publish error:", err);
      });
    } else {
      logger.warn("[SignalingChannel] no signEvent fn, publishing unsigned (will likely fail)");
      this.pool.publish({ ...draft, id: "", pubkey: "", sig: "" });
    }
  }
}
