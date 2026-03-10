import { useEffect, useRef, useState } from "react";
import { useEntropyStore } from "../stores/entropy-store";
import { useContactList } from "./useContactList";
import { KINDS } from "../lib/constants";
import { parseEntropyChunkMapTags, scoreContentRelevance } from "@entropy/core";
import type { NostrEvent, ContentTag, UserTagPreference } from "@entropy/core";
import type { FeedItem } from "../types/nostr";

export type FeedSortMode = "chronological" | "for_you" | "explore";

interface UseNostrFeedOptions {
  authors?: string[];
  kinds?: number[];
  limit?: number;
  /** When false, drops the #t entropy tag filter so plain Nostr events show up. Default: true */
  entropyOnly?: boolean;
  /** User tag preferences for relevance scoring. Only used when feedMode is "for_you". */
  userPrefs?: UserTagPreference[];
  /** Feed sort mode. Default: "chronological" */
  feedMode?: FeedSortMode;
}

// Virtual seconds added to followed-user posts so they sort above same-time
// global discovery posts. 3 600 s = 1 hour boost.
const FOLLOW_BOOST_SECONDS = 3_600;

const EMPTY_PREFS: UserTagPreference[] = [];

export function useNostrFeed(options: UseNostrFeedOptions = {}) {
  const { pubkey, relayPool, relayUrls, cacheChunkMap, networkTags } = useEntropyStore();
  const { follows: myFollows } = useContactList(pubkey);

  const kinds = options.kinds ?? [KINDS.TEXT_NOTE, KINDS.ENTROPY_CHUNK_MAP, KINDS.REPOST];
  const limit = options.limit ?? 50;
  const entropyOnly = options.entropyOnly !== false; // default true

  const followSet = new Set([...(pubkey ? [pubkey] : []), ...myFollows]);

  // Keys that drive subscription restarts
  const authorsKey = options.authors?.join(",") ?? "";
  const followsKey = [...followSet].sort().join(",");
  const kindsKey = kinds.join(",");
  const networkTagsKey = networkTags.join(",");

  const [items, setItems] = useState<FeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const feedMode = options.feedMode ?? "chronological";
  const userPrefs = options.userPrefs ?? EMPTY_PREFS;

  // Keep latest values in refs so flush() inside subscription closures sees current state
  const feedModeRef = useRef(feedMode);
  feedModeRef.current = feedMode;
  const userPrefsRef = useRef(userPrefs);
  userPrefsRef.current = userPrefs;

  // Accumulate events keyed by id; each entry carries a sort score.
  const accRef = useRef<Map<string, { item: FeedItem; score: number; contentTags: ContentTag[] }>>(new Map());

  const flush = () => {
    const mode = feedModeRef.current;
    const prefs = userPrefsRef.current;
    let entries = Array.from(accRef.current.values());

    if (mode === "for_you" && prefs.length > 0) {
      // Re-score with tag relevance
      entries = entries.map((e) => {
        const relevance = scoreContentRelevance(e.contentTags, prefs);
        return { ...e, score: e.score + relevance * 1000 };
      });
    } else if (mode === "explore") {
      // Boost by max tag counter (popular content first)
      entries = entries.map((e) => {
        const maxCounter = e.contentTags.reduce((m, t) => Math.max(m, t.counter), 0);
        return { ...e, score: e.score + maxCounter * 100 };
      });
    }

    const sorted = entries
      .sort((a, b) => b.score - a.score)
      .map((v) => v.item);
    setItems(sorted);
  };

  // Re-sort existing items when feedMode or userPrefs change
  useEffect(() => {
    if (accRef.current.size > 0) {
      flush();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedMode, userPrefs]);

  /** Detect NIP-10 reply: has an "e" tag with "reply" or "root" marker */
  const isReplyEvent = (event: NostrEvent): { isReply: boolean; replyToId?: string } => {
    if (event.kind !== KINDS.TEXT_NOTE) return { isReply: false };
    const replyTag = event.tags.find(t => t[0] === "e" && t[3] === "reply");
    const rootTag = event.tags.find(t => t[0] === "e" && t[3] === "root");
    // Deprecated positional: if there are any "e" tags at all, it's likely a reply
    const anyETag = event.tags.find(t => t[0] === "e");
    if (replyTag) return { isReply: true, replyToId: replyTag[1] };
    if (rootTag) return { isReply: true, replyToId: rootTag[1] };
    if (anyETag) return { isReply: true, replyToId: anyETag[1] };
    return { isReply: false };
  };

  /** Parse a kind:6 repost — content is the JSON-stringified original event */
  const parseRepost = (event: NostrEvent): FeedItem | null => {
    try {
      const inner = JSON.parse(event.content);
      if (!inner || !inner.id || !inner.pubkey || !inner.kind) return null;
      const innerItem: FeedItem = {
        id: inner.id,
        pubkey: inner.pubkey,
        kind: inner.kind,
        content: inner.content ?? "",
        created_at: inner.created_at ?? event.created_at,
        tags: inner.tags ?? [],
      };
      if (inner.kind === KINDS.ENTROPY_CHUNK_MAP) {
        try {
          innerItem.chunkMap = parseEntropyChunkMapTags(inner.tags);
          cacheChunkMap(innerItem.chunkMap);
        } catch { /* ignore malformed inner chunk map */ }
      }
      return innerItem;
    } catch {
      // content might be empty for generic reposts — use e-tag reference
      return null;
    }
  };

  const ingestEvent = (event: NostrEvent, boost: number) => {
    const score = event.created_at + boost;
    const existing = accRef.current.get(event.id);
    // If we already have the event at a higher score (follow-boosted), keep it.
    if (existing && existing.score >= score) return;

    // Skip replies from the main feed — they lack context and look confusing
    if (!options.authors) {
      const { isReply } = isReplyEvent(event);
      if (isReply) return;
    }

    const item: FeedItem = {
      id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      content: event.content,
      created_at: event.created_at,
      tags: event.tags,
    };

    let contentTags: ContentTag[] = [];

    // Handle kind:6 reposts (NIP-18)
    if (event.kind === KINDS.REPOST) {
      const inner = parseRepost(event);
      if (inner) {
        item.repostedEvent = inner;
        item.repostedBy = event.pubkey;
        // Surface the inner event's content tags for scoring
        if (inner.chunkMap?.entropyTags) {
          contentTags = inner.chunkMap.entropyTags;
        }
      } else {
        // Repost without parseable content — skip it
        return;
      }
    }

    // Extract #t tags from text notes so Explore/ForYou modes have data
    if (event.kind === KINDS.TEXT_NOTE && contentTags.length === 0) {
      const tTags = event.tags.filter(t => t[0] === "t" && t[1]);
      for (const t of tTags) {
        contentTags.push({ name: t[1].toLowerCase(), counter: 1, updatedAt: event.created_at });
      }
    }

    if (event.kind === KINDS.ENTROPY_CHUNK_MAP) {
      try {
        item.chunkMap = parseEntropyChunkMapTags(event.tags);
        console.log("[feed] parsed chunkMap:", {
          rootHash: item.chunkMap.rootHash.slice(0, 12) + "\u2026",
          chunks: item.chunkMap.chunks.length,
          mimeType: item.chunkMap.mimeType,
          size: item.chunkMap.size,
        });
        cacheChunkMap(item.chunkMap);
        contentTags = item.chunkMap.entropyTags ?? [];
      } catch (e) {
        console.warn("[feed] failed to parse chunk map for", event.id, e);
      }
    }

    // For profile pages, mark replies so PostCard can render context
    if (options.authors && event.kind === KINDS.TEXT_NOTE) {
      const reply = isReplyEvent(event);
      if (reply.isReply) {
        item.isReply = true;
        item.replyToId = reply.replyToId;
      }
    }

    accRef.current.set(event.id, { item, score, contentTags });
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
      // Split into three subscriptions:
      //  1. Media posts (kind:7001) — must have the entropy #t tag
      //  2. Text notes (kind:1)    — no tag filter, plain Nostr events
      //  3. Reposts (kind:6)       — no tag filter (reposts don't carry #t)
      const authorFilter = options.authors.length > 0 ? { authors: options.authors } : {};

      const mediaKinds  = kinds.filter(k => k !== KINDS.TEXT_NOTE && k !== KINDS.REPOST);
      const textKinds   = kinds.filter(k => k === KINDS.TEXT_NOTE);
      const repostKinds = kinds.filter(k => k === KINDS.REPOST);

      expectedEose = (mediaKinds.length > 0 ? 1 : 0) + (textKinds.length > 0 ? 1 : 0) + (repostKinds.length > 0 ? 1 : 0);
      if (expectedEose === 0) expectedEose = 1; // safety guard

      if (mediaKinds.length > 0) {
        subs.push(relayPool.subscribe(
          [{ kinds: mediaKinds, limit, "#t": networkTags, ...authorFilter }],
          (event: NostrEvent) => { ingestEvent(event, 0); flush(); },
          onEose
        ));
      }

      if (textKinds.length > 0) {
        subs.push(relayPool.subscribe(
          [{ kinds: textKinds, limit, ...authorFilter }],
          (event: NostrEvent) => { ingestEvent(event, 0); flush(); },
          onEose
        ));
      }

      if (repostKinds.length > 0) {
        subs.push(relayPool.subscribe(
          [{ kinds: repostKinds, limit, ...authorFilter }],
          (event: NostrEvent) => { ingestEvent(event, 0); flush(); },
          onEose
        ));
      }

    } else {
      // ── Home feed mode: follows-priority + global discovery ─────────────────
      // Always run global discovery so content is never hidden.
      // Follow-posts get a score boost so they float to the top.
      expectedEose = followSet.size > 0 ? 2 : 1;

      if (followSet.size > 0) {
        // 1. Follows + self (boosted)
        subs.push(relayPool.subscribe(
          [{ kinds, limit, ...(entropyOnly ? { "#t": networkTags } : {}), authors: [...followSet] }],
          (event: NostrEvent) => { ingestEvent(event, FOLLOW_BOOST_SECONDS); flush(); },
          onEose
        ));
      }

      // 2. Global discovery (no author filter, no boost)
      subs.push(relayPool.subscribe(
        [{ kinds, limit, ...(entropyOnly ? { "#t": networkTags } : {}) }],
        (event: NostrEvent) => { ingestEvent(event, 0); flush(); },
        onEose
      ));
    }

    return () => {
      console.log("[feed] unsubscribing");
      subs.forEach((s) => s.unsubscribe());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayPool, relayUrls.join(","), authorsKey, followsKey, kindsKey, networkTagsKey, limit, entropyOnly]);

  const loadMore = () => {
    console.log("[feed] loadMore not yet implemented");
  };

  /** Remove an event from the feed (e.g. after undoing a repost) */
  const removeItem = (eventId: string) => {
    if (accRef.current.delete(eventId)) {
      flush();
    }
  };

  return { items, isLoading, loadMore, removeItem };
}
