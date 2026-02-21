import browser from "webextension-polyfill";
import { RelayPool, type RelayInfo } from "@entropy/core";

interface RelayStorageSchema {
  entropyRelayUrls?: string[];
  entropySeedingActive?: boolean;
}

const RELAY_STORAGE_KEY = "entropyRelayUrls";
const SEEDING_ACTIVE_KEY = "entropySeedingActive";

export const DEFAULT_RELAY_URLS = [
  "wss://relay.damus.io", 
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://purplepag.es",
];

let relayPool: RelayPool | null = null;
let currentRelayUrls: string[] = [];

function normalizeRelayUrl(url: string): string {
  const normalized = url.trim().replace(/\/+$/, "");

  if (!/^wss?:\/\//i.test(normalized)) {
    throw new Error("Relay URL must start with ws:// or wss://.");
  }

  return normalized;
}

function normalizeRelayUrls(urls: string[]): string[] {
  const unique = new Set<string>();

  for (const url of urls) {
    unique.add(normalizeRelayUrl(url));
  }

  return [...unique];
}

async function readStoredRelayUrls(): Promise<string[]> {
  const result = (await browser.storage.local.get(RELAY_STORAGE_KEY)) as RelayStorageSchema;
  const stored = result[RELAY_STORAGE_KEY];

  if (!Array.isArray(stored)) {
    return [];
  }

  return stored.filter((entry): entry is string => typeof entry === "string");
}

async function writeStoredRelayUrls(urls: string[]): Promise<void> {
  await browser.storage.local.set({
    [RELAY_STORAGE_KEY]: urls
  });
}

function buildConnectedRelayPool(urls: string[]): RelayPool {
  const pool = new RelayPool();
  pool.connect(urls);
  return pool;
}

function replaceRelayPool(urls: string[]): RelayPool {
  relayPool?.disconnect();
  relayPool = buildConnectedRelayPool(urls);
  currentRelayUrls = [...urls];
  return relayPool;
}

export async function getRelayUrls(): Promise<string[]> {
  if (currentRelayUrls.length > 0) {
    return [...currentRelayUrls];
  }

  const stored = await readStoredRelayUrls();

  if (stored.length > 0) {
    currentRelayUrls = normalizeRelayUrls(stored);
    return [...currentRelayUrls];
  }

  currentRelayUrls = [...DEFAULT_RELAY_URLS];
  return [...currentRelayUrls];
}

export async function initRelayManager(relayUrls?: string[]): Promise<RelayPool> {
  const candidateUrls = relayUrls && relayUrls.length > 0 ? relayUrls : await getRelayUrls();
  const normalized = normalizeRelayUrls(candidateUrls.length > 0 ? candidateUrls : DEFAULT_RELAY_URLS);

  await writeStoredRelayUrls(normalized);

  return replaceRelayPool(normalized);
}

export function getRelayPool(): RelayPool {
  if (!relayPool) {
    relayPool = buildConnectedRelayPool(currentRelayUrls.length > 0 ? currentRelayUrls : DEFAULT_RELAY_URLS);
  }

  return relayPool;
}

export async function addRelay(url: string): Promise<void> {
  const current = await getRelayUrls();
  const next = normalizeRelayUrls([...current, url]);

  await writeStoredRelayUrls(next);
  replaceRelayPool(next);
}

export async function removeRelay(url: string): Promise<void> {
  const normalizedToRemove = normalizeRelayUrl(url);
  const current = await getRelayUrls();
  const next = current.filter((entry) => entry !== normalizedToRemove);

  await writeStoredRelayUrls(next);

  if (next.length === 0) {
    replaceRelayPool(DEFAULT_RELAY_URLS);
    return;
  }

  replaceRelayPool(next);
}

export function getRelayStatuses(): RelayInfo[] {
  return relayPool?.getRelayStatuses() ?? [];
}

export async function getSeedingActive(): Promise<boolean> {
  const result = (await browser.storage.local.get(SEEDING_ACTIVE_KEY)) as RelayStorageSchema;
  return result[SEEDING_ACTIVE_KEY] !== false;
}

export async function setSeedingActive(active: boolean): Promise<void> {
  await browser.storage.local.set({ [SEEDING_ACTIVE_KEY]: active });
}

export async function ensureRelayConnections(): Promise<void> {
  const statuses = getRelayStatuses();

  if (statuses.length === 0) {
    await initRelayManager();
    return;
  }

  const hasUnhealthyRelay = statuses.some((status) => status.status === "disconnected" || status.status === "error");

  if (hasUnhealthyRelay) {
    await initRelayManager(currentRelayUrls);
  }
}
