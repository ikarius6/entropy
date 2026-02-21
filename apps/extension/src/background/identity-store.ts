import browser from "webextension-polyfill";
import {
  generateKeypair,
  pubkeyFromPrivkey,
  signEvent,
  type NostrEvent,
  type NostrEventDraft,
  type NostrKeypair
} from "@entropy/core";

interface IdentityStorageSchema {
  entropyIdentity?: NostrKeypair;
}

const STORAGE_KEY = "entropyIdentity";

let cachedIdentity: NostrKeypair | null = null;

function cloneIdentity(identity: NostrKeypair): NostrKeypair {
  return {
    pubkey: identity.pubkey,
    privkey: identity.privkey
  };
}

function parseStoredIdentity(value: unknown): NostrKeypair | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<NostrKeypair>;

  if (typeof candidate.privkey !== "string" || typeof candidate.pubkey !== "string") {
    return null;
  }

  try {
    const derived = pubkeyFromPrivkey(candidate.privkey);

    if (derived !== candidate.pubkey) {
      return null;
    }

    return {
      pubkey: candidate.pubkey,
      privkey: candidate.privkey
    };
  } catch {
    return null;
  }
}

async function readStoredIdentity(): Promise<NostrKeypair | null> {
  if (cachedIdentity) {
    return cloneIdentity(cachedIdentity);
  }

  const result = (await browser.storage.local.get(STORAGE_KEY)) as IdentityStorageSchema;
  const parsed = parseStoredIdentity(result[STORAGE_KEY]);

  if (!parsed) {
    return null;
  }

  cachedIdentity = parsed;
  return cloneIdentity(parsed);
}

async function persistIdentity(identity: NostrKeypair): Promise<void> {
  cachedIdentity = cloneIdentity(identity);
  await browser.storage.local.set({
    [STORAGE_KEY]: cloneIdentity(identity)
  });
}

export async function getOrCreateKeypair(): Promise<NostrKeypair> {
  const current = await readStoredIdentity();

  if (current) {
    return current;
  }

  const generated = generateKeypair();
  await persistIdentity(generated);
  return cloneIdentity(generated);
}

export async function importKeypair(privkey: string): Promise<{ pubkey: string }> {
  const pubkey = pubkeyFromPrivkey(privkey);

  await persistIdentity({
    pubkey,
    privkey
  });

  return { pubkey };
}

export async function getPublicKey(): Promise<string> {
  const identity = await getOrCreateKeypair();
  return identity.pubkey;
}

export async function signNostrEvent(draft: NostrEventDraft): Promise<NostrEvent> {
  const identity = await getOrCreateKeypair();
  return signEvent(draft, identity.privkey);
}
