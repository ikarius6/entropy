import { pruneDelegations } from "./seeder";

// ---------------------------------------------------------------------------
// Configurable constants
// ---------------------------------------------------------------------------

/** How often the maintenance task runs (default: every 5 minutes). */
export const PRUNE_INTERVAL_MS = 1000 * 60 * 5;

/** Maximum age before a delegation is automatically pruned (default: 6 hours). */
export const MAX_DELEGATION_AGE_MS = 1000 * 60 * 60 * 6;

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export function scheduleMaintenance(): void {
  setInterval(() => {
    void pruneDelegations(MAX_DELEGATION_AGE_MS);
  }, PRUNE_INTERVAL_MS);
}
