import { describe, expect, it } from "vitest";

import {
  MAX_USER_TAG_PREFERENCES,
  STALE_THRESHOLD_SECONDS,
  DEFAULT_SIGNAL_WEIGHTS,
  createUserPreferences,
  applySignal,
  purgeStalePreferences,
  getUserPreference,
  sortPreferencesByRelevance,
  type UserTagPreference
} from "../tags/user-preferences";
import type { ContentTag } from "../tags/content-tags";

const T1 = 1700000000;
const T2 = 1700003600;

function makeTags(...names: string[]): ContentTag[] {
  return names.map((name) => ({ name, counter: 5, updatedAt: T1 }));
}

describe("createUserPreferences", () => {
  it("returns empty array", () => {
    expect(createUserPreferences()).toEqual([]);
  });
});

describe("applySignal", () => {
  it("creates new preferences from like signal", () => {
    const tags = makeTags("rock", "música");
    const prefs = applySignal([], tags, "like", undefined, T1);

    expect(prefs).toHaveLength(2);
    expect(getUserPreference(prefs, "rock")).toEqual({
      name: "rock",
      score: DEFAULT_SIGNAL_WEIGHTS.like,
      updatedAt: T1
    });
  });

  it("increments existing preference scores", () => {
    const tags = makeTags("rock");
    let prefs = applySignal([], tags, "like", undefined, T1);
    prefs = applySignal(prefs, tags, "like", undefined, T2);

    expect(getUserPreference(prefs, "rock")?.score).toBe(2);
    expect(getUserPreference(prefs, "rock")?.updatedAt).toBe(T2);
  });

  it("applies share signal with weight 2", () => {
    const tags = makeTags("jazz");
    const prefs = applySignal([], tags, "share", undefined, T1);

    expect(getUserPreference(prefs, "jazz")?.score).toBe(2);
  });

  it("applies not_interested signal with negative weight", () => {
    const tags = makeTags("reggaeton");
    const prefs = applySignal([], tags, "not_interested", undefined, T1);

    expect(getUserPreference(prefs, "reggaeton")?.score).toBe(-1);
  });

  it("applies block signal with weight -3", () => {
    const tags = makeTags("spam");
    const prefs = applySignal([], tags, "block", undefined, T1);

    expect(getUserPreference(prefs, "spam")?.score).toBe(-3);
  });

  it("respects custom weights", () => {
    const tags = makeTags("custom");
    const prefs = applySignal([], tags, "like", { like: 10 }, T1);

    expect(getUserPreference(prefs, "custom")?.score).toBe(10);
  });

  it("caps preferences at MAX_USER_TAG_PREFERENCES", () => {
    let prefs: UserTagPreference[] = [];

    // Fill to capacity
    for (let i = 0; i < MAX_USER_TAG_PREFERENCES; i++) {
      prefs = applySignal(prefs, makeTags(`tag${i}`), "like", undefined, T1);
    }

    expect(prefs).toHaveLength(MAX_USER_TAG_PREFERENCES);

    // Apply signal with new tag — should evict weakest
    prefs = applySignal(prefs, makeTags("newcomer"), "share", undefined, T2);

    expect(prefs).toHaveLength(MAX_USER_TAG_PREFERENCES);
    expect(getUserPreference(prefs, "newcomer")).toBeDefined();
  });

  it("does not mutate original array", () => {
    const original: UserTagPreference[] = [
      { name: "rock", score: 1, updatedAt: T1 }
    ];
    const tags = makeTags("rock");

    applySignal(original, tags, "like", undefined, T2);

    expect(original[0].score).toBe(1);
  });

  it("applies signal to all content tags at once", () => {
    const tags = makeTags("a", "b", "c");
    const prefs = applySignal([], tags, "like", undefined, T1);

    expect(prefs).toHaveLength(3);
    expect(prefs.every((p) => p.score === 1)).toBe(true);
  });
});

describe("purgeStalePreferences", () => {
  it("removes stale preferences with score 0", () => {
    const now = T1 + STALE_THRESHOLD_SECONDS + 1;
    const prefs: UserTagPreference[] = [
      { name: "stale", score: 0, updatedAt: T1 },
      { name: "active", score: 5, updatedAt: T1 }
    ];

    const purged = purgeStalePreferences(prefs, now);

    expect(purged).toHaveLength(1);
    expect(purged[0].name).toBe("active");
  });

  it("keeps score-0 preferences that are recent", () => {
    const prefs: UserTagPreference[] = [
      { name: "recent-zero", score: 0, updatedAt: T1 }
    ];

    const purged = purgeStalePreferences(prefs, T1 + 100);

    expect(purged).toHaveLength(1);
  });

  it("keeps non-zero preferences regardless of age", () => {
    const now = T1 + STALE_THRESHOLD_SECONDS + 999999;
    const prefs: UserTagPreference[] = [
      { name: "old-positive", score: 3, updatedAt: T1 },
      { name: "old-negative", score: -2, updatedAt: T1 }
    ];

    const purged = purgeStalePreferences(prefs, now);

    expect(purged).toHaveLength(2);
  });

  it("supports custom threshold", () => {
    const prefs: UserTagPreference[] = [
      { name: "stale", score: 0, updatedAt: T1 }
    ];

    const purged = purgeStalePreferences(prefs, T1 + 100, 50);

    expect(purged).toHaveLength(0);
  });
});

describe("sortPreferencesByRelevance", () => {
  it("sorts by absolute score desc, then updatedAt desc", () => {
    const prefs: UserTagPreference[] = [
      { name: "a", score: 1, updatedAt: T1 },
      { name: "b", score: -5, updatedAt: T1 },
      { name: "c", score: 3, updatedAt: T2 },
      { name: "d", score: 3, updatedAt: T1 }
    ];

    const sorted = sortPreferencesByRelevance(prefs);

    expect(sorted.map((p) => p.name)).toEqual(["b", "c", "d", "a"]);
  });
});
