import { describe, expect, it } from "vitest";

import {
  DEFAULT_ALPHA,
  DEFAULT_BETA,
  scoreContentRelevance,
  scoreContent,
  rankFeed,
  type FeedItem
} from "../tags/tag-scoring";
import type { ContentTag } from "../tags/content-tags";
import type { UserTagPreference } from "../tags/user-preferences";

const T1 = 1700000000;
const T2 = 1700003600;
const NOW = 1700010000;

function makeTags(entries: [string, number][]): ContentTag[] {
  return entries.map(([name, counter]) => ({ name, counter, updatedAt: T1 }));
}

function makePrefs(entries: [string, number][]): UserTagPreference[] {
  return entries.map(([name, score]) => ({ name, score, updatedAt: T1 }));
}

describe("scoreContentRelevance", () => {
  it("returns 0 for no matching tags", () => {
    const tags = makeTags([["rock", 5]]);
    const prefs = makePrefs([["jazz", 3]]);

    expect(scoreContentRelevance(tags, prefs)).toBe(0);
  });

  it("returns 0 for empty inputs", () => {
    expect(scoreContentRelevance([], [])).toBe(0);
    expect(scoreContentRelevance(makeTags([["rock", 5]]), [])).toBe(0);
    expect(scoreContentRelevance([], makePrefs([["rock", 3]]))).toBe(0);
  });

  it("calculates score as pref.score × log2(tag.counter + 1)", () => {
    const tags = makeTags([["surf", 30]]);
    const prefs = makePrefs([["surf", 3]]);

    const expected = 3 * Math.log2(31);
    expect(scoreContentRelevance(tags, prefs)).toBeCloseTo(expected);
  });

  it("sums scores across multiple matching tags", () => {
    const tags = makeTags([["surf", 30], ["travel", 3]]);
    const prefs = makePrefs([["surf", 3], ["travel", 2]]);

    const expected = 3 * Math.log2(31) + 2 * Math.log2(4);
    expect(scoreContentRelevance(tags, prefs)).toBeCloseTo(expected);
  });

  it("handles negative preference scores", () => {
    const tags = makeTags([["reggaeton", 10]]);
    const prefs = makePrefs([["reggaeton", -2]]);

    expect(scoreContentRelevance(tags, prefs)).toBeLessThan(0);
  });
});

describe("scoreContent", () => {
  it("returns relevance, recency, and final scores", () => {
    const tags = makeTags([["rock", 5]]);
    const prefs = makePrefs([["rock", 2]]);

    const result = scoreContent(tags, prefs, T1, NOW);

    expect(result.relevanceScore).toBeCloseTo(2 * Math.log2(6));
    expect(result.recencyScore).toBeCloseTo(1 / (NOW - T1));
    expect(result.finalScore).toBeCloseTo(
      DEFAULT_ALPHA * result.relevanceScore + DEFAULT_BETA * result.recencyScore
    );
  });

  it("respects custom weights", () => {
    const tags = makeTags([["rock", 5]]);
    const prefs = makePrefs([["rock", 2]]);

    const result = scoreContent(tags, prefs, T1, NOW, { alpha: 1.0, beta: 0.0 });

    expect(result.finalScore).toBeCloseTo(result.relevanceScore);
  });

  it("uses age of at least 1 second", () => {
    const tags = makeTags([["rock", 5]]);
    const prefs = makePrefs([["rock", 2]]);

    const result = scoreContent(tags, prefs, NOW, NOW);

    expect(result.recencyScore).toBe(1);
  });
});

describe("rankFeed", () => {
  const items: FeedItem[] = [
    { rootHash: "a", contentTags: makeTags([["rock", 10]]), createdAt: T1 },
    { rootHash: "b", contentTags: makeTags([["jazz", 5]]), createdAt: T2 },
    { rootHash: "c", contentTags: makeTags([["rock", 20], ["jazz", 3]]), createdAt: T1 + 1000 }
  ];

  it("chronological mode sorts by createdAt desc", () => {
    const ranked = rankFeed(items, [], "chronological", { now: NOW });

    expect(ranked.map((i) => i.rootHash)).toEqual(["b", "c", "a"]);
  });

  it("for_you mode uses scoring", () => {
    const prefs = makePrefs([["rock", 5]]);
    const ranked = rankFeed(items, prefs, "for_you", { now: NOW });

    // "c" has rock:20 → highest relevance
    expect(ranked[0].rootHash).toBe("c");
  });

  it("for_you mode filters by negative threshold", () => {
    const prefs = makePrefs([["rock", -5]]);
    const ranked = rankFeed(items, prefs, "for_you", { now: NOW, negativeThreshold: -10 });

    // Items with rock have very negative relevance; only jazz item survives if above threshold
    const hasNegative = ranked.some((i) => {
      const score = scoreContentRelevance(i.contentTags, prefs);
      return score < -10;
    });
    expect(hasNegative).toBe(false);
  });

  it("explore mode sorts by max counter desc", () => {
    const ranked = rankFeed(items, [], "explore", { now: NOW });

    // "c" has max counter 20, "a" has 10, "b" has 5
    expect(ranked.map((i) => i.rootHash)).toEqual(["c", "a", "b"]);
  });

  it("does not mutate original array", () => {
    const original = [...items];
    rankFeed(items, [], "chronological");
    expect(items.map((i) => i.rootHash)).toEqual(original.map((i) => i.rootHash));
  });
});
