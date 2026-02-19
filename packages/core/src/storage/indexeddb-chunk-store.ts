import Dexie, { type Table } from "dexie";

import type { ChunkStore, StoredChunk } from "./chunk-store";

export const DEFAULT_INDEXEDDB_CHUNK_STORE_NAME = "entropy-chunks";
export const INDEXEDDB_CHUNK_STORE_VERSION = 1;

export interface CreateIndexedDbChunkStoreOptions {
  dbName?: string;
}

function cloneBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return buffer.slice(0);
}

function cloneChunk(chunk: StoredChunk): StoredChunk {
  return {
    ...chunk,
    data: cloneBuffer(chunk.data)
  };
}

function assertChunk(chunk: StoredChunk): void {
  if (
    chunk.hash.length === 0 ||
    chunk.rootHash.length === 0 ||
    !Number.isInteger(chunk.index) ||
    chunk.index < 0 ||
    !Number.isFinite(chunk.createdAt) ||
    !Number.isFinite(chunk.lastAccessed)
  ) {
    throw new Error("Invalid stored chunk.");
  }
}

class ChunkDatabase extends Dexie {
  chunks!: Table<StoredChunk, string>;

  constructor(name: string) {
    super(name);

    this.version(INDEXEDDB_CHUNK_STORE_VERSION).stores({
      chunks: "hash, rootHash, index, lastAccessed, pinned"
    });
  }
}

export class IndexedDbChunkStore implements ChunkStore {
  private readonly db: ChunkDatabase;

  constructor(options: CreateIndexedDbChunkStoreOptions = {}) {
    this.db = new ChunkDatabase(options.dbName ?? DEFAULT_INDEXEDDB_CHUNK_STORE_NAME);
  }

  close(): void {
    this.db.close();
  }

  async storeChunk(chunk: StoredChunk): Promise<void> {
    assertChunk(chunk);

    await this.db.chunks.put({
      ...cloneChunk(chunk),
      lastAccessed: Date.now()
    });
  }

  async getChunk(hash: string): Promise<StoredChunk | null> {
    const chunk = await this.db.chunks.get(hash);

    if (!chunk) {
      return null;
    }

    const next = {
      ...chunk,
      lastAccessed: Date.now()
    };

    await this.db.chunks.put(next);
    return cloneChunk(next);
  }

  async hasChunk(hash: string): Promise<boolean> {
    return (await this.db.chunks.get(hash)) !== undefined;
  }

  async deleteChunk(hash: string): Promise<void> {
    await this.db.chunks.delete(hash);
  }

  async listChunksByRoot(rootHash: string): Promise<StoredChunk[]> {
    const chunks = await this.db.chunks.where("rootHash").equals(rootHash).sortBy("index");
    return chunks.map(cloneChunk);
  }

  async listAllChunks(): Promise<StoredChunk[]> {
    const chunks = await this.db.chunks.toArray();
    return chunks.map(cloneChunk);
  }

  async getStoreSize(): Promise<number> {
    const chunks = await this.db.chunks.toArray();

    let total = 0;

    for (const chunk of chunks) {
      total += chunk.data.byteLength;
    }

    return total;
  }
}

export function createIndexedDbChunkStore(
  options: CreateIndexedDbChunkStoreOptions = {}
): IndexedDbChunkStore {
  return new IndexedDbChunkStore(options);
}
