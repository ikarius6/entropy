import type { ChunkStore, StoreChunkPayload, StoredChunk } from "@entropy/core";

function numberArrayToBuffer(data: number[]): ArrayBuffer {
  return new Uint8Array(data).buffer;
}

function toStoredChunk(payload: StoreChunkPayload): StoredChunk {
  if (!Number.isInteger(payload.index) || payload.index < 0) {
    throw new Error("Chunk index must be a non-negative integer.");
  }

  return {
    hash: payload.hash,
    rootHash: payload.rootHash,
    index: payload.index,
    data: numberArrayToBuffer(payload.data),
    createdAt: Date.now(),
    lastAccessed: Date.now(),
    pinned: payload.pinned ?? false
  };
}

export async function storeChunkPayload(chunkStore: ChunkStore, payload: StoreChunkPayload): Promise<void> {
  await chunkStore.storeChunk(toStoredChunk(payload));
}

export async function hasDelegatedChunks(
  chunkStore: ChunkStore,
  chunkHashes: string[]
): Promise<{ ok: boolean; missing: string[] }> {
  const missing: string[] = [];

  for (const hash of chunkHashes) {
    if (!(await chunkStore.hasChunk(hash))) {
      missing.push(hash);
    }
  }

  return {
    ok: missing.length === 0,
    missing
  };
}
