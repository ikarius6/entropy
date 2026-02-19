import type { ChunkStore } from "./chunk-store";

export interface QuotaInfo {
  used: number;
  available: number;
  limit: number;
}

export interface QuotaManager {
  getQuotaInfo(): Promise<QuotaInfo>;
  isWithinQuota(additionalBytes: number): Promise<boolean>;
  evictLRU(bytesToFree: number): Promise<number>;
  requestPersistence(): Promise<boolean>;
}

export interface CreateQuotaManagerOptions {
  limitBytes?: number;
}

const DEFAULT_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

async function estimateStorageUsage(store: ChunkStore): Promise<{ usage: number; quota: number | null }> {
  const estimate = await globalThis.navigator?.storage?.estimate?.();

  if (estimate) {
    return {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? null
    };
  }

  return {
    usage: await store.getStoreSize(),
    quota: null
  };
}

class DefaultQuotaManager implements QuotaManager {
  private readonly store: ChunkStore;
  private readonly hardLimitBytes: number;

  constructor(store: ChunkStore, options: CreateQuotaManagerOptions) {
    this.store = store;
    this.hardLimitBytes = options.limitBytes ?? DEFAULT_LIMIT_BYTES;
  }

  async getQuotaInfo(): Promise<QuotaInfo> {
    const estimate = await estimateStorageUsage(this.store);
    const limit = estimate.quota === null ? this.hardLimitBytes : Math.min(this.hardLimitBytes, estimate.quota);
    const used = Math.max(0, estimate.usage);

    return {
      used,
      available: Math.max(0, limit - used),
      limit
    };
  }

  async isWithinQuota(additionalBytes: number): Promise<boolean> {
    if (!Number.isFinite(additionalBytes) || additionalBytes < 0) {
      return false;
    }

    const info = await this.getQuotaInfo();
    return info.used + additionalBytes <= info.limit;
  }

  async evictLRU(bytesToFree: number): Promise<number> {
    if (!Number.isFinite(bytesToFree) || bytesToFree <= 0) {
      return 0;
    }

    const evictable = (await this.store.listAllChunks())
      .filter((chunk) => !chunk.pinned)
      .sort((left, right) => left.lastAccessed - right.lastAccessed);

    let freedBytes = 0;

    for (const chunk of evictable) {
      if (freedBytes >= bytesToFree) {
        break;
      }

      await this.store.deleteChunk(chunk.hash);
      freedBytes += chunk.data.byteLength;
    }

    return freedBytes;
  }

  async requestPersistence(): Promise<boolean> {
    if (typeof globalThis.navigator?.storage?.persist !== "function") {
      return false;
    }

    return globalThis.navigator.storage.persist();
  }
}

export function createQuotaManager(
  store: ChunkStore,
  options: CreateQuotaManagerOptions = {}
): QuotaManager {
  return new DefaultQuotaManager(store, options);
}
