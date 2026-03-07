import { useEffect, useRef, useState } from "react";
import { useEntropyStore } from "../stores/entropy-store";
import type { NostrEvent } from "@entropy/core";

interface CachedEvent {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  created_at: number;
  tags: string[][];
}

// Simple in-memory cache so repeated renders don't re-fetch the same event
const eventCache = new Map<string, CachedEvent>();

/**
 * Fetch a single Nostr event by its ID.
 * Returns the event once found, or null while loading / if not found.
 */
export function useEvent(eventId: string | null | undefined) {
  const { relayPool, relayUrls } = useEntropyStore();
  const [event, setEvent] = useState<CachedEvent | null>(
    eventId ? eventCache.get(eventId) ?? null : null
  );
  const [isLoading, setIsLoading] = useState(false);
  const subRef = useRef<{ unsubscribe: () => void } | null>(null);

  useEffect(() => {
    if (!eventId || !relayPool || relayUrls.length === 0) return;

    // Already cached
    const cached = eventCache.get(eventId);
    if (cached) {
      setEvent(cached);
      return;
    }

    setIsLoading(true);

    subRef.current = relayPool.subscribe(
      [{ ids: [eventId], limit: 1 }],
      (ev: NostrEvent) => {
        const item: CachedEvent = {
          id: ev.id,
          pubkey: ev.pubkey,
          kind: ev.kind,
          content: ev.content,
          created_at: ev.created_at,
          tags: ev.tags,
        };
        eventCache.set(eventId, item);
        setEvent(item);
        setIsLoading(false);
        // We got the event — close the subscription
        subRef.current?.unsubscribe();
      },
      () => {
        // EOSE — if we didn't find it, stop loading
        setIsLoading(false);
      }
    );

    return () => {
      subRef.current?.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayPool, relayUrls.join(","), eventId]);

  return { event, isLoading };
}
