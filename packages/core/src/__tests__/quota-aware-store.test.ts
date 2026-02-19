import { describe, expect, it } from "vitest";

import { createChunkStore, type StoredChunk } from "../storage/chunk-store";
import { createQuotaManager } from "../storage/quota-manager";
import { storeChunkWithQuota, QuotaExceededError } from "../storage/quota-aware-store";

function makeChunk(hash: string, sizeBytes: number, pinned = false): StoredChunk {
  return {
    hash,
    data: new ArrayBuffer(sizeBytes),
    rootHash: "root-abc",
    index: 0,
    createdAt: Date.now(),
    lastAccessed: Date.now() - 10_000, // old enough to be evictable
    pinned
  };
}

describe("storeChunkWithQuota", () => {
  it("stores a chunk when within quota", async () => {
    const store = createChunkStore();
    const quota = createQuotaManager(store, { limitBytes: 1024 });
    const chunk = makeChunk("chunk-a", 100);

    await storeChunkWithQuota(store, quota, chunk);

    expect(await store.hasChunk("chunk-a")).toBe(true);
  });

  it("evicts LRU chunks when over quota and stores the new chunk", async () => {
    // Seed with an evictable chunk that fills most of the quota
    const oldChunk = makeChunk("old-chunk", 800);
    oldChunk.lastAccessed = 1; // very old

    const store = createChunkStore([oldChunk]);
    const quota = createQuotaManager(store, { limitBytes: 1000 });

    const newChunk = makeChunk("new-chunk", 500);

    await storeChunkWithQuota(store, quota, newChunk);

    // Old chunk should have been evicted
    expect(await store.hasChunk("old-chunk")).toBe(false);
    // New chunk stored
    expect(await store.hasChunk("new-chunk")).toBe(true);
  });

  it("throws QuotaExceededError when eviction cannot free enough space", async () => {
    // Seed with a pinned chunk that cannot be evicted
    const pinnedChunk = makeChunk("pinned", 900, true);
    const store = createChunkStore([pinnedChunk]);
    const quota = createQuotaManager(store, { limitBytes: 1000 });

    const newChunk = makeChunk("too-big", 500);

    await expect(storeChunkWithQuota(store, quota, newChunk)).rejects.toThrow(QuotaExceededError);
    expect(await store.hasChunk("too-big")).toBe(false);
  });

  it("does not evict pinned chunks", async () => {
    const pinnedChunk = makeChunk("pinned", 600, true);
    pinnedChunk.lastAccessed = 1;

    const evictableChunk = makeChunk("evictable", 300);
    evictableChunk.lastAccessed = 2;

    const store = createChunkStore([pinnedChunk, evictableChunk]);
    const quota = createQuotaManager(store, { limitBytes: 1000 });

    const newChunk = makeChunk("new", 200);

    await storeChunkWithQuota(store, quota, newChunk);

    expect(await store.hasChunk("pinned")).toBe(true);
    expect(await store.hasChunk("evictable")).toBe(false);
    expect(await store.hasChunk("new")).toBe(true);
  });
});
