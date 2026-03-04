/**
 * Content tag management: CRUD, merge, cap 30, replacement policy.
 *
 * Each content can have up to MAX_CONTENT_TAGS tags. When a new tag arrives
 * and the cap is reached, the weakest tag (lowest counter, then oldest updatedAt)
 * is replaced if the new tag qualifies.
 */

import { assertValidTagName } from "./tag-validation";

export const MAX_CONTENT_TAGS = 30;

export interface ContentTag {
  name: string;
  counter: number;
  updatedAt: number;
}

function cloneTag(tag: ContentTag): ContentTag {
  return { name: tag.name, counter: tag.counter, updatedAt: tag.updatedAt };
}

function findWeakestIndex(tags: ContentTag[]): number {
  if (tags.length === 0) return -1;

  let weakest = 0;

  for (let i = 1; i < tags.length; i++) {
    const current = tags[i];
    const best = tags[weakest];

    if (
      current.counter < best.counter ||
      (current.counter === best.counter && current.updatedAt < best.updatedAt)
    ) {
      weakest = i;
    }
  }

  return weakest;
}

export function createContentTagSet(): ContentTag[] {
  return [];
}

export function addContentTag(
  tags: ContentTag[],
  name: string,
  timestamp?: number
): ContentTag[] {
  const normalized = assertValidTagName(name);
  const now = timestamp ?? Math.floor(Date.now() / 1000);
  const result = tags.map(cloneTag);

  const existing = result.find((t) => t.name === normalized);

  if (existing) {
    existing.counter += 1;
    existing.updatedAt = now;
    return result;
  }

  const newTag: ContentTag = { name: normalized, counter: 1, updatedAt: now };

  if (result.length < MAX_CONTENT_TAGS) {
    result.push(newTag);
    return result;
  }

  const weakestIdx = findWeakestIndex(result);

  if (weakestIdx === -1) {
    return result;
  }

  const weakest = result[weakestIdx];

  if (newTag.counter >= weakest.counter) {
    result[weakestIdx] = newTag;
  }

  return result;
}

export function mergeContentTags(
  local: ContentTag[],
  remote: ContentTag[]
): ContentTag[] {
  const merged = new Map<string, ContentTag>();

  for (const tag of local) {
    merged.set(tag.name, cloneTag(tag));
  }

  for (const tag of remote) {
    const existing = merged.get(tag.name);

    if (existing) {
      existing.counter = Math.max(existing.counter, tag.counter);
      existing.updatedAt = Math.max(existing.updatedAt, tag.updatedAt);
    } else {
      merged.set(tag.name, cloneTag(tag));
    }
  }

  let result = [...merged.values()];

  while (result.length > MAX_CONTENT_TAGS) {
    const weakestIdx = findWeakestIndex(result);

    if (weakestIdx === -1) break;

    result.splice(weakestIdx, 1);
  }

  return result;
}

export function getContentTag(tags: ContentTag[], name: string): ContentTag | undefined {
  const normalized = assertValidTagName(name);
  return tags.find((t) => t.name === normalized);
}

export function sortContentTagsByStrength(tags: ContentTag[]): ContentTag[] {
  return [...tags].sort((a, b) => {
    if (b.counter !== a.counter) return b.counter - a.counter;
    return b.updatedAt - a.updatedAt;
  });
}
