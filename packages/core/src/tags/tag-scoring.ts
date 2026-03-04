/**
 * Content scoring against user preferences for feed ranking.
 *
 * relevanceScore = Σ (pref.score × log2(tag.counter + 1))
 * finalScore = α·relevanceScore + β·recencyScore
 */

import type { ContentTag } from "./content-tags";
import type { UserTagPreference } from "./user-preferences";

export const DEFAULT_ALPHA = 0.6;
export const DEFAULT_BETA = 0.4;

export interface ScoringWeights {
  alpha: number;
  beta: number;
}

export interface ScoredContent {
  relevanceScore: number;
  recencyScore: number;
  finalScore: number;
}

export function scoreContentRelevance(
  contentTags: ContentTag[],
  userPrefs: UserTagPreference[]
): number {
  const prefMap = new Map(userPrefs.map((p) => [p.name, p]));
  let score = 0;

  for (const tag of contentTags) {
    const pref = prefMap.get(tag.name);

    if (pref) {
      score += pref.score * Math.log2(tag.counter + 1);
    }
  }

  return score;
}

export function scoreContent(
  contentTags: ContentTag[],
  userPrefs: UserTagPreference[],
  createdAt: number,
  now?: number,
  weights?: Partial<ScoringWeights>
): ScoredContent {
  const currentTime = now ?? Math.floor(Date.now() / 1000);
  const alpha = weights?.alpha ?? DEFAULT_ALPHA;
  const beta = weights?.beta ?? DEFAULT_BETA;

  const relevanceScore = scoreContentRelevance(contentTags, userPrefs);

  const age = Math.max(currentTime - createdAt, 1);
  const recencyScore = 1 / age;

  const finalScore = alpha * relevanceScore + beta * recencyScore;

  return { relevanceScore, recencyScore, finalScore };
}

export type FeedMode = "chronological" | "for_you" | "explore";

export interface FeedItem {
  rootHash: string;
  contentTags: ContentTag[];
  createdAt: number;
  [key: string]: unknown;
}

export function rankFeed(
  items: FeedItem[],
  userPrefs: UserTagPreference[],
  mode: FeedMode,
  options?: {
    now?: number;
    weights?: Partial<ScoringWeights>;
    negativeThreshold?: number;
  }
): FeedItem[] {
  const now = options?.now ?? Math.floor(Date.now() / 1000);
  const threshold = options?.negativeThreshold ?? -Infinity;

  if (mode === "chronological") {
    return [...items].sort((a, b) => b.createdAt - a.createdAt);
  }

  if (mode === "explore") {
    return [...items].sort((a, b) => {
      const aMax = Math.max(...a.contentTags.map((t) => t.counter), 0);
      const bMax = Math.max(...b.contentTags.map((t) => t.counter), 0);

      if (bMax !== aMax) return bMax - aMax;
      return b.createdAt - a.createdAt;
    });
  }

  // mode === "for_you"
  const scored = items.map((item) => {
    const result = scoreContent(
      item.contentTags,
      userPrefs,
      item.createdAt,
      now,
      options?.weights
    );

    return { item, ...result };
  });

  return scored
    .filter((s) => s.relevanceScore >= threshold)
    .sort((a, b) => b.finalScore - a.finalScore)
    .map((s) => s.item);
}
