import { useEffect, useRef, useState } from "react";
import { useEntropyStore } from "../stores/entropy-store";
import { parseEntropyChunkMapTags } from "@entropy/core";
import type { NostrEvent } from "@entropy/core";
import type { FeedItem } from "../types/nostr";
import { KINDS } from "../lib/constants";

interface UseRepliesResult {
  replies: FeedItem[];
  isLoading: boolean;
  load: () => void;
  isLoaded: boolean;
}

export function useReplies(eventId: string): UseRepliesResult {
  const { relayPool, relayUrls, cacheChunkMap, networkTags } = useEntropyStore();
  const [replies, setReplies] = useState<FeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const accRef = useRef<Map<string, { item: FeedItem; created_at: number }>>(new Map());
  const subRef = useRef<{ unsubscribe: () => void } | null>(null);

  const load = () => {
    if (isLoaded || isLoading) return;
    if (!relayPool || relayUrls.length === 0 || !eventId) return;

    setIsLoading(true);
    accRef.current = new Map();

    const flush = () => {
      const sorted = Array.from(accRef.current.values())
        .sort((a, b) => a.created_at - b.created_at) // oldest first in threads
        .map((v) => v.item);
      setReplies(sorted);
    };

    // Fetch kind:1 replies (NIP-10 e-tag) plus entropy kind:7001 replies
    subRef.current = relayPool.subscribe(
      [
        { kinds: [KINDS.TEXT_NOTE], "#e": [eventId], limit: 100 },
        { kinds: [KINDS.ENTROPY_CHUNK_MAP], "#e": [eventId], "#t": networkTags, limit: 50 },
      ],
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
            cacheChunkMap(item.chunkMap);
          } catch {
            // ignore malformed events
          }
        }

        accRef.current.set(event.id, { item, created_at: event.created_at });
        flush();
      },
      () => {
        // EOSE
        flush();
        setIsLoading(false);
        setIsLoaded(true);
      }
    );
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      subRef.current?.unsubscribe();
    };
  }, []);

  return { replies, isLoading, load, isLoaded };
}
