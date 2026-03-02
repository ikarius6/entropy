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

  // pubkey → { content, eventId } so every user counts once and we can delete
  const reactionsRef = useRef<Map<string, { pubkey: string; content: string; eventId: string; created_at: number }>>(new Map());

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
        if (!existing || event.created_at > existing.created_at) {
          reactionsRef.current.set(event.pubkey, {
            pubkey: event.pubkey,
            content: event.content || "+",
            eventId: event.id,
            created_at: event.created_at,
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
    if (!window.nostr || !relayPool || isReacting || !pubkey) return;
    setIsReacting(true);
    try {
      const existing = reactionsRef.current.get(pubkey);
      const isSameEmoji = existing && existing.content === emoji;

      // If clicking the same emoji → unlike (NIP-09 deletion)
      if (isSameEmoji && existing.eventId) {
        const deleteDraft = {
          kind: 5 as const,
          created_at: Math.floor(Date.now() / 1000),
          content: "",
          tags: [["e", existing.eventId]],
        };
        const signed = await window.nostr.signEvent(deleteDraft);
        relayPool.publish(signed as Parameters<typeof relayPool.publish>[0]);

        // Optimistic removal
        reactionsRef.current.delete(pubkey);
        rebuild();
        return;
      }

      // If switching emoji → delete old first, then publish new
      if (existing && existing.eventId) {
        const deleteDraft = {
          kind: 5 as const,
          created_at: Math.floor(Date.now() / 1000),
          content: "",
          tags: [["e", existing.eventId]],
        };
        const signed = await window.nostr.signEvent(deleteDraft);
        relayPool.publish(signed as Parameters<typeof relayPool.publish>[0]);
      }

      // Publish new reaction
      const now = Math.floor(Date.now() / 1000);
      const draft = {
        kind: REACTION_KIND,
        created_at: now,
        content: emoji,
        tags: [
          ["e", eventId],
          ["p", authorPubkey],
        ],
      };
      const signed = await window.nostr.signEvent(draft);
      const published = signed as Parameters<typeof relayPool.publish>[0];
      relayPool.publish(published);

      // Optimistic update
      reactionsRef.current.set(pubkey, { pubkey, content: emoji, eventId: (published as { id?: string }).id || "", created_at: now });
      rebuild();
    } catch (err) {
      console.error("[useReactions] react error:", err);
    } finally {
      setIsReacting(false);
    }
  }, [eventId, authorPubkey, relayPool, pubkey, isReacting, rebuild]);

  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  return { counts, total, myReaction, react, isReacting };
}
