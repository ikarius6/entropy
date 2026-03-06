import browser from "webextension-polyfill";
import {
  generateKeypair,
  pubkeyFromPrivkey,
  signEvent,
  vaultEncrypt,
  vaultDecrypt,
  isVaultEntry,
  type NostrEvent,
  type NostrEventDraft,
  type NostrKeypair,
  type VaultEntry
} from "@entropy/core";

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

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface LegacyStorageSchema {
  [LEGACY_KEY]?: { pubkey?: string; privkey?: string };
}

interface VaultStorageSchema {
  [VAULT_KEY]?: VaultEntry;
  [PUBKEY_KEY]?: string;
}

// ---------------------------------------------------------------------------
// In-memory cache (lives for the lifetime of the Service Worker instance)
// ---------------------------------------------------------------------------

let cachedIdentity: NostrKeypair | null = null;

function cloneIdentity(identity: NostrKeypair): NostrKeypair {
  return { pubkey: identity.pubkey, privkey: identity.privkey };
}

// ---------------------------------------------------------------------------
// Persist (encrypt) → local storage
// ---------------------------------------------------------------------------

async function persistIdentity(identity: NostrKeypair): Promise<void> {
  cachedIdentity = cloneIdentity(identity);

  const entry = await vaultEncrypt(identity.privkey);

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

    try {
      const privkey = await vaultDecrypt(entry);
      const derivedPubkey = pubkeyFromPrivkey(privkey);

      // Guard: derived pubkey must match what we stored unencrypted.
      if (storedPubkey && derivedPubkey !== storedPubkey) {
        // Storage inconsistency — treat as corrupt and return null.
        return null;
      }

      const identity: NostrKeypair = { pubkey: derivedPubkey, privkey };
      cachedIdentity = identity;
      return cloneIdentity(identity);
    } catch {
      // Decryption failure (corrupt / tampered entry) — return null so the
      // caller can generate a fresh keypair.
      return null;
    }
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
