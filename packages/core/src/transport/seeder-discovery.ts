import type {
  EventCallback,
  NostrFilter,
  RelayPool,
  Subscription
} from "../nostr/client";
import {
  ENTROPY_SEEDER_ANNOUNCEMENT_KIND,
  parseSeederAnnouncementEvent
} from "../nostr/seeder-announcement";

export const DEFAULT_SEEDER_DISCOVERY_TIMEOUT_MS = 3_000;
export const DEFAULT_SEEDER_DISCOVERY_LOOKBACK_SECONDS = 60 * 60;

export interface DiscoverSeedersOptions {
  timeoutMs?: number;
  lookbackSeconds?: number;
  minChunkCount?: number;
  nowSeconds?: () => number;
}

function normalizeRootHash(rootHash: string): string {
  return rootHash.trim().toLowerCase();
}

/**
 * Query relays for ephemeral seeder announcements (kind 20002) for a root hash.
 */
export async function discoverSeeders(
  relayPool: RelayPool,
  rootHash: string,
  options: DiscoverSeedersOptions = {}
): Promise<string[]> {
  const normalizedRootHash = normalizeRootHash(rootHash);
  const timeoutMs = options.timeoutMs ?? DEFAULT_SEEDER_DISCOVERY_TIMEOUT_MS;
  const lookbackSeconds = options.lookbackSeconds ?? DEFAULT_SEEDER_DISCOVERY_LOOKBACK_SECONDS;
  const minChunkCount = options.minChunkCount ?? 0;
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  if (timeoutMs <= 0) {
    return [];
  }

  const discovered = new Set<string>();
  const filters: NostrFilter[] = [
    {
      kinds: [ENTROPY_SEEDER_ANNOUNCEMENT_KIND],
      "#x": [normalizedRootHash],
      since: Math.max(0, nowSeconds() - lookbackSeconds)
    }
  ];

  return new Promise<string[]>((resolve) => {
    let settled = false;
    let subscription: Subscription | null = null;
    let unsubscribeCalled = false;
    let finishRequestedBeforeSubscribe = false;

    const onEvent: EventCallback = (event) => {
      try {
        const announcement = parseSeederAnnouncementEvent(event);
        if (announcement.rootHash !== normalizedRootHash) {
          return;
        }

        if (announcement.chunkCount < minChunkCount) {
          return;
        }

        discovered.add(announcement.seederPubkey);
      } catch {
        // ignore malformed announcements
      }
    };

    const timeoutId = setTimeout(() => {
      finish();
    }, timeoutMs);

    function finish(): void {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);

      if (!subscription) {
        finishRequestedBeforeSubscribe = true;
      } else if (!unsubscribeCalled) {
        unsubscribeCalled = true;
        subscription?.unsubscribe();
      }

      resolve([...discovered]);
    }

    subscription = relayPool.subscribe(filters, onEvent, () => {
      finish();
    });

    if (finishRequestedBeforeSubscribe && !unsubscribeCalled) {
      unsubscribeCalled = true;
      subscription.unsubscribe();
    }
  });
}
