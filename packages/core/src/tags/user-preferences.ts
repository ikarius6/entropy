/**
 * User tag preferences: invisible profile built from user actions.
 *
 * Signals modify scores of content tags. Preferences are capped at
 * MAX_USER_TAG_PREFERENCES entries with eviction of weakest tags.
 * Preferences are local-only and never published to Nostr.
 */

import type { ContentTag } from "./content-tags";
import { normalizeTagName } from "./tag-validation";

export const MAX_USER_TAG_PREFERENCES = 100;
export const STALE_THRESHOLD_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface UserTagPreference {
  name: string;
  score: number;
  updatedAt: number;
}

export type UserSignalType =
  | "like"
  | "share"
  | "watch"
  | "seed"
  | "not_interested"
  | "block";

export const DEFAULT_SIGNAL_WEIGHTS: Record<UserSignalType, number> = {
  like: 1,
  share: 2,
  watch: 1,
  seed: 1,
  not_interested: -1,
  block: -3
};

function clonePref(pref: UserTagPreference): UserTagPreference {
  return { name: pref.name, score: pref.score, updatedAt: pref.updatedAt };
}

function findEvictionIndex(prefs: UserTagPreference[]): number {
  if (prefs.length === 0) return -1;

  let weakest = 0;

  for (let i = 1; i < prefs.length; i++) {
    const current = prefs[i];
    const best = prefs[weakest];

    const currentAbs = Math.abs(current.score);
    const bestAbs = Math.abs(best.score);

    if (
      currentAbs < bestAbs ||
      (currentAbs === bestAbs && current.updatedAt < best.updatedAt)
    ) {
      weakest = i;
    }
  }

  return weakest;
}

export function createUserPreferences(): UserTagPreference[] {
  return [];
}

export function applySignal(
  prefs: UserTagPreference[],
  contentTags: ContentTag[],
  signal: UserSignalType,
  weights?: Partial<Record<UserSignalType, number>>,
  timestamp?: number
): UserTagPreference[] {
  const effectiveWeights = { ...DEFAULT_SIGNAL_WEIGHTS, ...weights };
  const delta = effectiveWeights[signal];
  const now = timestamp ?? Math.floor(Date.now() / 1000);
  const result = prefs.map(clonePref);

  for (const tag of contentTags) {
    const normalized = normalizeTagName(tag.name);

    if (normalized.length === 0) continue;

    const existing = result.find((p) => p.name === normalized);

    if (existing) {
      existing.score += delta;
      existing.updatedAt = now;
    } else {
      const newPref: UserTagPreference = {
        name: normalized,
        score: delta,
        updatedAt: now
      };

      if (result.length < MAX_USER_TAG_PREFERENCES) {
        result.push(newPref);
      } else {
        const evictIdx = findEvictionIndex(result);

        if (evictIdx !== -1) {
          const evictee = result[evictIdx];

          if (Math.abs(newPref.score) >= Math.abs(evictee.score)) {
            result[evictIdx] = newPref;
          }
        }
      }
    }
  }

  return result;
}

export function purgeStalePreferences(
  prefs: UserTagPreference[],
  now?: number,
  thresholdSeconds?: number
): UserTagPreference[] {
  const currentTime = now ?? Math.floor(Date.now() / 1000);
  const threshold = thresholdSeconds ?? STALE_THRESHOLD_SECONDS;

  return prefs.filter((p) => {
    if (p.score === 0 && currentTime - p.updatedAt > threshold) {
      return false;
    }

    return true;
  });
}

export function getUserPreference(
  prefs: UserTagPreference[],
  name: string
): UserTagPreference | undefined {
  const normalized = normalizeTagName(name);
  return prefs.find((p) => p.name === normalized);
}

export function sortPreferencesByRelevance(
  prefs: UserTagPreference[]
): UserTagPreference[] {
  return [...prefs].sort((a, b) => {
    const absA = Math.abs(a.score);
    const absB = Math.abs(b.score);

    if (absB !== absA) return absB - absA;
    return b.updatedAt - a.updatedAt;
  });
}
