import type { ChunkStore, StoredChunk } from "./chunk-store";
import type { QuotaManager } from "./quota-manager";

/**
 * Error thrown when the quota cannot be satisfied even after LRU eviction.
 */
export class QuotaExceededError extends Error {
  constructor(requestedBytes: number, availableBytes: number) {
    super(
      `Quota exceeded: requested ${requestedBytes} bytes but only ${availableBytes} bytes available after eviction.`
    );
    this.name = "QuotaExceededError";
  }
}

/**
 * Store a chunk while enforcing quota limits.
 *
 * 1. Check if the chunk fits within the current quota.
 * 2. If not, trigger LRU eviction to free enough space.
 * 3. Re-check. If still over quota, throw `QuotaExceededError`.
 * 4. Store the chunk.
 */
export async function storeChunkWithQuota(
  store: ChunkStore,
  quotaManager: QuotaManager,
  chunk: StoredChunk
): Promise<void> {
  const chunkSize = chunk.data.byteLength;

  if (await quotaManager.isWithinQuota(chunkSize)) {
    await store.storeChunk(chunk);
    return;
  }

  // Attempt eviction
  await quotaManager.evictLRU(chunkSize);

  // Re-check after eviction
  const quotaInfo = await quotaManager.getQuotaInfo();

  if (quotaInfo.available < chunkSize) {
    throw new QuotaExceededError(chunkSize, quotaInfo.available);
  }

  await store.storeChunk(chunk);
}
