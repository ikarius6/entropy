import type { NostrEvent } from "./client";
import type { NostrEventDraft } from "./events";
import { ENTROPY_TAG } from "./nip-entropy";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ephemeral Nostr event kind for demand signals (BUSY overflow). */
export const ENTROPY_DEMAND_SIGNAL_KIND = 20003;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildDemandSignalParams {
  rootHash: string;
  networkTags?: string[];
  createdAt?: number;
}

export interface DemandSignal {
  rootHash: string;
  signalerPubkey: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeRootHash(rootHash: string): string {
  const normalized = rootHash.trim().toLowerCase();

  if (normalized.length === 0) {
    throw new Error("rootHash is required.");
  }

  return normalized;
}

function findTag(tags: string[][], key: string): string | undefined {
  return tags.find((tag) => tag[0] === key)?.[1];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build an ephemeral Nostr event signaling demand for a rootHash.
 * Published by seeders when they respond with BUSY — indicates the
 * content has more requests than the current seeders can serve.
 */
export function buildDemandSignalEvent(
  params: BuildDemandSignalParams
): NostrEventDraft {
  const rootHash = normalizeRootHash(params.rootHash);

  return {
    kind: ENTROPY_DEMAND_SIGNAL_KIND,
    created_at: params.createdAt ?? Math.floor(Date.now() / 1000),
    content: "",
    tags: [
      ...(params.networkTags && params.networkTags.length > 0
        ? params.networkTags.map((t) => ["t", t])
        : [["t", ENTROPY_TAG]]),
      ["x", rootHash]
    ]
  };
}

/**
 * Parse a demand signal Nostr event into a structured object.
 */
export function parseDemandSignalEvent(
  event: Pick<NostrEvent, "kind" | "tags" | "pubkey" | "created_at">
): DemandSignal {
  if (event.kind !== ENTROPY_DEMAND_SIGNAL_KIND) {
    throw new Error(
      `Expected kind ${ENTROPY_DEMAND_SIGNAL_KIND} but received ${event.kind}.`
    );
  }

  const rootHash = normalizeRootHash(findTag(event.tags, "x") ?? "");

  if (!event.pubkey || event.pubkey.length === 0) {
    throw new Error("Demand signal has an empty pubkey.");
  }

  return {
    rootHash,
    signalerPubkey: event.pubkey,
    timestamp: event.created_at
  };
}
