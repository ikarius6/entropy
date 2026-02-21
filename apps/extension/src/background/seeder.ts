import browser from "webextension-polyfill";
import type { DelegateSeedingPayload } from "../shared/messaging";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DelegatedContentRecord extends DelegateSeedingPayload {
  delegatedAt: number;
}

interface StorageSchema {
  delegatedContent: Record<string, DelegatedContentRecord>;
}

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

const STORAGE_KEY = "delegatedContent";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readStore(): Promise<Record<string, DelegatedContentRecord>> {
  const result = (await browser.storage.local.get(STORAGE_KEY)) as Partial<StorageSchema>;
  return result[STORAGE_KEY] ?? {};
}

async function writeStore(store: Record<string, DelegatedContentRecord>): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: store });
}

// ---------------------------------------------------------------------------
// Public API (all async)
// ---------------------------------------------------------------------------

export async function enqueueDelegation(payload: DelegateSeedingPayload): Promise<void> {
  const store = await readStore();

  store[payload.rootHash] = {
    ...payload,
    delegatedAt: Date.now()
  };

  await writeStore(store);
}

export async function listDelegations(): Promise<DelegatedContentRecord[]> {
  const store = await readStore();
  return Object.values(store);
}

export async function getDelegationCount(): Promise<number> {
  const store = await readStore();
  return Object.keys(store).length;
}

export async function getDelegatedRootHashes(): Promise<string[]> {
  const store = await readStore();
  return Object.keys(store);
}

export async function pruneDelegations(maxAgeMs = 1000 * 60 * 60 * 6): Promise<number> {
  const store = await readStore();
  const now = Date.now();
  let removed = 0;

  for (const [rootHash, entry] of Object.entries(store)) {
    if (now - entry.delegatedAt > maxAgeMs) {
      delete store[rootHash];
      removed += 1;
    }
  }

  if (removed > 0) {
    await writeStore(store);
  }

  return removed;
}
