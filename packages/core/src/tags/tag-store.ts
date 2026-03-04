/**
 * IndexedDB persistence for content tags, user preferences, and tag actions.
 * Uses Dexie.js for ergonomic access.
 */

import Dexie, { type Table } from "dexie";

import type { ContentTag } from "./content-tags";
import type { UserTagPreference } from "./user-preferences";

export const TAG_STORE_DB_NAME = "entropy-tags";
export const TAG_STORE_DB_VERSION = 1;

export interface ContentTagRecord {
  id: string;           // `${rootHash}:${tagName}` — composite PK
  rootHash: string;
  name: string;
  counter: number;
  updatedAt: number;
}

export interface UserTagPreferenceRecord {
  name: string;         // PK
  score: number;
  updatedAt: number;
}

export interface UserTagActionRecord {
  rootHash: string;     // PK
  tag: string;
  taggedAt: number;
}

function makeContentTagId(rootHash: string, tagName: string): string {
  return `${rootHash}:${tagName}`;
}

class TagDatabase extends Dexie {
  contentTags!: Table<ContentTagRecord, string>;
  userTagPreferences!: Table<UserTagPreferenceRecord, string>;
  userTagActions!: Table<UserTagActionRecord, string>;

  constructor(name: string) {
    super(name);

    this.version(TAG_STORE_DB_VERSION).stores({
      contentTags: "id, rootHash, name, counter, updatedAt",
      userTagPreferences: "name, score, updatedAt",
      userTagActions: "rootHash"
    });
  }
}

export interface TagStore {
  // Content tags
  getContentTags(rootHash: string): Promise<ContentTag[]>;
  setContentTags(rootHash: string, tags: ContentTag[]): Promise<void>;

  // User preferences
  getUserPreferences(): Promise<UserTagPreference[]>;
  setUserPreferences(prefs: UserTagPreference[]): Promise<void>;

  // Tag actions (deduplication)
  hasTaggedContent(rootHash: string): Promise<boolean>;
  recordTagAction(rootHash: string, tag: string): Promise<void>;
  getTagAction(rootHash: string): Promise<UserTagActionRecord | null>;

  close(): void;
}

export class IndexedDbTagStore implements TagStore {
  private readonly db: TagDatabase;

  constructor(dbName?: string) {
    this.db = new TagDatabase(dbName ?? TAG_STORE_DB_NAME);
  }

  close(): void {
    this.db.close();
  }

  async getContentTags(rootHash: string): Promise<ContentTag[]> {
    const records = await this.db.contentTags
      .where("rootHash")
      .equals(rootHash)
      .toArray();

    return records.map((r) => ({
      name: r.name,
      counter: r.counter,
      updatedAt: r.updatedAt
    }));
  }

  async setContentTags(rootHash: string, tags: ContentTag[]): Promise<void> {
    // Delete existing tags for this rootHash
    const existing = await this.db.contentTags
      .where("rootHash")
      .equals(rootHash)
      .toArray();

    for (const record of existing) {
      await this.db.contentTags.delete(record.id);
    }

    // Insert new tags one by one
    for (const tag of tags) {
      await this.db.contentTags.put({
        id: makeContentTagId(rootHash, tag.name),
        rootHash,
        name: tag.name,
        counter: tag.counter,
        updatedAt: tag.updatedAt
      });
    }
  }

  async getUserPreferences(): Promise<UserTagPreference[]> {
    const records = await this.db.userTagPreferences.toArray();

    return records.map((r) => ({
      name: r.name,
      score: r.score,
      updatedAt: r.updatedAt
    }));
  }

  async setUserPreferences(prefs: UserTagPreference[]): Promise<void> {
    // Delete all existing preferences
    const existing = await this.db.userTagPreferences.toArray();

    for (const record of existing) {
      await this.db.userTagPreferences.delete(record.name);
    }

    // Insert new preferences one by one
    for (const pref of prefs) {
      await this.db.userTagPreferences.put({
        name: pref.name,
        score: pref.score,
        updatedAt: pref.updatedAt
      });
    }
  }

  async hasTaggedContent(rootHash: string): Promise<boolean> {
    const record = await this.db.userTagActions.get(rootHash);
    return record !== undefined;
  }

  async recordTagAction(rootHash: string, tag: string): Promise<void> {
    await this.db.userTagActions.put({
      rootHash,
      tag,
      taggedAt: Math.floor(Date.now() / 1000)
    });
  }

  async getTagAction(rootHash: string): Promise<UserTagActionRecord | null> {
    const record = await this.db.userTagActions.get(rootHash);
    return record ?? null;
  }
}

export function createTagStore(dbName?: string): IndexedDbTagStore {
  return new IndexedDbTagStore(dbName);
}
