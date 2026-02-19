export interface StoredChunk {
  hash: string;
  data: ArrayBuffer;
  rootHash: string;
  index: number;
  createdAt: number;
  lastAccessed: number;
  pinned: boolean;
}

export interface ChunkStore {
  storeChunk(chunk: StoredChunk): Promise<void>;
  getChunk(hash: string): Promise<StoredChunk | null>;
  hasChunk(hash: string): Promise<boolean>;
  deleteChunk(hash: string): Promise<void>;
  listChunksByRoot(rootHash: string): Promise<StoredChunk[]>;
  listAllChunks(): Promise<StoredChunk[]>;
  getStoreSize(): Promise<number>;
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

class InMemoryChunkStore implements ChunkStore {
  private readonly chunks = new Map<string, StoredChunk>();

  constructor(seedChunks: StoredChunk[] = []) {
    for (const chunk of seedChunks) {
      assertChunk(chunk);
      this.chunks.set(chunk.hash, cloneChunk(chunk));
    }
  }

  async storeChunk(chunk: StoredChunk): Promise<void> {
    assertChunk(chunk);

    this.chunks.set(chunk.hash, {
      ...cloneChunk(chunk),
      lastAccessed: Date.now()
    });
  }

  async getChunk(hash: string): Promise<StoredChunk | null> {
    const current = this.chunks.get(hash);

    if (!current) {
      return null;
    }

    const next = {
      ...current,
      lastAccessed: Date.now()
    };

    this.chunks.set(hash, next);
    return cloneChunk(next);
  }

  async hasChunk(hash: string): Promise<boolean> {
    return this.chunks.has(hash);
  }

  async deleteChunk(hash: string): Promise<void> {
    this.chunks.delete(hash);
  }

  async listChunksByRoot(rootHash: string): Promise<StoredChunk[]> {
    return [...this.chunks.values()]
      .filter((chunk) => chunk.rootHash === rootHash)
      .sort((left, right) => left.index - right.index)
      .map(cloneChunk);
  }

  async listAllChunks(): Promise<StoredChunk[]> {
    return [...this.chunks.values()].map(cloneChunk);
  }

  async getStoreSize(): Promise<number> {
    let total = 0;

    for (const chunk of this.chunks.values()) {
      total += chunk.data.byteLength;
    }

    return total;
  }
}

export function createChunkStore(seedChunks: StoredChunk[] = []): ChunkStore {
  return new InMemoryChunkStore(seedChunks);
}
