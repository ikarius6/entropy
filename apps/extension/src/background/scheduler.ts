import { pruneDelegations } from "./seeder";
import type { ColdStorageManager } from "./cold-storage-manager";
import type { MetricsCollector } from "./metrics";

// ---------------------------------------------------------------------------
// Configurable constants
// ---------------------------------------------------------------------------

/** How often the maintenance task runs (default: every 5 minutes). */
export const PRUNE_INTERVAL_MS = 1000 * 60 * 5;

/** Maximum age before a delegation is automatically pruned (default: 6 hours). */
export const MAX_DELEGATION_AGE_MS = 1000 * 60 * 60 * 6;

/** How often to run cold storage assignment cycle (default: every 30 minutes). */
export const COLD_STORAGE_CYCLE_MS = 1000 * 60 * 30;

/** How often to prune expired cold storage assignments (default: every 1 hour). */
export const COLD_PRUNE_INTERVAL_MS = 1000 * 60 * 60;

/** How often to verify cold storage chunk integrity (default: every 2 hours). */
export const COLD_INTEGRITY_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 2;

/** How often to run the node health check (default: every 10 minutes). */
export const HEALTH_CHECK_INTERVAL_MS = 1000 * 60 * 10;

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

type ScheduledColdStorage = Pick<ColdStorageManager, "runCycle" | "pruneExpired" | "verifyIntegrity">;

export function scheduleMaintenance(
  coldStorageManager?: ScheduledColdStorage,
  metricsCollector?: Pick<MetricsCollector, "runHealthCheck">
): void {
  setInterval(() => {
    void pruneDelegations(MAX_DELEGATION_AGE_MS);
  }, PRUNE_INTERVAL_MS);

  if (!coldStorageManager) {
    return;
  }

  setInterval(() => {
    void coldStorageManager.runCycle();
  }, COLD_STORAGE_CYCLE_MS);

  setInterval(() => {
    void coldStorageManager.pruneExpired();
  }, COLD_PRUNE_INTERVAL_MS);

  setInterval(() => {
    void coldStorageManager.verifyIntegrity();
  }, COLD_INTEGRITY_CHECK_INTERVAL_MS);

  if (metricsCollector) {
    setInterval(() => {
      void metricsCollector.runHealthCheck();
    }, HEALTH_CHECK_INTERVAL_MS);
  }
}
