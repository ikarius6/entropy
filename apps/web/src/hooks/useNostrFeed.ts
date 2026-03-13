import { useCallback, useEffect, useRef, useState } from "react";
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

/** How many events to request per subscription page. Keeps initial load small. */
const PAGE_SIZE = 20;

/** Milliseconds to wait after the last event arrives before committing to state.
 *  Coalesces event bursts into a single React render. */
const FLUSH_DEBOUNCE_MS = 120;

export function useNostrFeed(options: UseNostrFeedOptions = {}) {
  const { pubkey, relayPool, relayUrls, cacheChunkMap, networkTags } = useEntropyStore();
  const { follows: myFollows } = useContactList(pubkey);

  const kinds = options.kinds ?? [KINDS.TEXT_NOTE, KINDS.ENTROPY_CHUNK_MAP, KINDS.REPOST];
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

  // --- Debounced flush -------------------------------------------------------
  // Only re-sort & commit to React state after a quiet period, so event bursts
  // from the relay don't each trigger their own full re-render.
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    const mode = feedModeRef.current;
    const prefs = userPrefsRef.current;
    let entries = Array.from(accRef.current.values());

    if (mode === "for_you" && prefs.length > 0) {
      entries = entries.map((e) => {
        const relevance = scoreContentRelevance(e.contentTags, prefs);
        return { ...e, score: e.score + relevance * 1000 };
      });
    } else if (mode === "explore") {
      entries = entries.map((e) => {
        const maxCounter = e.contentTags.reduce((m, t) => Math.max(m, t.counter), 0);
        return { ...e, score: e.score + maxCounter * 100 };
      });
    }

    const sorted = entries
      .sort((a, b) => b.score - a.score)
      .map((v) => v.item);
    setItems(sorted);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
    }
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flush();
    }, FLUSH_DEBOUNCE_MS);
  }, [flush]);

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
          rootHash: item.chunkMap.rootHash.slice(0, 12) + "…",
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

  // Track active "loadMore" subscriptions so we can unsubscribe them
  const loadMoreSubsRef = useRef<{ unsubscribe: () => void }[]>([]);

  // Ref to the EOSE awaiting counter for the initial load
  const eoseCountRef = useRef(0);
  const expectedEoseRef = useRef(0);

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
    eoseCountRef.current = 0;

    const subs: { unsubscribe: () => void }[] = [];

    const onEose = () => {
      eoseCountRef.current++;
      if (eoseCountRef.current >= expectedEoseRef.current) {
        console.log("[feed] all EOSE received, total events:", accRef.current.size);
        // Flush immediately on EOSE (don't wait for the debounce timer)
        if (flushTimerRef.current !== null) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        flush();
        setIsLoading(false);
      }
    };

    if (options.authors !== undefined) {
      // ── Explicit authors mode (profile page, etc.) ──────────────────────────
      const authorFilter = options.authors.length > 0 ? { authors: options.authors } : {};
      const mediaKinds  = kinds.filter(k => k !== KINDS.TEXT_NOTE && k !== KINDS.REPOST);
      const textKinds   = kinds.filter(k => k === KINDS.TEXT_NOTE);
      const repostKinds = kinds.filter(k => k === KINDS.REPOST);

      expectedEoseRef.current = (mediaKinds.length > 0 ? 1 : 0) + (textKinds.length > 0 ? 1 : 0) + (repostKinds.length > 0 ? 1 : 0);
      if (expectedEoseRef.current === 0) expectedEoseRef.current = 1;

      if (mediaKinds.length > 0) {
        subs.push(relayPool.subscribe(
          [{ kinds: mediaKinds, limit: PAGE_SIZE, "#t": networkTags, ...authorFilter }],
          (event: NostrEvent) => { ingestEvent(event, 0); scheduleFlush(); },
          onEose
        ));
      }

      if (textKinds.length > 0) {
        subs.push(relayPool.subscribe(
          [{ kinds: textKinds, limit: PAGE_SIZE, ...authorFilter }],
          (event: NostrEvent) => { ingestEvent(event, 0); scheduleFlush(); },
          onEose
        ));
      }

      if (repostKinds.length > 0) {
        subs.push(relayPool.subscribe(
          [{ kinds: repostKinds, limit: PAGE_SIZE, ...authorFilter }],
          (event: NostrEvent) => { ingestEvent(event, 0); scheduleFlush(); },
          onEose
        ));
      }

    } else {
      // ── Home feed mode: follows-priority + global discovery ─────────────────
      expectedEoseRef.current = followSet.size > 0 ? 2 : 1;

      if (followSet.size > 0) {
        // 1. Follows + self (boosted)
        subs.push(relayPool.subscribe(
          [{ kinds, limit: PAGE_SIZE, ...(entropyOnly ? { "#t": networkTags } : {}), authors: [...followSet] }],
          (event: NostrEvent) => { ingestEvent(event, FOLLOW_BOOST_SECONDS); scheduleFlush(); },
          onEose
        ));
      }

      // 2. Global discovery (no author filter, no boost)
      subs.push(relayPool.subscribe(
        [{ kinds, limit: PAGE_SIZE, ...(entropyOnly ? { "#t": networkTags } : {}) }],
        (event: NostrEvent) => { ingestEvent(event, 0); scheduleFlush(); },
        onEose
      ));
    }

    return () => {
      console.log("[feed] unsubscribing");
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      subs.forEach((s) => s.unsubscribe());
      // Also clean up any dangling loadMore subs
      loadMoreSubsRef.current.forEach((s) => s.unsubscribe());
      loadMoreSubsRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayPool, relayUrls.join(","), authorsKey, followsKey, kindsKey, networkTagsKey, entropyOnly]);

  // ---------------------------------------------------------------------------
  // loadMore — cursor-based pagination using the `until:` relay filter field.
  // Finds the oldest event currently accumulated and requests the next page
  // of events that are older than that timestamp.
  // ---------------------------------------------------------------------------
  const loadMore = useCallback(() => {
    if (!relayPool || relayUrls.length === 0) return;
    if (kinds.length === 0) return;

    // Find the oldest created_at among currently accumulated events
    const allEntries = Array.from(accRef.current.values());
    if (allEntries.length === 0) return;

    // Use raw created_at (before boost) as the cursor — take the min
    const oldestTimestamp = allEntries.reduce(
      (min, e) => Math.min(min, e.item.created_at),
      Infinity
    );

    console.log("[feed] loadMore — until:", new Date(oldestTimestamp * 1000).toISOString());
    setIsLoading(true);

    // Clean up previous loadMore subs before opening new ones
    loadMoreSubsRef.current.forEach((s) => s.unsubscribe());
    loadMoreSubsRef.current = [];

    let eoseCount = 0;
    let expectedEose: number;

    const onEose = () => {
      eoseCount++;
      if (eoseCount >= expectedEose) {
        if (flushTimerRef.current !== null) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        flush();
        setIsLoading(false);
      }
    };

    if (options.authors !== undefined) {
      const authorFilter = options.authors.length > 0 ? { authors: options.authors } : {};
      const mediaKinds  = kinds.filter(k => k !== KINDS.TEXT_NOTE && k !== KINDS.REPOST);
      const textKinds   = kinds.filter(k => k === KINDS.TEXT_NOTE);
      const repostKinds = kinds.filter(k => k === KINDS.REPOST);

      expectedEose = (mediaKinds.length > 0 ? 1 : 0) + (textKinds.length > 0 ? 1 : 0) + (repostKinds.length > 0 ? 1 : 0);
      if (expectedEose === 0) expectedEose = 1;

      if (mediaKinds.length > 0) {
        loadMoreSubsRef.current.push(relayPool.subscribe(
          [{ kinds: mediaKinds, limit: PAGE_SIZE, until: oldestTimestamp - 1, "#t": networkTags, ...authorFilter }],
          (event: NostrEvent) => { ingestEvent(event, 0); scheduleFlush(); },
          onEose
        ));
      }
      if (textKinds.length > 0) {
        loadMoreSubsRef.current.push(relayPool.subscribe(
          [{ kinds: textKinds, limit: PAGE_SIZE, until: oldestTimestamp - 1, ...authorFilter }],
          (event: NostrEvent) => { ingestEvent(event, 0); scheduleFlush(); },
          onEose
        ));
      }
      if (repostKinds.length > 0) {
        loadMoreSubsRef.current.push(relayPool.subscribe(
          [{ kinds: repostKinds, limit: PAGE_SIZE, until: oldestTimestamp - 1, ...authorFilter }],
          (event: NostrEvent) => { ingestEvent(event, 0); scheduleFlush(); },
          onEose
        ));
      }
    } else {
      expectedEose = followSet.size > 0 ? 2 : 1;
      if (followSet.size > 0) {
        loadMoreSubsRef.current.push(relayPool.subscribe(
          [{ kinds, limit: PAGE_SIZE, until: oldestTimestamp - 1, ...(entropyOnly ? { "#t": networkTags } : {}), authors: [...followSet] }],
          (event: NostrEvent) => { ingestEvent(event, FOLLOW_BOOST_SECONDS); scheduleFlush(); },
          onEose
        ));
      }
      loadMoreSubsRef.current.push(relayPool.subscribe(
        [{ kinds, limit: PAGE_SIZE, until: oldestTimestamp - 1, ...(entropyOnly ? { "#t": networkTags } : {}) }],
        (event: NostrEvent) => { ingestEvent(event, 0); scheduleFlush(); },
        onEose
      ));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayPool, relayUrls, kinds, entropyOnly, networkTags, followSet, options.authors, scheduleFlush, flush]);

  /** Remove an event from the feed (e.g. after undoing a repost) */
  const removeItem = (eventId: string) => {
    if (accRef.current.delete(eventId)) {
      flush();
    }
  };

  return { items, isLoading, loadMore, removeItem };
}
