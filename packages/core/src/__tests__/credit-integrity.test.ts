import { describe, expect, it } from "vitest";

import type { CreditEntry } from "../credits/ledger";
import type { StoredChunk } from "../storage/chunk-store";
import { createChunkStore } from "../storage/chunk-store";
import {
  serializeEntryForHash,
  computeIntegrityHash,
  computeIntegrityChain,
  verifyIntegrityChain,
  auditCredits
} from "../credits/credit-integrity";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<CreditEntry> = {}): CreditEntry {
  return {
    id: "entry-1",
    peerPubkey: "peer-a",
    direction: "up",
    bytes: 1024,
    chunkHash: "aaaa".repeat(16),
    rootHash: "bbbb".repeat(16),
    receiptSignature: "sig-1",
    timestamp: 1_700_000_000,
    ...overrides
  };
}

function makeStoredChunk(hash: string, rootHash: string, dataSize: number): StoredChunk {
  return {
    hash,
    rootHash,
    index: 0,
    data: new ArrayBuffer(dataSize),
    createdAt: Date.now(),
    lastAccessed: Date.now(),
    pinned: false
  };
}

// ---------------------------------------------------------------------------
// serializeEntryForHash
// ---------------------------------------------------------------------------

describe("serializeEntryForHash", () => {
  it("produces a deterministic pipe-delimited string", () => {
    const entry = makeEntry();
    const serialized = serializeEntryForHash(entry);

    expect(serialized).toBe(
      `entry-1|peer-a|up|1024|${"aaaa".repeat(16)}|${"bbbb".repeat(16)}|sig-1|1700000000`
    );
  });

  it("uses empty string for missing rootHash", () => {
    const entry = makeEntry({ rootHash: undefined });
    const serialized = serializeEntryForHash(entry);

    expect(serialized).toContain("||sig-1");
  });
});

// ---------------------------------------------------------------------------
// computeIntegrityHash
// ---------------------------------------------------------------------------

