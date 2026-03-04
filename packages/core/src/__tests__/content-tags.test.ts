import { describe, expect, it } from "vitest";

import {
  MAX_CONTENT_TAGS,
  createContentTagSet,
  addContentTag,
  mergeContentTags,
  getContentTag,
  sortContentTagsByStrength,
  type ContentTag
} from "../tags/content-tags";

const T1 = 1700000000;
const T2 = 1700003600;
const T3 = 1700007200;

describe("createContentTagSet", () => {
  it("returns empty array", () => {
    expect(createContentTagSet()).toEqual([]);
  });
});

describe("addContentTag", () => {
  it("adds a new tag with counter 1", () => {
    const tags = addContentTag([], "música", T1);

    expect(tags).toHaveLength(1);
    expect(tags[0]).toEqual({ name: "música", counter: 1, updatedAt: T1 });
  });

  it("increments counter of existing tag", () => {
    let tags = addContentTag([], "música", T1);
    tags = addContentTag(tags, "música", T2);

    expect(tags).toHaveLength(1);
    expect(tags[0]).toEqual({ name: "música", counter: 2, updatedAt: T2 });
  });

  it("normalizes tag name", () => {
    const tags = addContentTag([], "  ROCK  ", T1);

    expect(tags[0].name).toBe("rock");
  });

  it("adds different tags separately", () => {
    let tags = addContentTag([], "música", T1);
    tags = addContentTag(tags, "reggaeton", T2);

    expect(tags).toHaveLength(2);
  });

  it("replaces weakest tag when cap reached", () => {
    let tags: ContentTag[] = [];

    // Fill to capacity with tags counter=1
    for (let i = 0; i < MAX_CONTENT_TAGS; i++) {
      tags = addContentTag(tags, `tag${String(i).padStart(2, "0")}`, T1 + i);
    }

    expect(tags).toHaveLength(MAX_CONTENT_TAGS);

    // Add a new tag — should replace the weakest (tag00, counter=1, oldest updatedAt)
    tags = addContentTag(tags, "newtag", T3);

    expect(tags).toHaveLength(MAX_CONTENT_TAGS);
    expect(tags.find((t) => t.name === "newtag")).toBeDefined();
    expect(tags.find((t) => t.name === "tag00")).toBeUndefined();
  });

  it("does not replace tags with higher counter", () => {
    let tags: ContentTag[] = [];

    for (let i = 0; i < MAX_CONTENT_TAGS; i++) {
      tags = addContentTag(tags, `tag${i}`, T1);
      // Increment all tags to counter 5
      for (let j = 0; j < 4; j++) {
        tags = addContentTag(tags, `tag${i}`, T1 + j + 1);
      }
    }

    // All tags have counter 5, new tag has counter 1
    // But the replacement policy checks: newTag.counter (1) >= weakest.counter (5) → false
    // Wait, actually the replacement always adds with counter=1 and checks if 1 >= weakest counter
    // Since all have counter 5, 1 < 5 → new tag should NOT be added
    const before = tags.map((t) => t.name).sort();
    tags = addContentTag(tags, "newcomer", T3);
    const after = tags.map((t) => t.name).sort();

    expect(after).toEqual(before);
  });
});

describe("mergeContentTags", () => {
  it("merges two disjoint sets", () => {
    const local: ContentTag[] = [{ name: "rock", counter: 2, updatedAt: T1 }];
    const remote: ContentTag[] = [{ name: "pop", counter: 1, updatedAt: T2 }];

    const merged = mergeContentTags(local, remote);

    expect(merged).toHaveLength(2);
    expect(merged.find((t) => t.name === "rock")).toEqual({ name: "rock", counter: 2, updatedAt: T1 });
    expect(merged.find((t) => t.name === "pop")).toEqual({ name: "pop", counter: 1, updatedAt: T2 });
  });

  it("takes max counter and updatedAt for overlapping tags", () => {
    const local: ContentTag[] = [{ name: "música", counter: 3, updatedAt: T1 }];
    const remote: ContentTag[] = [{ name: "música", counter: 2, updatedAt: T2 }];

    const merged = mergeContentTags(local, remote);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({ name: "música", counter: 3, updatedAt: T2 });
  });

  it("caps result at MAX_CONTENT_TAGS", () => {
    const local: ContentTag[] = [];
    const remote: ContentTag[] = [];

    for (let i = 0; i < 20; i++) {
      local.push({ name: `local${i}`, counter: 1, updatedAt: T1 });
    }
    for (let i = 0; i < 20; i++) {
      remote.push({ name: `remote${i}`, counter: 1, updatedAt: T1 });
    }

    const merged = mergeContentTags(local, remote);

    expect(merged.length).toBeLessThanOrEqual(MAX_CONTENT_TAGS);
  });

  it("preserves stronger tags when evicting", () => {
    const local: ContentTag[] = [];
    const remote: ContentTag[] = [];

    // 20 local tags with counter=5
    for (let i = 0; i < 20; i++) {
      local.push({ name: `strong${i}`, counter: 5, updatedAt: T1 });
    }
    // 20 remote tags with counter=1
    for (let i = 0; i < 20; i++) {
      remote.push({ name: `weak${i}`, counter: 1, updatedAt: T1 });
    }

    const merged = mergeContentTags(local, remote);

    // All strong tags should survive
    for (let i = 0; i < 20; i++) {
      expect(merged.find((t) => t.name === `strong${i}`)).toBeDefined();
    }
  });
});

describe("getContentTag", () => {
  it("finds existing tag by name", () => {
    const tags: ContentTag[] = [{ name: "rock", counter: 3, updatedAt: T1 }];

    expect(getContentTag(tags, "rock")).toEqual(tags[0]);
  });

  it("returns undefined for missing tag", () => {
    expect(getContentTag([], "rock")).toBeUndefined();
  });

  it("normalizes search name", () => {
    const tags: ContentTag[] = [{ name: "rock", counter: 1, updatedAt: T1 }];

    expect(getContentTag(tags, "  ROCK  ")).toEqual(tags[0]);
  });
});

describe("sortContentTagsByStrength", () => {
  it("sorts by counter desc, then updatedAt desc", () => {
    const tags: ContentTag[] = [
      { name: "a", counter: 1, updatedAt: T1 },
      { name: "b", counter: 5, updatedAt: T2 },
      { name: "c", counter: 5, updatedAt: T3 },
      { name: "d", counter: 2, updatedAt: T1 }
    ];

    const sorted = sortContentTagsByStrength(tags);

    expect(sorted.map((t) => t.name)).toEqual(["c", "b", "d", "a"]);
  });

  it("does not mutate original array", () => {
    const tags: ContentTag[] = [
      { name: "a", counter: 1, updatedAt: T1 },
      { name: "b", counter: 2, updatedAt: T2 }
    ];

    sortContentTagsByStrength(tags);

    expect(tags[0].name).toBe("a");
  });
});
