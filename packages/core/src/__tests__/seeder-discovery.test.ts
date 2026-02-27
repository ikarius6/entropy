import { describe, expect, it, vi } from "vitest";

import type {
  EventCallback,
  NostrEvent,
  NostrFilter,
  RelayPool
} from "../nostr/client";
import { ENTROPY_SEEDER_ANNOUNCEMENT_KIND } from "../nostr/seeder-announcement";
import { discoverSeeders } from "../transport/seeder-discovery";

const ROOT_HASH = "f".repeat(64);

function makeAnnouncement(
  seederPubkey: string,
  rootHash: string,
  chunkCount: number
): NostrEvent {
  return {
    id: `event-${seederPubkey}-${chunkCount}`,
    pubkey: seederPubkey,
    sig: "signature",
    kind: ENTROPY_SEEDER_ANNOUNCEMENT_KIND,
    created_at: 1_700_000_000,
    content: "",
    tags: [
      ["x", rootHash],
      ["chunks", String(chunkCount)]
    ]
  };
}

describe("seeder-discovery", () => {
  it("discovers seeders from announcements and deduplicates pubkeys", async () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(
      (filters: NostrFilter[], onEvent: EventCallback, onEose?: () => void) => {
        queueMicrotask(() => {
          onEvent(makeAnnouncement("peer-a", ROOT_HASH, 6));
          onEvent(makeAnnouncement("peer-a", ROOT_HASH, 8));
          onEvent(makeAnnouncement("peer-b", ROOT_HASH, 2));
          onEvent(makeAnnouncement("peer-c", "other-root", 9));
          onEose?.();
        });

        return {
          id: "sub-1",
          unsubscribe
        };
      }
    );

    const relayPool = {
      subscribe,
      getRelayCount: vi.fn(() => 1)
    } as unknown as RelayPool;

    const discovered = await discoverSeeders(relayPool, ROOT_HASH, {
      timeoutMs: 250,
      nowSeconds: () => 1000,
      lookbackSeconds: 120,
      minChunkCount: 5
    });

    expect(discovered).toEqual(["peer-a"]);
    expect(subscribe).toHaveBeenCalledTimes(1);

    const filters = subscribe.mock.calls[0]?.[0] as NostrFilter[];
    expect(filters[0]?.kinds).toEqual([ENTROPY_SEEDER_ANNOUNCEMENT_KIND]);
    expect(filters[0]?.["#x"]).toEqual([ROOT_HASH]);
    expect(filters[0]?.since).toBe(880);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("handles synchronous EOSE callbacks safely", async () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(
      (_filters: NostrFilter[], _onEvent: EventCallback, onEose?: () => void) => {
        onEose?.();

        return {
          id: "sub-2",
          unsubscribe
        };
      }
    );

    const relayPool = {
      subscribe,
      getRelayCount: vi.fn(() => 1)
    } as unknown as RelayPool;

    const discovered = await discoverSeeders(relayPool, ROOT_HASH, { timeoutMs: 250 });

    expect(discovered).toEqual([]);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("returns empty result without subscribing when timeout is not positive", async () => {
    const subscribe = vi.fn();

    const relayPool = {
      subscribe,
      getRelayCount: vi.fn(() => 1)
    } as unknown as RelayPool;

    const discovered = await discoverSeeders(relayPool, ROOT_HASH, { timeoutMs: 0 });

    expect(discovered).toEqual([]);
    expect(subscribe).not.toHaveBeenCalled();
  });
});
