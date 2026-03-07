import { useEffect, useRef, useState, useCallback } from "react";
import { useEntropyStore } from "../stores/entropy-store";
import { KINDS } from "../lib/constants";
import type { FeedItem } from "../types/nostr";
import type { NostrEvent } from "@entropy/core";

interface UseRepostResult {
  /** Whether the current user has already reposted this event */
  reposted: boolean;
  /** True while signing or publishing */
  isBusy: boolean;
  /** Total repost count for this event */
  count: number;
  /** Toggle: repost if not reposted, undo (NIP-09 delete) if already reposted */
  toggle: (item: FeedItem) => Promise<void>;
}

export function useRepost(eventId: string): UseRepostResult {
  const { pubkey, relayPool, relayUrls } = useEntropyStore();

  const [reposted, setReposted] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [count, setCount] = useState(0);

  // Track all repost events for this target event: pubkey → repost event id
  const repostsRef = useRef<Map<string, { repostEventId: string; created_at: number }>>(new Map());
  // Our own repost event id (needed for undo/delete)
  const myRepostIdRef = useRef<string | null>(null);

  const rebuild = useCallback(() => {
    setCount(repostsRef.current.size);
    const mine = pubkey ? repostsRef.current.get(pubkey) : null;
    myRepostIdRef.current = mine?.repostEventId ?? null;
    setReposted(!!mine);
  }, [pubkey]);

  // Subscribe to kind:6 events referencing this event
  useEffect(() => {
    if (!relayPool || relayUrls.length === 0 || !eventId) return;

    repostsRef.current = new Map();
    setCount(0);
    setReposted(false);

    const sub = relayPool.subscribe(
      [{ kinds: [KINDS.REPOST], "#e": [eventId], limit: 200 }],
      (event: NostrEvent) => {
        const existing = repostsRef.current.get(event.pubkey);
        if (!existing || event.created_at > existing.created_at) {
          repostsRef.current.set(event.pubkey, {
            repostEventId: event.id,
            created_at: event.created_at,
          });
        }
        rebuild();
      },
      () => {} // EOSE
    );

    return () => sub.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayPool, relayUrls.join(","), eventId]);

  const toggle = useCallback(async (item: FeedItem) => {
    if (!window.nostr || !relayPool || isBusy || !pubkey) return;
    setIsBusy(true);

    try {
      if (reposted && myRepostIdRef.current) {
        // ── Undo repost: NIP-09 deletion ──
        const deleteDraft = {
          kind: 5 as const,
          created_at: Math.floor(Date.now() / 1000),
          content: "",
          tags: [["e", myRepostIdRef.current]],
        };
        const signed = await window.nostr.signEvent(deleteDraft);
        relayPool.publish(signed as Parameters<typeof relayPool.publish>[0]);

        // Optimistic removal
        repostsRef.current.delete(pubkey);
        rebuild();
      } else {
        // ── Create repost: NIP-18 kind:6 ──
        const originalEvent = {
          id: item.id,
          pubkey: item.pubkey,
          kind: item.kind,
          content: item.content,
          created_at: item.created_at,
          tags: item.tags,
        };

        const draft = {
          kind: KINDS.REPOST,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["e", item.id, ""],
            ["p", item.pubkey],
          ],
          content: JSON.stringify(originalEvent),
        };

        const signed = await window.nostr.signEvent(draft);
        const published = signed as Parameters<typeof relayPool.publish>[0];
        relayPool.publish(published);

        // Optimistic update
        const now = Math.floor(Date.now() / 1000);
        repostsRef.current.set(pubkey, {
          repostEventId: (published as { id?: string }).id || "",
          created_at: now,
        });
        rebuild();
      }
    } catch (err) {
      console.error("[useRepost] error:", err);
    } finally {
      setIsBusy(false);
    }
  }, [eventId, relayPool, pubkey, isBusy, reposted, rebuild]);

  return { reposted, isBusy, count, toggle };
}
