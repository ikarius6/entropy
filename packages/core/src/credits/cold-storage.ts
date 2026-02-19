import type { LedgerSummary } from "./ledger";

export interface ColdChunkAssignment {
  chunkHash: string;
  rootHash: string;
  assignedAt: number;
  expiresAt: number;
  premiumCredits: number;
  replicationCount?: number;
}

export interface ColdStorageOptions {
  minimumEligibleRatio?: number;
  maxAssignments?: number;
  nowMs?: number;
  premiumMultiplier?: number;
}

const DEFAULT_MIN_ELIGIBLE_RATIO = 2;
const DEFAULT_MAX_ASSIGNMENTS = 16;
const DEFAULT_PREMIUM_MULTIPLIER = 1;

export function isEligibleForColdStorage(
  summary: LedgerSummary,
  minimumEligibleRatio = DEFAULT_MIN_ELIGIBLE_RATIO
): boolean {
  if (!Number.isFinite(minimumEligibleRatio) || minimumEligibleRatio <= 0) {
    throw new Error("minimumEligibleRatio must be a positive number.");
  }

  return (
    summary.entryCount > 0 &&
    summary.totalUploaded > 0 &&
    summary.ratio >= minimumEligibleRatio
  );
}

export function calculatePremiumCredits(
  assignment: ColdChunkAssignment,
  options: Pick<ColdStorageOptions, "nowMs" | "premiumMultiplier"> = {}
): number {
  const nowMs = options.nowMs ?? Date.now();
  const premiumMultiplier = options.premiumMultiplier ?? DEFAULT_PREMIUM_MULTIPLIER;

  if (!Number.isFinite(premiumMultiplier) || premiumMultiplier <= 0) {
    throw new Error("premiumMultiplier must be a positive number.");
  }

  const durationMs = Math.max(0, assignment.expiresAt - assignment.assignedAt);
  const days = durationMs / (1000 * 60 * 60 * 24);
  const rarityBoost = Math.max(1, 10 - (assignment.replicationCount ?? 1));
  const activeBoost = nowMs <= assignment.expiresAt ? 1 : 0.5;

  const credits = Math.round(days * rarityBoost * premiumMultiplier * activeBoost);
  return Math.max(credits, 1);
}

export function assignColdChunks(
  available: ColdChunkAssignment[],
  options: Pick<ColdStorageOptions, "maxAssignments"> = {}
): ColdChunkAssignment[] {
  const maxAssignments = options.maxAssignments ?? DEFAULT_MAX_ASSIGNMENTS;

  if (!Number.isFinite(maxAssignments) || maxAssignments <= 0) {
    throw new Error("maxAssignments must be a positive number.");
  }

  return [...available]
    .sort((left, right) => {
      const leftReplication = left.replicationCount ?? Number.MAX_SAFE_INTEGER;
      const rightReplication = right.replicationCount ?? Number.MAX_SAFE_INTEGER;

      if (leftReplication !== rightReplication) {
        return leftReplication - rightReplication;
      }

      return left.expiresAt - right.expiresAt;
    })
    .slice(0, maxAssignments)
    .map((assignment) => ({
      ...assignment,
      premiumCredits: calculatePremiumCredits(assignment)
    }));
}

export function pruneExpiredAssignments(
  assignments: ColdChunkAssignment[],
  nowMs = Date.now()
): ColdChunkAssignment[] {
  return assignments.filter((assignment) => assignment.expiresAt > nowMs);
}
