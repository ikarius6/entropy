import type {
  EventCallback,
  NostrFilter,
  RelayPool,
  Subscription
} from "../nostr/client";
import {
  ENTROPY_CHUNK_MAP_KIND,
  parseEntropyChunkMapTags,
  type EntropyChunkMap
} from "../nostr/nip-entropy";
import {
  ENTROPY_SEEDER_ANNOUNCEMENT_KIND,
  parseSeederAnnouncementEvent
} from "../nostr/seeder-announcement";
import {
  ENTROPY_DEMAND_SIGNAL_KIND,
  parseDemandSignalEvent
} from "../nostr/demand-signal";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_POPULARITY_LOOKBACK_SECONDS = 24 * 60 * 60; // 24 h
export const DEFAULT_POPULARITY_TIMEOUT_MS = 8_000;
export const DEFAULT_SEEDER_COUNT_TIMEOUT_MS = 4_000;
export const DEFAULT_DEMAND_SIGNAL_TIMEOUT_MS = 3_000;
export const DEFAULT_MAX_CANDIDATES = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PopularContent {
  chunkMap: EntropyChunkMap;
  seederCount: number;
  /** Number of unique BUSY demand signals observed for this rootHash. */
  demandSignalCount: number;
  /** Seconds since epoch when the chunk map event was created. */
  createdAt: number;
  /** Higher = better opportunity to earn credits by seeding this content. */
  demandScore: number;
}

