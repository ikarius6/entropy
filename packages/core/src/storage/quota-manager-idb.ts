import type { ChunkStore } from "./chunk-store";
import {
  createQuotaManager,
  type CreateQuotaManagerOptions,
  type QuotaInfo,
  type QuotaManager
} from "./quota-manager";

export type IndexedDbQuotaInfo = QuotaInfo;
export type IndexedDbQuotaManager = QuotaManager;
export type CreateIndexedDbQuotaManagerOptions = CreateQuotaManagerOptions;

/**
 * Phase 3 adapter focused on IndexedDB-backed chunk stores.
 *
 * This keeps call sites explicit (`createIndexedDbQuotaManager`) while reusing
 * the shared quota logic (`navigator.storage.estimate + LRU eviction`) from
 * `quota-manager.ts`.
 */
export function createIndexedDbQuotaManager(
  store: ChunkStore,
  options: CreateIndexedDbQuotaManagerOptions = {}
): IndexedDbQuotaManager {
  return createQuotaManager(store, options);
}
