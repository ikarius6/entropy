import { describe, expect, it } from "vitest";

import { createChunkStore, type StoredChunk } from "../storage/chunk-store";

function bytes(size: number): ArrayBuffer {
  return new Uint8Array(size).buffer;
}

function makeChunk(overrides: Partial<StoredChunk> = {}): StoredChunk {
  return {
    hash: "chunk-a",
    data: bytes(32),
    rootHash: "root-a",
    index: 0,
    createdAt: 100,
    lastAccessed: 100,
    pinned: false,
    ...overrides
  };
}

describe("chunk store", () => {
  it("stores and retrieves chunks", async () => {
    const store = createChunkStore();
    const chunk = makeChunk();

    await store.storeChunk(chunk);

    expect(await store.hasChunk(chunk.hash)).toBe(true);

    const loaded = await store.getChunk(chunk.hash);
    expect(loaded?.hash).toBe(chunk.hash);
    expect(loaded?.rootHash).toBe(chunk.rootHash);
    expect(loaded?.data.byteLength).toBe(32);
    expect((loaded?.data ?? new ArrayBuffer(0)) === chunk.data).toBe(false);
  });

  it("lists chunks by root in index order", async () => {
    const store = createChunkStore();

    await store.storeChunk(makeChunk({ hash: "chunk-2", rootHash: "root-z", index: 2 }));
    await store.storeChunk(makeChunk({ hash: "chunk-0", rootHash: "root-z", index: 0 }));
    await store.storeChunk(makeChunk({ hash: "chunk-1", rootHash: "root-z", index: 1 }));

    const listed = await store.listChunksByRoot("root-z");

    expect(listed.map((chunk) => chunk.hash)).toEqual(["chunk-0", "chunk-1", "chunk-2"]);
  });

  it("deletes chunks and reports total size", async () => {
    const store = createChunkStore();

    await store.storeChunk(makeChunk({ hash: "a", data: bytes(8) }));
    await store.storeChunk(makeChunk({ hash: "b", data: bytes(16) }));

    expect(await store.getStoreSize()).toBe(24);

    await store.deleteChunk("a");
    expect(await store.hasChunk("a")).toBe(false);
    expect(await store.getStoreSize()).toBe(16);
  });
});
