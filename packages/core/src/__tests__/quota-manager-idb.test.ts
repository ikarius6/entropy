import { describe, expect, it } from "vitest";

import { createChunkStore } from "../storage/chunk-store";
import { createIndexedDbQuotaManager } from "../storage/quota-manager-idb";

function buffer(size: number): ArrayBuffer {
  return new Uint8Array(size).buffer;
}

describe("indexeddb quota manager", () => {
  it("reports usage and validates quota boundaries", async () => {
    const store = createChunkStore();

    await store.storeChunk({
      hash: "chunk-a",
      data: buffer(200),
      rootHash: "root-a",
      index: 0,
      createdAt: 1,
      lastAccessed: 1,
      pinned: false
    });

    const manager = createIndexedDbQuotaManager(store, { limitBytes: 500 });
    const info = await manager.getQuotaInfo();

    expect(info.used).toBeGreaterThanOrEqual(200);
    expect(info.limit).toBe(500);
    expect(await manager.isWithinQuota(250)).toBe(true);
    expect(await manager.isWithinQuota(400)).toBe(false);
  });

  it("evicts non-pinned least recently used chunks", async () => {
    const store = createChunkStore();

    await store.storeChunk({
      hash: "a",
      data: buffer(120),
      rootHash: "root-a",
      index: 0,
      createdAt: 1,
      lastAccessed: 10,
      pinned: false
    });

    await store.storeChunk({
      hash: "b",
      data: buffer(120),
      rootHash: "root-a",
      index: 1,
      createdAt: 1,
      lastAccessed: 20,
      pinned: true
    });

    await store.storeChunk({
      hash: "c",
      data: buffer(120),
      rootHash: "root-a",
      index: 2,
      createdAt: 1,
      lastAccessed: 30,
      pinned: false
    });

    const manager = createIndexedDbQuotaManager(store, { limitBytes: 1000 });
    const freed = await manager.evictLRU(180);

    expect(freed).toBeGreaterThanOrEqual(240);
    expect(await store.hasChunk("b")).toBe(true);
    expect(await store.hasChunk("a")).toBe(false);
    expect(await store.hasChunk("c")).toBe(false);
  });
});
