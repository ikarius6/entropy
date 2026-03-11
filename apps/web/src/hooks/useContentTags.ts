import { useEffect, useRef, useState, useCallback } from "react";
import { useEntropyStore } from "../stores/entropy-store";
import { KINDS } from "../lib/constants";
import type { ContentTag } from "@entropy/core";
import { parseTagVoteTags } from "@entropy/core";
import type { NostrEvent } from "@entropy/core";

interface ContentTagsResult {
  /** Aggregated tags from all tag-vote events for this content */
  tags: ContentTag[];
  /** Whether the current user has already published a tag vote */
  userTagged: boolean;
  /** The tag name the current user voted for (if any) */
  userTag: string | null;
}

/**
 * Subscribes to kind:37001 tag-vote events for a given rootHash.
 * Returns aggregated ContentTag[] (one entry per unique tag name,
 * counter = number of distinct voters) and current-user status.
 */
export function useContentTags(rootHash: string | null): ContentTagsResult {
  const { relayPool, relayUrls, pubkey } = useEntropyStore();

  // pubkey → tagName
  const votesRef = useRef<Map<string, string>>(new Map());
  const [tags, setTags] = useState<ContentTag[]>([]);
  const [userTagged, setUserTagged] = useState(false);
  const [userTag, setUserTag] = useState<string | null>(null);

  const rebuild = useCallback(() => {
    // Aggregate: count votes per tag name
    const counts = new Map<string, { count: number; latestAt: number }>();
    let myTag: string | null = null;

    for (const [voterPubkey, tagName] of votesRef.current) {
      if (!tagName) continue;
      const existing = counts.get(tagName) ?? { count: 0, latestAt: 0 };
      existing.count += 1;
      existing.latestAt = Math.max(existing.latestAt, Math.floor(Date.now() / 1000));
      counts.set(tagName, existing);
      if (voterPubkey === pubkey) myTag = tagName;
    }

    const aggregated: ContentTag[] = [];
    for (const [name, { count, latestAt }] of counts) {
      aggregated.push({ name, counter: count, updatedAt: latestAt });
    }

    setTags(aggregated);
    setUserTagged(myTag !== null);
    setUserTag(myTag);
  }, [pubkey]);

  useEffect(() => {
    if (!relayPool || relayUrls.length === 0 || !rootHash) return;

    votesRef.current = new Map();
    setTags([]);
    setUserTagged(false);
    setUserTag(null);

    const sub = relayPool.subscribe(
      [{ kinds: [KINDS.ENTROPY_TAG_VOTE], "#d": [rootHash], limit: 200 }],
      (event: NostrEvent) => {
        try {
          const parsed = parseTagVoteTags(event.tags);
          if (!parsed.tagName) return;
          // Parameterized replaceable: keep latest per pubkey
          votesRef.current.set(event.pubkey, parsed.tagName);
          rebuild();
        } catch {
          // Malformed event — skip
        }
      },
      () => {} // EOSE
    );

    return () => sub.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayPool, relayUrls.join(","), rootHash]);

  return { tags, userTagged, userTag };
}
