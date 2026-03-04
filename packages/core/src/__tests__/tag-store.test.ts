import { describe, expect, it, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";

import { IndexedDbTagStore } from "../tags/tag-store";
import type { ContentTag } from "../tags/content-tags";
import type { UserTagPreference } from "../tags/user-preferences";

const ROOT_HASH_A = "aa".repeat(32);
const ROOT_HASH_B = "bb".repeat(32);
const T1 = 1700000000;

let store: IndexedDbTagStore;

beforeEach(() => {
  store = new IndexedDbTagStore(`test-tags-${Date.now()}-${Math.random()}`);
});

afterEach(() => {
  store.close();
});

describe("content tags", () => {
  it("returns empty array for unknown rootHash", async () => {
    const tags = await store.getContentTags(ROOT_HASH_A);
    expect(tags).toEqual([]);
  });

  it("stores and retrieves content tags", async () => {
    const tags: ContentTag[] = [
      { name: "rock", counter: 3, updatedAt: T1 },
      { name: "música", counter: 1, updatedAt: T1 }
    ];

    await store.setContentTags(ROOT_HASH_A, tags);
    const retrieved = await store.getContentTags(ROOT_HASH_A);

    expect(retrieved).toHaveLength(2);
    expect(retrieved.find((t) => t.name === "rock")).toEqual({
      name: "rock",
      counter: 3,
      updatedAt: T1
    });
  });

  it("replaces existing tags on setContentTags", async () => {
    await store.setContentTags(ROOT_HASH_A, [
      { name: "old", counter: 1, updatedAt: T1 }
    ]);

    await store.setContentTags(ROOT_HASH_A, [
      { name: "new", counter: 2, updatedAt: T1 + 100 }
    ]);

    const tags = await store.getContentTags(ROOT_HASH_A);
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe("new");
  });

  it("isolates tags by rootHash", async () => {
    await store.setContentTags(ROOT_HASH_A, [
      { name: "rock", counter: 1, updatedAt: T1 }
    ]);
    await store.setContentTags(ROOT_HASH_B, [
      { name: "jazz", counter: 2, updatedAt: T1 }
    ]);

    const tagsA = await store.getContentTags(ROOT_HASH_A);
    const tagsB = await store.getContentTags(ROOT_HASH_B);

    expect(tagsA).toHaveLength(1);
    expect(tagsA[0].name).toBe("rock");
    expect(tagsB).toHaveLength(1);
    expect(tagsB[0].name).toBe("jazz");
  });
});

describe("user preferences", () => {
  it("returns empty array initially", async () => {
    const prefs = await store.getUserPreferences();
    expect(prefs).toEqual([]);
  });

  it("stores and retrieves preferences", async () => {
    const prefs: UserTagPreference[] = [
      { name: "rock", score: 5, updatedAt: T1 },
      { name: "jazz", score: -1, updatedAt: T1 }
    ];

    await store.setUserPreferences(prefs);
    const retrieved = await store.getUserPreferences();

    expect(retrieved).toHaveLength(2);
    expect(retrieved.find((p) => p.name === "rock")?.score).toBe(5);
    expect(retrieved.find((p) => p.name === "jazz")?.score).toBe(-1);
  });

  it("replaces all preferences on setUserPreferences", async () => {
    await store.setUserPreferences([
      { name: "old", score: 1, updatedAt: T1 }
    ]);

    await store.setUserPreferences([
      { name: "new", score: 3, updatedAt: T1 + 100 }
    ]);

    const prefs = await store.getUserPreferences();
    expect(prefs).toHaveLength(1);
    expect(prefs[0].name).toBe("new");
  });
});

describe("tag actions", () => {
  it("returns false for un-tagged content", async () => {
    expect(await store.hasTaggedContent(ROOT_HASH_A)).toBe(false);
  });

  it("records and checks tag action", async () => {
    await store.recordTagAction(ROOT_HASH_A, "rock");

    expect(await store.hasTaggedContent(ROOT_HASH_A)).toBe(true);
    expect(await store.hasTaggedContent(ROOT_HASH_B)).toBe(false);
  });

  it("retrieves tag action details", async () => {
    await store.recordTagAction(ROOT_HASH_A, "jazz");
    const action = await store.getTagAction(ROOT_HASH_A);

    expect(action).not.toBeNull();
    expect(action!.tag).toBe("jazz");
    expect(action!.rootHash).toBe(ROOT_HASH_A);
    expect(action!.taggedAt).toBeGreaterThan(0);
  });

  it("returns null for missing action", async () => {
    expect(await store.getTagAction(ROOT_HASH_A)).toBeNull();
  });

  it("overwrites previous tag action for same rootHash", async () => {
    await store.recordTagAction(ROOT_HASH_A, "rock");
    await store.recordTagAction(ROOT_HASH_A, "jazz");

    const action = await store.getTagAction(ROOT_HASH_A);
    expect(action!.tag).toBe("jazz");
  });
});
