/**
 * sign-allowlist.ts — persistent storage for the NIP-07 origin allowlist.
 *
 * The allowlist controls which page origins are allowed to call `signEvent`
 * via the extension's NIP-07 provider (`window.nostr.signEvent`).
 *
 * Default entries (seeded at install time):
 *   - https://hackers.army          — production Entropy web app
 *   - http://localhost:5173        — Vite dev server
 *   - http://localhost:4173        — Vite preview server
 */

import browser from "webextension-polyfill";

const ALLOWLIST_KEY = "nip07SignAllowlist";

/** Origins that are pre-authorized out of the box. */
export const DEFAULT_SIGN_ORIGINS: readonly string[] = [
  "https://hackers.army",
  "http://localhost:5173",
  "http://localhost:4173"
];

interface AllowlistStorage {
  [ALLOWLIST_KEY]?: string[];
}

export async function getSignAllowlist(): Promise<string[]> {
  const result = (await browser.storage.local.get(ALLOWLIST_KEY)) as AllowlistStorage;
  const stored = result[ALLOWLIST_KEY];
  return Array.isArray(stored) ? stored : [];
}

export async function addSignOrigin(origin: string): Promise<string[]> {
  const list = await getSignAllowlist();
  if (!list.includes(origin)) {
    list.push(origin);
    await browser.storage.local.set({ [ALLOWLIST_KEY]: list });
  }
  return list;
}

export async function removeSignOrigin(origin: string): Promise<string[]> {
  let list = await getSignAllowlist();
  list = list.filter((o) => o !== origin);
  await browser.storage.local.set({ [ALLOWLIST_KEY]: list });
  return list;
}

/**
 * Called once on `onInstalled` to seed the default origins.
 * Will NOT overwrite an already-populated allowlist.
 */
export async function seedSignAllowlist(origins: readonly string[] = DEFAULT_SIGN_ORIGINS): Promise<void> {
  const result = (await browser.storage.local.get(ALLOWLIST_KEY)) as AllowlistStorage;
  if (!Array.isArray(result[ALLOWLIST_KEY])) {
    await browser.storage.local.set({ [ALLOWLIST_KEY]: [...origins] });
  }
}

export async function isOriginAllowed(origin: string): Promise<boolean> {
  const list = await getSignAllowlist();
  return list.includes(origin);
}
