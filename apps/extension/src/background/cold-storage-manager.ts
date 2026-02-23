import browser from "webextension-polyfill";
import {
  assignColdChunks,
  isEligibleForColdStorage,
  logger,
  pruneExpiredAssignments,
  type ChunkStore,
  type ColdChunkAssignment,
  type LedgerSummary
} from "@entropy/core";

import type { CreditSummaryPayload } from "../shared/messaging";
import type { DelegatedContentRecord } from "./seeder";

const STORAGE_KEY = "coldStorageAssignments";
const DEFAULT_ASSIGNMENT_TTL_MS = 1000 * 60 * 60 * 24;
const DEFAULT_MAX_ASSIGNMENTS = 16;

interface ColdStorageSchema {
  coldStorageAssignments?: ColdChunkAssignment[];
}

export interface ColdStorageManager {
  runCycle(): Promise<void>;
  getAssignments(): Promise<ColdChunkAssignment[]>;
  release(chunkHash: string): Promise<void>;
  pruneExpired(): Promise<void>;
  verifyIntegrity(): Promise<{ verified: number; lost: number }>;
}

export interface CreateColdStorageManagerDependencies {
  chunkStore: ChunkStore;
  getCreditSummary: () => Promise<CreditSummaryPayload>;
  listDelegations: () => Promise<DelegatedContentRecord[]>;
  nowMs?: () => number;
  assignmentTtlMs?: number;
  maxAssignments?: number;
}

function cloneAssignment(assignment: ColdChunkAssignment): ColdChunkAssignment {
  return { ...assignment };
}

function isColdAssignment(value: unknown): value is ColdChunkAssignment {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ColdChunkAssignment>;
  return (
    typeof candidate.chunkHash === "string" &&
    typeof candidate.rootHash === "string" &&
    typeof candidate.assignedAt === "number" &&
    typeof candidate.expiresAt === "number" &&
    typeof candidate.premiumCredits === "number"
  );
}

function toLedgerSummary(summary: CreditSummaryPayload): LedgerSummary {
  return {
    totalUploaded: summary.totalUploaded,
    totalDownloaded: summary.totalDownloaded,
    ratio: summary.ratio ?? 0,
    balance: summary.balance,
    entryCount: summary.entryCount
  };
}

export function createColdStorageManager(
  deps: CreateColdStorageManagerDependencies
): ColdStorageManager {
  const nowMs = deps.nowMs ?? (() => Date.now());
  const assignmentTtlMs = deps.assignmentTtlMs ?? DEFAULT_ASSIGNMENT_TTL_MS;
  const maxAssignments = deps.maxAssignments ?? DEFAULT_MAX_ASSIGNMENTS;

  if (!Number.isFinite(assignmentTtlMs) || assignmentTtlMs <= 0) {
    throw new Error("assignmentTtlMs must be a positive number.");
  }

  if (!Number.isFinite(maxAssignments) || maxAssignments <= 0) {
    throw new Error("maxAssignments must be a positive number.");
  }

  async function readAssignments(): Promise<ColdChunkAssignment[]> {
    const stored = (await browser.storage.local.get(STORAGE_KEY)) as Partial<ColdStorageSchema>;
    const assignments = stored[STORAGE_KEY];

    if (!Array.isArray(assignments)) {
      return [];
    }

    return assignments.filter(isColdAssignment).map(cloneAssignment);
  }

  async function writeAssignments(assignments: ColdChunkAssignment[]): Promise<void> {
    await browser.storage.local.set({
      [STORAGE_KEY]: assignments.map(cloneAssignment)
    });
  }

  async function getAssignments(): Promise<ColdChunkAssignment[]> {
    return readAssignments();
  }

  async function release(chunkHash: string): Promise<void> {
    const assignments = await readAssignments();
    const next = assignments.filter((assignment) => assignment.chunkHash !== chunkHash);
    await writeAssignments(next);
  }

  async function pruneExpired(): Promise<void> {
    const assignments = await readAssignments();
    const next = pruneExpiredAssignments(assignments, nowMs());
    await writeAssignments(next);
  }

  async function verifyIntegrity(): Promise<{ verified: number; lost: number }> {
    const assignments = await readAssignments();
    const verified: ColdChunkAssignment[] = [];
    let lostCount = 0;

    for (const assignment of assignments) {
      const hasChunk = await deps.chunkStore.hasChunk(assignment.chunkHash);

      if (hasChunk) {
        verified.push(assignment);
      } else {
        lostCount += 1;
        logger.warn(
          "[cold-storage] integrity check: chunk no longer in local store, dropping assignment",
          assignment.chunkHash.slice(0, 12) + "…"
        );
      }
    }

    if (lostCount > 0) {
      await writeAssignments(verified);
    }

    logger.log(
      `[cold-storage] integrity check complete: ${verified.length} verified, ${lostCount} lost`
    );

    return { verified: verified.length, lost: lostCount };
  }

  async function runCycle(): Promise<void> {
    const summary = await deps.getCreditSummary();
    if (!isEligibleForColdStorage(toLedgerSummary(summary))) {
      logger.log("[cold-storage] node not eligible this cycle");
      return;
    }

    const now = nowMs();
    const currentAssignments = pruneExpiredAssignments(await readAssignments(), now);

    if (currentAssignments.length >= maxAssignments) {
      await writeAssignments(currentAssignments);
      logger.log("[cold-storage] max assignments reached, skipping cycle");
      return;
    }

    const activeHashes = new Set(currentAssignments.map((assignment) => assignment.chunkHash));
    const availableHashes = new Set<string>();
    const delegations = await deps.listDelegations();

    const available: ColdChunkAssignment[] = [];

    for (const delegation of delegations) {
      for (const chunkHash of delegation.chunkHashes) {
        if (activeHashes.has(chunkHash) || availableHashes.has(chunkHash)) {
          continue;
        }

        availableHashes.add(chunkHash);

        available.push({
          chunkHash,
          rootHash: delegation.rootHash,
          assignedAt: now,
          expiresAt: now + assignmentTtlMs,
          premiumCredits: 0,
          replicationCount: delegation.chunkHashes.length
        });
      }
    }

    const remainingSlots = Math.max(0, maxAssignments - currentAssignments.length);
    if (remainingSlots === 0 || available.length === 0) {
      await writeAssignments(currentAssignments);
      return;
    }

    const selected = assignColdChunks(available, {
      maxAssignments: remainingSlots
    });

    const accepted: ColdChunkAssignment[] = [];

    for (const assignment of selected) {
      const hasChunk = await deps.chunkStore.hasChunk(assignment.chunkHash);
      if (!hasChunk) {
        logger.log(
          "[cold-storage] skipping assignment without local chunk",
          assignment.chunkHash.slice(0, 12) + "…"
        );
        continue;
      }

      accepted.push(assignment);
    }

    const next = [...currentAssignments, ...accepted];
    await writeAssignments(next);
  }

  return {
    runCycle,
    getAssignments,
    release,
    pruneExpired,
    verifyIntegrity
  };
}
