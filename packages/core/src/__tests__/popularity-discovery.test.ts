import { describe, expect, it, vi } from "vitest";

import type {
  EventCallback,
  NostrEvent,
  NostrFilter,
  RelayPool
} from "../nostr/client";
import { ENTROPY_CHUNK_MAP_KIND } from "../nostr/nip-entropy";
import { ENTROPY_SEEDER_ANNOUNCEMENT_KIND } from "../nostr/seeder-announcement";
import { discoverPopularContent } from "../transport/popularity-discovery";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT_A = "a".repeat(64);
const ROOT_B = "b".repeat(64);
const ROOT_C = "c".repeat(64);
const NOW = 1_700_000_000;

function makeChunkMapEvent(
  rootHash: string,
  size: number,
  chunkCount: number,
  createdAt: number
): NostrEvent {
  const tags: string[][] = [
    ["t", "entropy"],
    ["x-hash", rootHash],
    ["size", String(size)],
    ["chunk-size", String(5 * 1024 * 1024)]
  ];
  for (let i = 0; i < chunkCount; i++) {
    const hash = rootHash.slice(0, 60) + i.toString().padStart(4, "0");
    tags.push(["chunk", hash, String(i)]);
  }

  return {
    id: `cm-${rootHash.slice(0, 8)}`,
    pubkey: "publisher-" + rootHash.slice(0, 8),
    sig: "sig",
    kind: ENTROPY_CHUNK_MAP_KIND,
    created_at: createdAt,
    content: "",
    tags
  };
}

function makeSeederAnnouncement(
  seederPubkey: string,
  rootHash: string,
  chunkCount: number
): NostrEvent {
  return {
    id: `sa-${seederPubkey}-${rootHash.slice(0, 8)}`,
    pubkey: seederPubkey,
    sig: "sig",
    kind: ENTROPY_SEEDER_ANNOUNCEMENT_KIND,
    created_at: NOW - 100,
    content: "",
    tags: [
      ["x", rootHash],
      ["chunks", String(chunkCount)]
    ]
  };
}

function createMockRelayPool(
  chunkMapEvents: NostrEvent[],
  seederEvents: NostrEvent[]
): RelayPool {
  const unsubscribe = vi.fn();
  let subCounter = 0;

  const subscribe = vi.fn(
    (filters: NostrFilter[], onEvent: EventCallback, onEose?: () => void) => {
      subCounter++;
      const isChunkMapSub = filters.some((f) =>
        f.kinds?.includes(ENTROPY_CHUNK_MAP_KIND)
      );

      queueMicrotask(() => {
        const events = isChunkMapSub ? chunkMapEvents : seederEvents;
        for (const ev of events) {
          onEvent(ev);
        }
        onEose?.();
      });

      return { id: `sub-${subCounter}`, unsubscribe };
    }
  );

  return {
    subscribe,
    getRelayCount: vi.fn(() => 1)
  } as unknown as RelayPool;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("popularity-discovery", () => {
  it("discovers and ranks content by demand score", async () => {
    // ROOT_A: recent, large, 1 seeder → high demand
    // ROOT_B: older, small, 3 seeders → low demand
    // ROOT_C: recent, medium, 0 seeders → highest demand (scarcity)
    const chunkMaps = [
      makeChunkMapEvent(ROOT_A, 20 * 1024 * 1024, 4, NOW - 3600), // 1h old, 20MB
      makeChunkMapEvent(ROOT_B, 2 * 1024 * 1024, 1, NOW - 20 * 3600), // 20h old, 2MB
      makeChunkMapEvent(ROOT_C, 10 * 1024 * 1024, 2, NOW - 1800) // 30min old, 10MB
    ];

    const seeders = [
      makeSeederAnnouncement("seeder-1", ROOT_A, 4),
      makeSeederAnnouncement("seeder-1", ROOT_B, 1),
      makeSeederAnnouncement("seeder-2", ROOT_B, 1),
      makeSeederAnnouncement("seeder-3", ROOT_B, 1)
    ];

    const pool = createMockRelayPool(chunkMaps, seeders);

    const results = await discoverPopularContent(pool, ["entropy"], {
      nowSeconds: () => NOW,
      timeoutMs: 500,
      seederTimeoutMs: 500
    });

    expect(results.length).toBe(3);

    // ROOT_C should rank first (0 seeders, recent, decent size)
    expect(results[0].chunkMap.rootHash).toBe(ROOT_C);
    expect(results[0].seederCount).toBe(0);

    // ROOT_A should rank second (1 seeder, recent, large)
    expect(results[1].chunkMap.rootHash).toBe(ROOT_A);
    expect(results[1].seederCount).toBe(1);

    // ROOT_B should rank last (3 seeders, old, small)
    expect(results[2].chunkMap.rootHash).toBe(ROOT_B);
    expect(results[2].seederCount).toBe(3);

    // All should have positive scores
    for (const r of results) {
      expect(r.demandScore).toBeGreaterThan(0);
    }

    // Scores should be descending
    expect(results[0].demandScore).toBeGreaterThan(results[1].demandScore);
    expect(results[1].demandScore).toBeGreaterThan(results[2].demandScore);
  });

  it("returns empty when no chunk maps found", async () => {
    const pool = createMockRelayPool([], []);

    const results = await discoverPopularContent(pool, ["entropy"], {
      nowSeconds: () => NOW,
      timeoutMs: 250,
      seederTimeoutMs: 250
    });

    expect(results).toEqual([]);
  });

  it("deduplicates chunk maps by rootHash", async () => {
    const chunkMaps = [
      makeChunkMapEvent(ROOT_A, 10 * 1024 * 1024, 2, NOW - 600),
      makeChunkMapEvent(ROOT_A, 10 * 1024 * 1024, 2, NOW - 300) // duplicate
    ];

    const pool = createMockRelayPool(chunkMaps, []);

    const results = await discoverPopularContent(pool, ["entropy"], {
      nowSeconds: () => NOW,
      timeoutMs: 250,
      seederTimeoutMs: 250
    });

    expect(results.length).toBe(1);
    expect(results[0].chunkMap.rootHash).toBe(ROOT_A);
  });

  it("assigns seederCount 0 when no announcements exist", async () => {
    const chunkMaps = [
      makeChunkMapEvent(ROOT_A, 5 * 1024 * 1024, 1, NOW - 100)
    ];

    const pool = createMockRelayPool(chunkMaps, []);

    const results = await discoverPopularContent(pool, ["entropy"], {
      nowSeconds: () => NOW,
      timeoutMs: 250,
      seederTimeoutMs: 250
    });

    expect(results.length).toBe(1);
    expect(results[0].seederCount).toBe(0);
    expect(results[0].demandScore).toBeGreaterThan(0);
  });
});
