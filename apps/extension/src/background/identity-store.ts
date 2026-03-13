import browser from "webextension-polyfill";
import {
  generateKeypair,
  pubkeyFromPrivkey,
  signEvent,
  vaultEncrypt,
  vaultDecrypt,
  isVaultEntry,
  VAULT_LEGACY_PASSWORD,
  type NostrEvent,
  type NostrEventDraft,
  type NostrKeypair,
  type VaultEntry
} from "@entropy/core";
import { initWelcomeGrant } from "./credit-ledger";

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

/** Legacy key — plain-text keypair (v1). Migrated away on first read. */
const LEGACY_KEY = "entropyIdentity";

/** Current key — AES-256-GCM encrypted private key (v2). */
const VAULT_KEY = "entropyIdentityV2";

/** Stored alongside the ciphertext; contains the pubkey in plain text so we
 *  never need to decrypt just to display "which identity is active". */
const PUBKEY_KEY = "entropyPubkey";

/** Per-installation random secret used as the vault password.
 *  Generated once on first use and stored separately from the vault entry.
 *  This replaces the hardcoded password that was visible in the source code. */
const VAULT_SECRET_KEY = "entropyVaultSecret";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface LegacyStorageSchema {
  [LEGACY_KEY]?: { pubkey?: string; privkey?: string };
}

interface VaultStorageSchema {
  [VAULT_KEY]?: VaultEntry;
  [PUBKEY_KEY]?: string;
  [VAULT_SECRET_KEY]?: string;
}

// ---------------------------------------------------------------------------
// In-memory cache (lives for the lifetime of the Service Worker instance)
// ---------------------------------------------------------------------------

let cachedIdentity: NostrKeypair | null = null;
let cachedVaultSecret: string | null = null;

function cloneIdentity(identity: NostrKeypair): NostrKeypair {
  return { pubkey: identity.pubkey, privkey: identity.privkey };
}

// ---------------------------------------------------------------------------
// Per-install vault secret management
// ---------------------------------------------------------------------------

/** Generate a 32-byte random hex string to use as the vault password. */
function generateVaultSecret(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Read (or create) the per-installation vault secret. Cached in memory. */
async function getVaultSecret(): Promise<string> {
  if (cachedVaultSecret) return cachedVaultSecret;

  const result = (await browser.storage.local.get(VAULT_SECRET_KEY)) as VaultStorageSchema;
  const stored = result[VAULT_SECRET_KEY];

  if (typeof stored === "string" && stored.length > 0) {
    cachedVaultSecret = stored;
    return stored;
  }

  // First use on this installation — generate and persist.
  const secret = generateVaultSecret();
  await browser.storage.local.set({ [VAULT_SECRET_KEY]: secret });
  cachedVaultSecret = secret;
  return secret;
}

// ---------------------------------------------------------------------------
// Persist (encrypt) → local storage
// ---------------------------------------------------------------------------

async function persistIdentity(identity: NostrKeypair): Promise<void> {
  cachedIdentity = cloneIdentity(identity);

  const secret = await getVaultSecret();
  const entry = await vaultEncrypt(identity.privkey, secret);

  await browser.storage.local.set({
    [VAULT_KEY]: entry,
    [PUBKEY_KEY]: identity.pubkey,
    // Remove the old plaintext key if it still exists.
    [LEGACY_KEY]: undefined
  } as Record<string, unknown>);

  // chrome.storage.local.set ignores `undefined` values; explicitly remove the
  // legacy key to avoid it lingering in storage.
  await browser.storage.local.remove(LEGACY_KEY);
}

// ---------------------------------------------------------------------------
// Read (decrypt) from local storage — with v1→v2 migration
// ---------------------------------------------------------------------------

async function readStoredIdentity(): Promise<NostrKeypair | null> {
  // Fast path: in-memory cache avoids a storage round-trip on every call.
  if (cachedIdentity) {
    return cloneIdentity(cachedIdentity);
  }

  const vaultResult = (await browser.storage.local.get([VAULT_KEY, PUBKEY_KEY])) as VaultStorageSchema;
  const entry = vaultResult[VAULT_KEY];

  if (isVaultEntry(entry)) {
    // Happy path: v2 encrypted identity already exists.
    const storedPubkey = vaultResult[PUBKEY_KEY];
    const secret = await getVaultSecret();

    // Try decrypting with the per-install secret first.
    let privkey: string | null = null;
    try {
      privkey = await vaultDecrypt(entry, secret);
    } catch {
      // Per-install secret failed — this entry may have been encrypted with
      // the legacy hardcoded password (pre-SEC-01 migration).
      try {
        privkey = await vaultDecrypt(entry, VAULT_LEGACY_PASSWORD);
      } catch {
        // Neither key works — treat as corrupt.
        return null;
      }
    }

    const derivedPubkey = pubkeyFromPrivkey(privkey);

    // Guard: derived pubkey must match what we stored unencrypted.
    if (storedPubkey && derivedPubkey !== storedPubkey) {
      // Storage inconsistency — treat as corrupt and return null.
      return null;
    }

    const identity: NostrKeypair = { pubkey: derivedPubkey, privkey };
    cachedIdentity = identity;

    // Re-encrypt with the per-install secret if we used the legacy password.
    // This is a one-time migration that runs transparently.
    try {
      await vaultDecrypt(entry, secret);
    } catch {
      // Legacy entry — re-encrypt with the per-install secret.
      await persistIdentity(identity);
    }

    return cloneIdentity(identity);
  }

  // ---------------------------------------------------------------------------
  // Migration path: v1 plaintext identity found → encrypt and upgrade.
  // ---------------------------------------------------------------------------
  const legacyResult = (await browser.storage.local.get(LEGACY_KEY)) as LegacyStorageSchema;
  const legacy = legacyResult[LEGACY_KEY];

  if (!legacy || typeof legacy.privkey !== "string" || typeof legacy.pubkey !== "string") {
    return null;
  }

  try {
    const derivedPubkey = pubkeyFromPrivkey(legacy.privkey);
    if (derivedPubkey !== legacy.pubkey) {
      // Corrupt legacy entry.
      return null;
    }

    const migrated: NostrKeypair = { pubkey: legacy.pubkey, privkey: legacy.privkey };
    // Re-persist using the encrypted format (also deletes LEGACY_KEY).
    await persistIdentity(migrated);
    return cloneIdentity(migrated);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API — identical signatures to the old implementation
// ---------------------------------------------------------------------------

export async function getOrCreateKeypair(): Promise<NostrKeypair> {
  const current = await readStoredIdentity();

  if (current) {
    return current;
  }

  const generated = generateKeypair();
  await persistIdentity(generated);
  // Give new users a one-time welcome grant so they can start consuming content
  // immediately without having to seed anything first.
  await initWelcomeGrant();
  return cloneIdentity(generated);
}

export async function importKeypair(privkey: string): Promise<{ pubkey: string }> {
  const pubkey = pubkeyFromPrivkey(privkey);
  // Invalidate in-memory cache so next read goes through the vaulted store.
  cachedIdentity = null;
  await persistIdentity({ pubkey, privkey });
  return { pubkey };
}

export async function getPublicKey(): Promise<string> {
  const identity = await getOrCreateKeypair();
  return identity.pubkey;
}

export async function exportIdentity(): Promise<NostrKeypair> {
  const identity = await getOrCreateKeypair();
  return cloneIdentity(identity);
}

export async function signNostrEvent(draft: NostrEventDraft): Promise<NostrEvent> {
  const identity = await getOrCreateKeypair();
  return signEvent(draft, identity.privkey);
}
