import type { NostrEvent } from "./client";
import type { NostrEventDraft } from "./events";
import { ENTROPY_TAG } from "./nip-entropy";

export const ENTROPY_SEEDER_ANNOUNCEMENT_KIND = 20002;

export interface BuildSeederAnnouncementParams {
  rootHash: string;
  chunkCount: number;
  createdAt?: number;
  content?: string;
}

export interface SeederAnnouncement {
  rootHash: string;
  chunkCount: number;
  seederPubkey: string;
}

function normalizeRootHash(rootHash: string): string {
  const normalized = rootHash.trim().toLowerCase();

  if (normalized.length === 0) {
    throw new Error("rootHash is required.");
  }

  return normalized;
}

function parseChunkCount(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? "", 10);

  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Seeder announcement has an invalid chunk count.");
  }

  return value;
}

function findTag(tags: string[][], key: string): string | undefined {
  return tags.find((tag) => tag[0] === key)?.[1];
}

export function buildSeederAnnouncementEvent(
  params: BuildSeederAnnouncementParams
): NostrEventDraft {
  const rootHash = normalizeRootHash(params.rootHash);
  const chunkCount = parseChunkCount(String(params.chunkCount));

  return {
    kind: ENTROPY_SEEDER_ANNOUNCEMENT_KIND,
    created_at: params.createdAt ?? Math.floor(Date.now() / 1000),
    content: params.content ?? "",
    tags: [
      ["t", ENTROPY_TAG],
      ["x", rootHash],
      ["chunks", String(chunkCount)]
    ]
  };
}

export function parseSeederAnnouncementEvent(
  event: Pick<NostrEvent, "kind" | "tags" | "pubkey">
): SeederAnnouncement {
  if (event.kind !== ENTROPY_SEEDER_ANNOUNCEMENT_KIND) {
    throw new Error(
      `Expected kind ${ENTROPY_SEEDER_ANNOUNCEMENT_KIND} but received ${event.kind}.`
    );
  }

  const rootHash = normalizeRootHash(findTag(event.tags, "x") ?? "");
  const chunkCount = parseChunkCount(findTag(event.tags, "chunks"));

  if (event.pubkey.length === 0) {
    throw new Error("Seeder announcement has an empty pubkey.");
  }

  return {
    rootHash,
    chunkCount,
    seederPubkey: event.pubkey
  };
}
