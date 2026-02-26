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

// Virtual seconds added to followed-user posts so they sort above same-time
// global discovery posts. 3 600 s = 1 hour boost.
const FOLLOW_BOOST_SECONDS = 3_600;

export function useNostrFeed(options: UseNostrFeedOptions = {}) {
  const { pubkey, relayPool, relayUrls, cacheChunkMap } = useEntropyStore();
  const { follows: myFollows } = useContactList(pubkey);

  const kinds = options.kinds ?? [KINDS.TEXT_NOTE, KINDS.ENTROPY_CHUNK_MAP];
  const limit = options.limit ?? 50;

  const followSet = new Set([...(pubkey ? [pubkey] : []), ...myFollows]);

  // Keys that drive subscription restarts
  const authorsKey = options.authors?.join(",") ?? "";
  const followsKey = [...followSet].sort().join(",");
  const kindsKey = kinds.join(",");

  const [items, setItems] = useState<FeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Accumulate events keyed by id; each entry carries a sort score.
  const accRef = useRef<Map<string, { item: FeedItem; score: number }>>(new Map());

  const flush = () => {
    const sorted = Array.from(accRef.current.values())
      .sort((a, b) => b.score - a.score)
      .map((v) => v.item);
    setItems(sorted);
  };

  const ingestEvent = (event: NostrEvent, boost: number) => {
    const score = event.created_at + boost;
    const existing = accRef.current.get(event.id);
    // If we already have the event at a higher score (follow-boosted), keep it.
    if (existing && existing.score >= score) return;

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
          mimeType: item.chunkMap.mimeType,
          size: item.chunkMap.size,
        });
        cacheChunkMap(item.chunkMap);
      } catch (e) {
        console.warn("[feed] failed to parse chunk map for", event.id, e);
      }
    }

    accRef.current.set(event.id, { item, score });
  };

  useEffect(() => {
    if (!relayPool || relayUrls.length === 0) {
      console.log("[feed] no relayPool or relays, skipping");
      return;
    }
    if (kinds.length === 0) {
      console.log("[feed] no kinds specified, skipping");
      return;
    }

    console.log("[feed] subscribing — followSet size:", followSet.size, "kinds:", kinds);
    setIsLoading(true);
    setItems([]);
    accRef.current = new Map();

    const subs: { unsubscribe: () => void }[] = [];
    let eoseCount = 0;

    const onEose = () => {
      eoseCount++;
      if (eoseCount >= expectedEose) {
        console.log("[feed] all EOSE received, total events:", accRef.current.size);
        setIsLoading(false);
      }
    };

    let expectedEose: number;

    if (options.authors !== undefined) {
      // ── Explicit authors mode (profile page, etc.) ──────────────────────────
      // Single subscription, no discovery, no boost.
      expectedEose = 1;
      const filter = {
        kinds,
        limit,
        "#t": [ENTROPY_TAG],
        ...(options.authors.length > 0 ? { authors: options.authors } : {}),
      };
      subs.push(relayPool.subscribe(
        [filter],
        (event: NostrEvent) => { ingestEvent(event, 0); flush(); },
        onEose
      ));

    } else {
      // ── Home feed mode: follows-priority + global discovery ─────────────────
      // Always run global discovery so content is never hidden.
      // Follow-posts get a score boost so they float to the top.
      expectedEose = followSet.size > 0 ? 2 : 1;

      if (followSet.size > 0) {
        // 1. Follows + self (boosted)
        subs.push(relayPool.subscribe(
          [{ kinds, limit, "#t": [ENTROPY_TAG], authors: [...followSet] }],
          (event: NostrEvent) => { ingestEvent(event, FOLLOW_BOOST_SECONDS); flush(); },
          onEose
        ));
      }

      // 2. Global discovery (no author filter, no boost)
      subs.push(relayPool.subscribe(
        [{ kinds, limit, "#t": [ENTROPY_TAG] }],
        (event: NostrEvent) => { ingestEvent(event, 0); flush(); },
        onEose
      ));
    }

    return () => {
      console.log("[feed] unsubscribing");
      subs.forEach((s) => s.unsubscribe());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayPool, relayUrls.join(","), authorsKey, followsKey, kindsKey, limit]);

  const loadMore = () => {
    console.log("[feed] loadMore not yet implemented");
  };

  return { items, isLoading, loadMore };
}
