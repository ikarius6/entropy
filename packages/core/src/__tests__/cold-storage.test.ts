import { describe, expect, it } from "vitest";

import {
  assignColdChunks,
  calculatePremiumCredits,
  isEligibleForColdStorage,
  pruneExpiredAssignments,
  type ColdChunkAssignment
} from "../credits/cold-storage";

describe("cold storage", () => {
  const assignments: ColdChunkAssignment[] = [
    {
      chunkHash: "chunk-a",
      rootHash: "root-1",
      assignedAt: 100,
      expiresAt: 1000,
      premiumCredits: 0,
      replicationCount: 5
    },
    {
      chunkHash: "chunk-b",
      rootHash: "root-2",
      assignedAt: 100,
      expiresAt: 900,
      premiumCredits: 0,
      replicationCount: 1
    },
    {
      chunkHash: "chunk-c",
      rootHash: "root-3",
      assignedAt: 100,
      expiresAt: 800,
      premiumCredits: 0,
      replicationCount: 3
    }
  ];

  it("checks eligibility based on ratio threshold", () => {
    expect(
      isEligibleForColdStorage({
        totalUploaded: 200,
        totalDownloaded: 100,
        ratio: 2,
        balance: 100,
        entryCount: 10
      })
    ).toBe(true);

    expect(
      isEligibleForColdStorage(
        {
          totalUploaded: 150,
          totalDownloaded: 100,
          ratio: 1.5,
          balance: 50,
          entryCount: 10
        },
        2
      )
    ).toBe(false);
  });

  it("assigns less replicated chunks first and computes credits", () => {
    const selected = assignColdChunks(assignments, { maxAssignments: 2 });

    expect(selected).toHaveLength(2);
    expect(selected[0].chunkHash).toBe("chunk-b");
    expect(selected[1].chunkHash).toBe("chunk-c");
    expect(selected.every((entry) => entry.premiumCredits > 0)).toBe(true);
  });

  it("calculates premium credits deterministically with options", () => {
    const credits = calculatePremiumCredits(assignments[0], {
      nowMs: 150,
      premiumMultiplier: 2
    });

    expect(credits).toBeGreaterThan(0);
  });

  it("prunes expired assignments", () => {
    const active = pruneExpiredAssignments(assignments, 850);
    expect(active.map((entry) => entry.chunkHash)).toEqual(["chunk-a", "chunk-b"]);
  });
});
