import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMockStorage, __setMockStorageValue } from "./__mocks__/webextension-polyfill";

import type { ChunkStore, ColdChunkAssignment } from "@entropy/core";
import type { CreditSummaryPayload } from "../shared/messaging";

function makeCreditSummary(
  overrides: Partial<CreditSummaryPayload> = {}
): CreditSummaryPayload {
  return {
    totalUploaded: 200,
    totalDownloaded: 100,
    ratio: 2,
    balance: 100,
    entryCount: 3,
    coldStorageEligible: true,
    integrityValid: true,
    trustScore: 100,
    receiptVerifiedEntries: 0,
    history: [],
    ...overrides
  };
}

function makeChunkStore(hasChunk: (hash: string) => Promise<boolean>): ChunkStore {
  return {
    storeChunk: vi.fn(async () => {}),
    getChunk: vi.fn(async () => null),
    hasChunk: vi.fn(hasChunk),
    deleteChunk: vi.fn(async () => {}),
    listChunksByRoot: vi.fn(async () => []),
    listAllChunks: vi.fn(async () => []),
    getStoreSize: vi.fn(async () => 0)
  };
}

describe("cold-storage-manager", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    __resetMockStorage();
  });

  it("skips assignment cycle when node is not eligible", async () => {
    const { createColdStorageManager } = await import("../background/cold-storage-manager");

    const chunkStore = makeChunkStore(async () => true);
    const manager = createColdStorageManager({
      chunkStore,
      getCreditSummary: async () => makeCreditSummary({ ratio: 1.2 }),
      listDelegations: async () => [
        {
          rootHash: "root-a",
          chunkHashes: ["chunk-a"],
          size: 100,
          chunkSize: 100,
          mimeType: "application/octet-stream",
          delegatedAt: 1
        }
      ]
    });

    await manager.runCycle();

    expect(chunkStore.hasChunk).not.toHaveBeenCalled();
    await expect(manager.getAssignments()).resolves.toEqual([]);
  });

  it("assigns eligible delegated chunks that exist locally", async () => {
    const { createColdStorageManager } = await import("../background/cold-storage-manager");

    const chunkStore = makeChunkStore(async (hash) => hash !== "chunk-missing");
    const manager = createColdStorageManager({
      chunkStore,
      getCreditSummary: async () => makeCreditSummary({ ratio: 2.5 }),
      listDelegations: async () => [
        {
          rootHash: "root-1",
          chunkHashes: ["chunk-a", "chunk-missing"],
          size: 200,
          chunkSize: 100,
          mimeType: "application/octet-stream",
          delegatedAt: 1
        },
        {
          rootHash: "root-2",
          chunkHashes: ["chunk-b"],
          size: 100,
          chunkSize: 100,
          mimeType: "application/octet-stream",
          delegatedAt: 2
        }
      ],
      nowMs: () => 10_000,
      assignmentTtlMs: 5_000
    });

    await manager.runCycle();

    const assignments = await manager.getAssignments();

    expect(assignments.map((assignment) => assignment.chunkHash).sort()).toEqual([
      "chunk-a",
      "chunk-b"
    ]);
    expect(assignments.every((assignment) => assignment.assignedAt === 10_000)).toBe(true);
    expect(assignments.every((assignment) => assignment.expiresAt === 15_000)).toBe(true);
    expect(assignments.every((assignment) => assignment.premiumCredits > 0)).toBe(true);
  });

  it("prunes expired assignments", async () => {
    const { createColdStorageManager } = await import("../background/cold-storage-manager");

    const seeded: ColdChunkAssignment[] = [
      {
        chunkHash: "expired",
        rootHash: "root-1",
        assignedAt: 0,
        expiresAt: 100,
        premiumCredits: 1
      },
      {
        chunkHash: "active",
        rootHash: "root-2",
        assignedAt: 0,
        expiresAt: 1000,
        premiumCredits: 1
      }
    ];

    __setMockStorageValue("coldStorageAssignments", seeded);

    const manager = createColdStorageManager({
      chunkStore: makeChunkStore(async () => true),
      getCreditSummary: async () => makeCreditSummary(),
      listDelegations: async () => [],
      nowMs: () => 500
    });

    await manager.pruneExpired();

    await expect(manager.getAssignments()).resolves.toEqual([
      {
        chunkHash: "active",
        rootHash: "root-2",
        assignedAt: 0,
        expiresAt: 1000,
        premiumCredits: 1
      }
    ]);
  });

  it("releases individual assignments", async () => {
    const { createColdStorageManager } = await import("../background/cold-storage-manager");

    __setMockStorageValue("coldStorageAssignments", [
      {
        chunkHash: "chunk-a",
        rootHash: "root-1",
        assignedAt: 0,
        expiresAt: 1000,
        premiumCredits: 1
      },
      {
        chunkHash: "chunk-b",
        rootHash: "root-2",
        assignedAt: 0,
        expiresAt: 1000,
        premiumCredits: 1
      }
    ]);

    const manager = createColdStorageManager({
      chunkStore: makeChunkStore(async () => true),
      getCreditSummary: async () => makeCreditSummary(),
      listDelegations: async () => []
    });

    await manager.release("chunk-a");

    await expect(manager.getAssignments()).resolves.toEqual([
      {
        chunkHash: "chunk-b",
        rootHash: "root-2",
        assignedAt: 0,
        expiresAt: 1000,
        premiumCredits: 1
      }
    ]);
  });

  it("respects maxAssignments limit", async () => {
    const { createColdStorageManager } = await import("../background/cold-storage-manager");

    const manager = createColdStorageManager({
      chunkStore: makeChunkStore(async () => true),
      getCreditSummary: async () => makeCreditSummary({ ratio: 3 }),
      listDelegations: async () => [
        {
          rootHash: "root-a",
          chunkHashes: ["chunk-1", "chunk-2", "chunk-3"],
          size: 300,
          chunkSize: 100,
          mimeType: "application/octet-stream",
          delegatedAt: 1
        }
      ],
      maxAssignments: 1
    });

    await manager.runCycle();

    const assignments = await manager.getAssignments();
    expect(assignments).toHaveLength(1);
  });

  it("verifyIntegrity keeps chunks that still exist locally", async () => {
    const { createColdStorageManager } = await import("../background/cold-storage-manager");

    __setMockStorageValue("coldStorageAssignments", [
      { chunkHash: "chunk-a", rootHash: "root-1", assignedAt: 0, expiresAt: 9999, premiumCredits: 1 },
      { chunkHash: "chunk-b", rootHash: "root-2", assignedAt: 0, expiresAt: 9999, premiumCredits: 1 }
    ]);

    const manager = createColdStorageManager({
      chunkStore: makeChunkStore(async () => true),
      getCreditSummary: async () => makeCreditSummary(),
      listDelegations: async () => []
    });

    const result = await manager.verifyIntegrity();

    expect(result).toEqual({ verified: 2, lost: 0 });
    await expect(manager.getAssignments()).resolves.toHaveLength(2);
  });

  it("verifyIntegrity removes assignments whose chunks are no longer in local store", async () => {
    const { createColdStorageManager } = await import("../background/cold-storage-manager");

    __setMockStorageValue("coldStorageAssignments", [
      { chunkHash: "chunk-present", rootHash: "root-1", assignedAt: 0, expiresAt: 9999, premiumCredits: 1 },
      { chunkHash: "chunk-lost", rootHash: "root-2", assignedAt: 0, expiresAt: 9999, premiumCredits: 1 }
    ]);

    const manager = createColdStorageManager({
      chunkStore: makeChunkStore(async (hash) => hash === "chunk-present"),
      getCreditSummary: async () => makeCreditSummary(),
      listDelegations: async () => []
    });

    const result = await manager.verifyIntegrity();

    expect(result).toEqual({ verified: 1, lost: 1 });

    const remaining = await manager.getAssignments();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].chunkHash).toBe("chunk-present");
  });

  it("verifyIntegrity returns zero counts when no assignments exist", async () => {
    const { createColdStorageManager } = await import("../background/cold-storage-manager");

    const manager = createColdStorageManager({
      chunkStore: makeChunkStore(async () => false),
      getCreditSummary: async () => makeCreditSummary(),
      listDelegations: async () => []
    });

    const result = await manager.verifyIntegrity();

    expect(result).toEqual({ verified: 0, lost: 0 });
  });
});