export interface DiscoverPopularContentOptions {
  /** How far back to look for chunk map events (seconds). */
  lookbackSeconds?: number;
  /** Total timeout for the discovery process (ms). */
  timeoutMs?: number;
  /** Timeout for counting seeders per rootHash (ms). */
  seederTimeoutMs?: number;
  /** Timeout for counting demand signals per rootHash (ms). */
  demandTimeoutMs?: number;
  /** Max chunk map candidates to evaluate. */
  maxCandidates?: number;
  /** Override for current unix timestamp (testing). */
  nowSeconds?: () => number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch recent chunk map events (kind 7001) from relays. */
function fetchRecentChunkMaps(
  relayPool: RelayPool,
  networkTags: string[],
  lookbackSeconds: number,
  nowSeconds: number,
  maxCandidates: number,
  timeoutMs: number
): Promise<{ chunkMap: EntropyChunkMap; createdAt: number }[]> {
  return new Promise((resolve) => {
    const results: { chunkMap: EntropyChunkMap; createdAt: number }[] = [];
    const seen = new Set<string>();

    const filters: NostrFilter[] = [
      {
        kinds: [ENTROPY_CHUNK_MAP_KIND],
        "#t": networkTags,
        since: Math.max(0, nowSeconds - lookbackSeconds),
        limit: maxCandidates
      }
    ];

    let sub: Subscription | null = null;

    const finish = () => {
      sub?.unsubscribe();
      resolve(results);
    };

    const timer = setTimeout(finish, timeoutMs);

    const onEvent: EventCallback = (event) => {
      try {
        const chunkMap = parseEntropyChunkMapTags(event.tags);
        if (seen.has(chunkMap.rootHash)) return;
        seen.add(chunkMap.rootHash);
        results.push({ chunkMap, createdAt: event.created_at });
      } catch {
        // skip malformed
      }
    };

    const onEose = () => {
      clearTimeout(timer);
      finish();
    };

    sub = relayPool.subscribe(filters, onEvent, onEose);
  });
}

/** Count unique seeders for a set of rootHashes via kind 20002 announcements. */
function countSeedersForRoots(
  relayPool: RelayPool,
  rootHashes: string[],
  lookbackSeconds: number,
  nowSeconds: number,
  timeoutMs: number
): Promise<Map<string, number>> {
  if (rootHashes.length === 0) {
    return Promise.resolve(new Map());
  }

  return new Promise((resolve) => {
    const seederSets = new Map<string, Set<string>>();
    for (const rh of rootHashes) {
      seederSets.set(rh, new Set());
    }

    const filters: NostrFilter[] = [
      {
        kinds: [ENTROPY_SEEDER_ANNOUNCEMENT_KIND],
        "#x": rootHashes,
        since: Math.max(0, nowSeconds - lookbackSeconds)
      }
    ];

    let sub: Subscription | null = null;

    const finish = () => {
      sub?.unsubscribe();
      const counts = new Map<string, number>();
      for (const [rh, set] of seederSets) {
        counts.set(rh, set.size);
      }
      resolve(counts);
    };

    const timer = setTimeout(finish, timeoutMs);

    const onEvent: EventCallback = (event) => {
      try {
        const ann = parseSeederAnnouncementEvent(event);
        seederSets.get(ann.rootHash)?.add(ann.seederPubkey);
      } catch {
        // skip malformed
      }
    };

    const onEose = () => {
      clearTimeout(timer);
      finish();
    };

    sub = relayPool.subscribe(filters, onEvent, onEose);
  });
}

/** Count unique demand signal publishers for a set of rootHashes via kind 20003 events. */
function countDemandSignals(
  relayPool: RelayPool,
  rootHashes: string[],
  lookbackSeconds: number,
  nowSeconds: number,
  timeoutMs: number
): Promise<Map<string, number>> {
  if (rootHashes.length === 0) {
    return Promise.resolve(new Map());
  }

  return new Promise((resolve) => {
    const signalerSets = new Map<string, Set<string>>();
    for (const rh of rootHashes) {
      signalerSets.set(rh, new Set());
    }

    const filters: NostrFilter[] = [
      {
        kinds: [ENTROPY_DEMAND_SIGNAL_KIND],
        "#x": rootHashes,
        since: Math.max(0, nowSeconds - lookbackSeconds)
      }
    ];

    let sub: Subscription | null = null;

    const finish = () => {
      sub?.unsubscribe();
      const counts = new Map<string, number>();
      for (const [rh, set] of signalerSets) {
        counts.set(rh, set.size);
      }
      resolve(counts);
    };

    const timer = setTimeout(finish, timeoutMs);

    const onEvent: EventCallback = (event) => {
      try {
        const sig = parseDemandSignalEvent(event);
        signalerSets.get(sig.rootHash)?.add(sig.signalerPubkey);
      } catch {
        // skip malformed
      }
    };

    const onEose = () => {
      clearTimeout(timer);
      finish();
    };

    sub = relayPool.subscribe(filters, onEvent, onEose);
  });
}

/**
 * Compute a demand score for a piece of content.
 *
 * Score formula:
 *   demandScore = recencyFactor × scarcityFactor × sizeFactor × demandBoost
 *
 * - **recencyFactor**: exponential decay — newer content scores higher
 * - **scarcityFactor**: `1 / (seederCount + 1)` — fewer seeders = bigger opportunity
 * - **sizeFactor**: `log2(sizeBytes / 1MB + 1)` — larger content earns more credits per transfer
 * - **demandBoost**: `1 + log2(demandSignalCount + 1)` — BUSY overflow signals amplify score
 */
function computeDemandScore(
  seederCount: number,
  createdAt: number,
  sizeBytes: number,
  nowSeconds: number,
  demandSignalCount: number
): number {
  const ageSec = Math.max(nowSeconds - createdAt, 1);
  // Half-life of ~6 hours
  const recencyFactor = Math.exp(-ageSec / (6 * 3600));
  const scarcityFactor = 1 / (seederCount + 1);
  const sizeMB = sizeBytes / (1024 * 1024);
  const sizeFactor = Math.log2(sizeMB + 1) + 1; // +1 so tiny files still score > 0
  const demandBoost = 1 + Math.log2(demandSignalCount + 1);

  return recencyFactor * scarcityFactor * sizeFactor * demandBoost;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover popular content with few seeders — ideal candidates for a user
 * who wants to earn credits by seeding high-demand content.
 *
 * 1. Fetch recent chunk map events (kind 7001) from relays
 * 2. Count seeder announcements (kind 20002) per rootHash
 * 3. Count demand signals (kind 20003) per rootHash — BUSY overflow
 * 4. Rank by demand score (recency × scarcity × size × demandBoost)
 */
export async function discoverPopularContent(
  relayPool: RelayPool,
  networkTags: string[],
  options: DiscoverPopularContentOptions = {}
): Promise<PopularContent[]> {
  const lookback = options.lookbackSeconds ?? DEFAULT_POPULARITY_LOOKBACK_SECONDS;
  const timeout = options.timeoutMs ?? DEFAULT_POPULARITY_TIMEOUT_MS;
  const seederTimeout = options.seederTimeoutMs ?? DEFAULT_SEEDER_COUNT_TIMEOUT_MS;
  const demandTimeout = options.demandTimeoutMs ?? DEFAULT_DEMAND_SIGNAL_TIMEOUT_MS;
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const now = options.nowSeconds?.() ?? Math.floor(Date.now() / 1000);

  // Phase 1 — fetch recent chunk maps
  const candidates = await fetchRecentChunkMaps(
    relayPool,
    networkTags,
    lookback,
    now,
    maxCandidates,
    timeout
  );

  if (candidates.length === 0) {
    return [];
  }

  // Phase 2 — count seeders and demand signals in parallel
  const rootHashes = candidates.map((c) => c.chunkMap.rootHash);
  const [seederCounts, demandCounts] = await Promise.all([
    countSeedersForRoots(relayPool, rootHashes, lookback, now, seederTimeout),
    countDemandSignals(relayPool, rootHashes, lookback, now, demandTimeout)
  ]);

  // Phase 3 — score and rank
  const scored: PopularContent[] = candidates.map((c) => {
    const seederCount = seederCounts.get(c.chunkMap.rootHash) ?? 0;
    const demandSignalCount = demandCounts.get(c.chunkMap.rootHash) ?? 0;
    const demandScore = computeDemandScore(
      seederCount, c.createdAt, c.chunkMap.size, now, demandSignalCount
    );

    return {
      chunkMap: c.chunkMap,
      seederCount,
      demandSignalCount,
      createdAt: c.createdAt,
      demandScore
    };
  });

  // Sort descending by demand score
  scored.sort((a, b) => b.demandScore - a.demandScore);

  return scored;
}
