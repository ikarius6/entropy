import { useEffect, useRef, useState } from "react";
import { useEntropyStore } from "../stores/entropy-store";
import { useContactList } from "./useContactList";
import { KINDS } from "../lib/constants";
import { ENTROPY_TAG, parseEntropyChunkMapTags } from "@entropy/core";
import type { NostrEvent } from "@entropy/core";
import type { FeedItem } from "../types/nostr";

interface UseNostrFeedOptions {
  authors?: string[];
  kinds?: number[];
  limit?: number;
}

export function useNostrFeed(options: UseNostrFeedOptions = {}) {
  const { pubkey, relayPool, relayUrls, cacheChunkMap } = useEntropyStore();
  const { follows: myFollows } = useContactList(pubkey);

  const kinds = options.kinds ?? [KINDS.TEXT_NOTE, KINDS.ENTROPY_CHUNK_MAP];
  const limit = options.limit ?? 50;

  // authors: explicit list > follows+self > discovery (no filter) > skip (no pubkey)
  // When options.authors is explicitly provided, use it as-is (even if empty).
  // When not provided: if we have a pubkey, include self + follows.
  // If no follows yet, still include self so we always have at least one author.
  // Pass null to mean "no author filter" (global discovery mode).
  const authors: string[] | null = options.authors !== undefined
    ? (options.authors.length > 0 ? options.authors : null)
    : pubkey
      ? (myFollows.length > 0 ? [...myFollows, pubkey] : null)
      : null;

  const authorsKey = authors?.join(",") ?? "";
  const kindsKey = kinds.join(",");

  const [items, setItems] = useState<FeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Accumulate events between renders without causing re-renders on each event
  const accRef = useRef<Map<string, FeedItem>>(new Map());

  useEffect(() => {
    if (!relayPool || relayUrls.length === 0) {
      console.log("[feed] no relayPool or relays, skipping subscription");
      return;
    }

    if (kinds.length === 0) {
      console.log("[feed] no kinds specified, skipping subscription");
      return;
    }

    // authors is now always string[] | null; null means global discovery

    console.log("[feed] subscribing to relays:", relayUrls, "kinds:", kinds, "authors:", authors ?? "all");
    setIsLoading(true);
    setItems([]);
    accRef.current = new Map();

    const filter = {
      kinds,
      limit,
      "#t": [ENTROPY_TAG],
      ...(authors !== null && authors.length > 0 ? { authors } : {}),
    };

    const sub = relayPool.subscribe(
      [filter],
      (event: NostrEvent) => {
        if (accRef.current.has(event.id)) return;

        const item: FeedItem = {
          id: event.id,
          pubkey: event.pubkey,
          kind: event.kind,
          content: event.content,
          created_at: event.created_at,
          tags: event.tags,
        };

        if (event.kind === KINDS.ENTROPY_CHUNK_MAP) {
          try {
            item.chunkMap = parseEntropyChunkMapTags(event.tags);
            console.log("[feed] parsed chunkMap:", {
              rootHash: item.chunkMap.rootHash.slice(0, 12) + "…",
              chunks: item.chunkMap.chunks.length,
              gatekeepers: item.chunkMap.gatekeepers,
              mimeType: item.chunkMap.mimeType,
              size: item.chunkMap.size
            });
            cacheChunkMap(item.chunkMap);
          } catch (e) {
            console.warn("[feed] failed to parse chunk map for", event.id, e);
          }
        }

        accRef.current.set(event.id, item);

        const sorted = Array.from(accRef.current.values())
          .sort((a, b) => b.created_at - a.created_at);
        setItems(sorted);
      },
      () => {
        console.log("[feed] EOSE received, loaded", accRef.current.size, "events");
        setIsLoading(false);
      }
    );

    return () => {
      console.log("[feed] unsubscribing");
      sub.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayPool, relayUrls.join(","), authorsKey, kindsKey, limit]);

  const loadMore = () => {
    console.log("[feed] loadMore not yet implemented");
  };

  return { items, isLoading, loadMore };
}
