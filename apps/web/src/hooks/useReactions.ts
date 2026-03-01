import { useEffect, useRef, useState, useCallback } from "react";
import { useEntropyStore } from "../stores/entropy-store";
import type { NostrEvent } from "@entropy/core";

/** Grouped reaction counts keyed by emoji/content string */
export type ReactionCounts = Record<string, number>;

const REACTION_KIND = 7;

interface UseReactionsResult {
  counts: ReactionCounts;
  total: number;
  myReaction: string | null;
  react: (emoji?: string) => Promise<void>;
  isReacting: boolean;
}

export function useReactions(eventId: string, authorPubkey: string): UseReactionsResult {
  const { pubkey, relayPool, relayUrls } = useEntropyStore();

  const [counts, setCounts] = useState<ReactionCounts>({});
  const [myReaction, setMyReaction] = useState<string | null>(null);
  const [isReacting, setIsReacting] = useState(false);

  // eventId → { pubkey → emoji } so every user counts once
  const reactionsRef = useRef<Map<string, { pubkey: string; content: string }>>(new Map());

  const rebuild = useCallback(() => {
    const grouped: ReactionCounts = {};
    let mine: string | null = null;
    for (const { pubkey: pk, content } of reactionsRef.current.values()) {
      const emoji = content || "+";
      grouped[emoji] = (grouped[emoji] ?? 0) + 1;
      if (pk === pubkey) mine = emoji;
    }
    setCounts(grouped);
    setMyReaction(mine);
  }, [pubkey]);

  useEffect(() => {
    if (!relayPool || relayUrls.length === 0 || !eventId) return;

    reactionsRef.current = new Map();
    setCounts({});
    setMyReaction(null);

    const sub = relayPool.subscribe(
      [{ kinds: [REACTION_KIND], "#e": [eventId], limit: 500 }],
      (event: NostrEvent) => {
        // Last reaction per pubkey wins (highest created_at)
        const existing = reactionsRef.current.get(event.pubkey);
        if (!existing || event.created_at > (existing as { created_at?: number }).created_at!) {
          reactionsRef.current.set(event.pubkey, {
            pubkey: event.pubkey,
            content: event.content || "+",
            // store created_at for ordering
            ...{ created_at: event.created_at },
          });
        }
        rebuild();
      },
      () => {} // EOSE – nothing needed
    );

    return () => sub.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayPool, relayUrls.join(","), eventId]);

  const react = useCallback(async (emoji = "❤️") => {
    if (!window.nostr || !relayPool || isReacting) return;
    setIsReacting(true);
    try {
      const draft = {
        kind: REACTION_KIND,
        created_at: Math.floor(Date.now() / 1000),
        content: emoji,
        tags: [
          ["e", eventId],
          ["p", authorPubkey],
        ],
      };
      const signed = await window.nostr.signEvent(draft);
      relayPool.publish(signed as Parameters<typeof relayPool.publish>[0]);

      // Optimistic update
      if (pubkey) {
        reactionsRef.current.set(pubkey, { pubkey, content: emoji, ...{ created_at: draft.created_at } });
        rebuild();
      }
    } catch (err) {
      console.error("[useReactions] react error:", err);
    } finally {
      setIsReacting(false);
    }
  }, [eventId, authorPubkey, relayPool, pubkey, isReacting, rebuild]);

  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  return { counts, total, myReaction, react, isReacting };
}