describe("computeIntegrityHash", () => {
  it("returns a 64-char hex hash", async () => {
    const entry = makeEntry();
    const hash = await computeIntegrityHash(entry, "");

    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  it("produces different hashes for different previous hashes", async () => {
    const entry = makeEntry();
    const hash1 = await computeIntegrityHash(entry, "");
    const hash2 = await computeIntegrityHash(entry, "prev-hash-abc");

    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes for different entry content", async () => {
    const entry1 = makeEntry({ bytes: 1024 });
    const entry2 = makeEntry({ bytes: 2048 });
    const hash1 = await computeIntegrityHash(entry1, "");
    const hash2 = await computeIntegrityHash(entry2, "");

    expect(hash1).not.toBe(hash2);
  });

  it("is deterministic — same input always same output", async () => {
    const entry = makeEntry();
    const hash1 = await computeIntegrityHash(entry, "seed");
    const hash2 = await computeIntegrityHash(entry, "seed");

    expect(hash1).toBe(hash2);
  });
});

// ---------------------------------------------------------------------------
// computeIntegrityChain
// ---------------------------------------------------------------------------

describe("computeIntegrityChain", () => {
  it("returns empty array for empty input", async () => {
    const result = await computeIntegrityChain([]);
    expect(result).toEqual([]);
  });

  it("stamps integrityHash on each entry", async () => {
    const entries = [
      makeEntry({ id: "e1", timestamp: 1 }),
      makeEntry({ id: "e2", timestamp: 2 }),
      makeEntry({ id: "e3", timestamp: 3 })
    ];

    const chain = await computeIntegrityChain(entries);

    expect(chain).toHaveLength(3);
    for (const entry of chain) {
      expect(entry.integrityHash).toBeDefined();
      expect(entry.integrityHash).toHaveLength(64);
    }
  });

  it("each entry hash depends on the previous entry hash (chain property)", async () => {
    const entries = [
      makeEntry({ id: "e1", timestamp: 1 }),
      makeEntry({ id: "e2", timestamp: 2 })
    ];

    const chain = await computeIntegrityChain(entries);

    // Verify second entry hash was computed using first entry hash
    const expectedSecondHash = await computeIntegrityHash(entries[1], chain[0].integrityHash!);
    expect(chain[1].integrityHash).toBe(expectedSecondHash);
  });

  it("does not mutate original entries", async () => {
    const entries = [makeEntry({ id: "e1" })];

    await computeIntegrityChain(entries);

    expect(entries[0].integrityHash).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// verifyIntegrityChain
// ---------------------------------------------------------------------------

describe("verifyIntegrityChain", () => {
  it("returns valid for an empty ledger", async () => {
    const result = await verifyIntegrityChain([]);

    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(0);
    expect(result.verifiedEntries).toBe(0);
    expect(result.legacyEntries).toBe(0);
    expect(result.firstCorruptedIndex).toBeNull();
  });

  it("returns valid for a correctly stamped chain", async () => {
    const entries = [
      makeEntry({ id: "e1", timestamp: 1 }),
      makeEntry({ id: "e2", timestamp: 2 }),
      makeEntry({ id: "e3", timestamp: 3 })
    ];

    const chain = await computeIntegrityChain(entries);
    const result = await verifyIntegrityChain(chain);

    expect(result.valid).toBe(true);
    expect(result.verifiedEntries).toBe(3);
    expect(result.legacyEntries).toBe(0);
    expect(result.firstCorruptedIndex).toBeNull();
  });

  it("detects tampered bytes field", async () => {
    const entries = [
      makeEntry({ id: "e1", timestamp: 1 }),
      makeEntry({ id: "e2", timestamp: 2, bytes: 500 }),
      makeEntry({ id: "e3", timestamp: 3 })
    ];

    const chain = await computeIntegrityChain(entries);

    // Tamper: change bytes on second entry
    const tampered = [...chain];
    tampered[1] = { ...tampered[1], bytes: 999999 };

    const result = await verifyIntegrityChain(tampered);

    expect(result.valid).toBe(false);
    expect(result.firstCorruptedIndex).toBe(1);
  });

  it("detects inserted entry", async () => {
    const entries = [
      makeEntry({ id: "e1", timestamp: 1 }),
      makeEntry({ id: "e2", timestamp: 2 })
    ];

    const chain = await computeIntegrityChain(entries);

    // Insert a fake entry with a made-up hash
    const fakeEntry: CreditEntry = {
      ...makeEntry({ id: "fake", timestamp: 15, bytes: 9999 }),
      integrityHash: "0".repeat(64)
    };

    const tampered = [chain[0], fakeEntry, chain[1]];
    const result = await verifyIntegrityChain(tampered);

    expect(result.valid).toBe(false);
    expect(result.firstCorruptedIndex).toBe(1);
  });

  it("detects deleted entry (chain breaks)", async () => {
    const entries = [
      makeEntry({ id: "e1", timestamp: 1 }),
      makeEntry({ id: "e2", timestamp: 2 }),
      makeEntry({ id: "e3", timestamp: 3 })
    ];

    const chain = await computeIntegrityChain(entries);

    // Delete middle entry
    const tampered = [chain[0], chain[2]];
    const result = await verifyIntegrityChain(tampered);

    expect(result.valid).toBe(false);
    expect(result.firstCorruptedIndex).toBe(1);
  });

  it("detects tampered direction (up → down fraud)", async () => {
    const entries = [
      makeEntry({ id: "e1", timestamp: 1, direction: "down", bytes: 500 }),
      makeEntry({ id: "e2", timestamp: 2, direction: "up", bytes: 1000 })
    ];

    const chain = await computeIntegrityChain(entries);

    // Tamper: flip a download to an upload to inflate balance
    const tampered = [...chain];
    tampered[0] = { ...tampered[0], direction: "up" };

    const result = await verifyIntegrityChain(tampered);

    expect(result.valid).toBe(false);
    expect(result.firstCorruptedIndex).toBe(0);
  });

  it("treats entries without integrityHash as legacy", async () => {
    const legacyEntries: CreditEntry[] = [
      makeEntry({ id: "old-1", timestamp: 1 }),
      makeEntry({ id: "old-2", timestamp: 2 })
    ];

    const result = await verifyIntegrityChain(legacyEntries);

    expect(result.valid).toBe(true);
    expect(result.legacyEntries).toBe(2);
    expect(result.verifiedEntries).toBe(0);
  });

  it("handles mixed legacy and stamped entries", async () => {
    const legacy: CreditEntry = makeEntry({ id: "old-1", timestamp: 1 });

    const newEntries = [
      makeEntry({ id: "new-1", timestamp: 2 }),
      makeEntry({ id: "new-2", timestamp: 3 })
    ];

    const stampedNew = await computeIntegrityChain(newEntries);
    const mixed = [legacy, ...stampedNew];

    const result = await verifyIntegrityChain(mixed);

    expect(result.valid).toBe(true);
    expect(result.legacyEntries).toBe(1);
    expect(result.verifiedEntries).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// auditCredits (Capa 2 — chunk cross-reference)
// ---------------------------------------------------------------------------

describe("auditCredits", () => {
  it("returns perfect score for empty ledger", async () => {
    const store = createChunkStore();
    const result = await auditCredits([], store);

    expect(result.totalEntries).toBe(0);
    expect(result.trustScore).toBe(100);
    expect(result.integrity.valid).toBe(true);
  });

  it("marks upload entries as verified when chunk exists and size matches", async () => {
    const chunkHash = "aaaa".repeat(16);
    const rootHash = "bbbb".repeat(16);
    const entries = await computeIntegrityChain([
      makeEntry({ id: "e1", chunkHash, rootHash, bytes: 1024, direction: "up" })
    ]);

    const store = createChunkStore([makeStoredChunk(chunkHash, rootHash, 1024)]);
    const result = await auditCredits(entries, store);

    expect(result.verifiedEntries).toBe(1);
    expect(result.suspiciousEntries).toBe(0);
    expect(result.trustScore).toBe(100);
    expect(result.auditedEntries[0].status).toBe("verified");
  });

  it("marks download entries as verified (self-reported consumption)", async () => {
    const entries = await computeIntegrityChain([
      makeEntry({ id: "e1", direction: "down", bytes: 500 })
    ]);

    const store = createChunkStore();
    const result = await auditCredits(entries, store);

    expect(result.verifiedEntries).toBe(1);
    expect(result.auditedEntries[0].status).toBe("verified");
  });

  it("marks upload entry as suspicious when no chunk and no rootHash chunks exist", async () => {
    const entries = await computeIntegrityChain([
      makeEntry({ id: "e1", direction: "up", chunkHash: "dead".repeat(16), rootHash: "face".repeat(16) })
    ]);

    const store = createChunkStore();
    const result = await auditCredits(entries, store);

    expect(result.suspiciousEntries).toBe(1);
    expect(result.auditedEntries[0].status).toBe("suspicious");
    expect(result.trustScore).toBeLessThan(100);
  });

  it("marks upload entry as unverifiable when chunk evicted but rootHash siblings exist", async () => {
    const chunkHash = "dead".repeat(16);
    const rootHash = "bbbb".repeat(16);
    const siblingHash = "cccc".repeat(16);

    const entries = await computeIntegrityChain([
      makeEntry({ id: "e1", direction: "up", chunkHash, rootHash, bytes: 1024 })
    ]);

    // Chunk itself is gone, but a sibling from the same root exists
    const store = createChunkStore([makeStoredChunk(siblingHash, rootHash, 2048)]);
    const result = await auditCredits(entries, store);

    expect(result.unverifiableEntries).toBe(1);
    expect(result.auditedEntries[0].status).toBe("unverifiable");
  });

  it("marks upload entry as suspicious when declared bytes far exceed chunk size", async () => {
    const chunkHash = "aaaa".repeat(16);
    const rootHash = "bbbb".repeat(16);

    const entries = await computeIntegrityChain([
      makeEntry({ id: "e1", direction: "up", chunkHash, rootHash, bytes: 999999 })
    ]);

    // Chunk exists but is only 1024 bytes, entry claims 999999
    const store = createChunkStore([makeStoredChunk(chunkHash, rootHash, 1024)]);
    const result = await auditCredits(entries, store);

    expect(result.suspiciousEntries).toBe(1);
    expect(result.auditedEntries[0].status).toBe("suspicious");
    expect(result.auditedEntries[0].reason).toContain("999999");
    expect(result.auditedEntries[0].reason).toContain("1024");
  });

  it("marks upload entry as suspicious when rootHash does not match chunk rootHash", async () => {
    const chunkHash = "aaaa".repeat(16);
    const declaredRoot = "bbbb".repeat(16);
    const actualRoot = "cccc".repeat(16);

    const entries = await computeIntegrityChain([
      makeEntry({ id: "e1", direction: "up", chunkHash, rootHash: declaredRoot, bytes: 1024 })
    ]);

    const store = createChunkStore([makeStoredChunk(chunkHash, actualRoot, 1024)]);
    const result = await auditCredits(entries, store);

    expect(result.suspiciousEntries).toBe(1);
    expect(result.auditedEntries[0].status).toBe("suspicious");
    expect(result.auditedEntries[0].reason).toContain("rootHash");
  });

  it("computes trust score correctly with mixed results", async () => {
    const goodChunk = "aaaa".repeat(16);
    const missingChunk = "dead".repeat(16);
    const rootHash = "bbbb".repeat(16);

    const entries = await computeIntegrityChain([
      makeEntry({ id: "e1", direction: "up", chunkHash: goodChunk, rootHash, bytes: 1024 }),
      makeEntry({ id: "e2", direction: "up", chunkHash: missingChunk, rootHash: "ffff".repeat(16), bytes: 512 }),
      makeEntry({ id: "e3", direction: "down", bytes: 256 })
    ]);

    const store = createChunkStore([makeStoredChunk(goodChunk, rootHash, 1024)]);
    const result = await auditCredits(entries, store);

    expect(result.verifiedEntries).toBe(2); // good upload + download
    expect(result.suspiciousEntries).toBe(1); // missing chunk
    expect(result.totalEntries).toBe(3);
    // trustScore = round(((2 verified + 0 unverifiable*0.5) / 3) * 100) = 67
    expect(result.trustScore).toBe(67);
  });

  it("includes integrity check result in audit", async () => {
    const entries = await computeIntegrityChain([
      makeEntry({ id: "e1", timestamp: 1 }),
      makeEntry({ id: "e2", timestamp: 2 })
    ]);

    // Tamper an entry
    const tampered = [...entries];
    tampered[1] = { ...tampered[1], bytes: 999999 };

    const store = createChunkStore();
    const result = await auditCredits(tampered, store);

    expect(result.integrity.valid).toBe(false);
    expect(result.integrity.firstCorruptedIndex).toBe(1);
  });

  it("handles entries without rootHash gracefully", async () => {
    const chunkHash = "aaaa".repeat(16);

    const entries = await computeIntegrityChain([
      makeEntry({ id: "e1", direction: "up", chunkHash, rootHash: undefined, bytes: 1024 })
    ]);

    // Chunk doesn't exist, no rootHash to cross-ref → suspicious
    const store = createChunkStore();
    const result = await auditCredits(entries, store);

    expect(result.suspiciousEntries).toBe(1);
  });

  it("bytes within tolerance are verified (5% margin)", async () => {
    const chunkHash = "aaaa".repeat(16);
    const rootHash = "bbbb".repeat(16);

    // Chunk is 1000 bytes, entry declares 1040 (4% over — within 5% tolerance)
    const entries = await computeIntegrityChain([
      makeEntry({ id: "e1", direction: "up", chunkHash, rootHash, bytes: 1040 })
    ]);

    const store = createChunkStore([makeStoredChunk(chunkHash, rootHash, 1000)]);
    const result = await auditCredits(entries, store);

    expect(result.verifiedEntries).toBe(1);
    expect(result.auditedEntries[0].status).toBe("verified");
  });

  it("bytes exceeding tolerance are suspicious (>5% over)", async () => {
    const chunkHash = "aaaa".repeat(16);
    const rootHash = "bbbb".repeat(16);

    // Chunk is 1000 bytes, entry declares 1060 (6% over — exceeds 5% tolerance)
    const entries = await computeIntegrityChain([
      makeEntry({ id: "e1", direction: "up", chunkHash, rootHash, bytes: 1060 })
    ]);

    const store = createChunkStore([makeStoredChunk(chunkHash, rootHash, 1000)]);
    const result = await auditCredits(entries, store);

    expect(result.suspiciousEntries).toBe(1);
    expect(result.auditedEntries[0].status).toBe("suspicious");
  });
});
