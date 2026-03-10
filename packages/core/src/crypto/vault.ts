/**
 * vault.ts — AES-256-GCM encryption for sensitive strings at rest.
 *
 * Uses the Web Crypto API (SubtleCrypto) exclusively — no third-party
 * dependencies.  Compatible with Chrome, Firefox, and Node.js ≥ 19.
 *
 * Key derivation: PBKDF2-SHA-256, 200 000 iterations.
 * Cipher:         AES-256-GCM (authenticated encryption with 12-byte random IV).
 *
 * Storage layout (VaultEntry):
 *   { v: 1, salt: <base64url>, iv: <base64url>, ct: <base64url> }
 *
 *   v    — schema version (to allow future migration)
 *   salt — 16 random bytes, unique per installation
 *   iv   — 12 random bytes, unique per write
 *   ct   — AES-GCM ciphertext + 16-byte authentication tag
 */

// ---------------------------------------------------------------------------
// Legacy password — kept ONLY for one-time migration of existing vault entries
// that were encrypted before the per-install secret was introduced.
// New installations never use this value.
// ---------------------------------------------------------------------------
export const VAULT_LEGACY_PASSWORD = "entropy-vault-v1";
const PBKDF2_ITERATIONS = 200_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface VaultEntry {
  v: 1;
  salt: string; // base64url
  iv: string;   // base64url
  ct: string;   // base64url (ciphertext + GCM auth tag)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto API (SubtleCrypto) is not available in this runtime.");
  }
  return subtle;
}

function toBase64Url(bytes: Uint8Array): string {
  // btoa works in browsers and Node.js ≥ 16
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (padded.length % 4)) % 4;
  const padded2 = padded + "=".repeat(padding);
  const binary = atob(padded2);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function randomBytes(length: number): ArrayBuffer {
  const buf = new Uint8Array(length);
  globalThis.crypto.getRandomValues(buf);
  // Slice to get a plain ArrayBuffer (not SharedArrayBuffer) — required by SubtleCrypto types.
  return buf.buffer.slice(0);
}

// ---------------------------------------------------------------------------
// Core crypto operations
// ---------------------------------------------------------------------------

async function deriveKey(salt: ArrayBuffer, password: string): Promise<CryptoKey> {
  const subtle = getSubtle();
  const encoder = new TextEncoder();

  const keyMaterial = await subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,         // not extractable
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt a plaintext string and return a `VaultEntry` ready to be stored.
 * A fresh salt and IV are generated on every call.
 */
export async function vaultEncrypt(plaintext: string, password: string): Promise<VaultEntry> {
  const subtle = getSubtle();
  const saltBuf = randomBytes(SALT_BYTES);
  const ivBuf = randomBytes(IV_BYTES);
  const key = await deriveKey(saltBuf, password);
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv: ivBuf },
    key,
    encoded
  );

  return {
    v: 1,
    salt: toBase64Url(new Uint8Array(saltBuf)),
    iv: toBase64Url(new Uint8Array(ivBuf)),
    ct: toBase64Url(new Uint8Array(ciphertext))
  };
}

/**
 * Decrypt a `VaultEntry` and return the original plaintext string.
 * Throws if the entry is malformed or the authentication tag is invalid.
 */
export async function vaultDecrypt(entry: VaultEntry, password: string): Promise<string> {
  const subtle = getSubtle();
  // Convert all Uint8Array results to plain ArrayBuffer via .slice(0) to satisfy
  // SubtleCrypto's strict BufferSource typing (rules out SharedArrayBuffer).
  const saltBuf = fromBase64Url(entry.salt).buffer.slice(0) as ArrayBuffer;
  const ivBuf   = fromBase64Url(entry.iv).buffer.slice(0)   as ArrayBuffer;
  const ctBuf   = fromBase64Url(entry.ct).buffer.slice(0)   as ArrayBuffer;
  const key = await deriveKey(saltBuf, password);

  let decrypted: ArrayBuffer;
  try {
    decrypted = await subtle.decrypt(
      { name: "AES-GCM", iv: ivBuf },
      key,
      ctBuf
    );
  } catch {
    throw new Error("vault: decryption failed — data may be corrupt or tampered.");
  }

  return new TextDecoder().decode(decrypted);
}

/**
 * Type guard — checks whether an unknown value looks like a valid VaultEntry.
 */
export function isVaultEntry(value: unknown): value is VaultEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<VaultEntry>;
  return (
    e.v === 1 &&
    typeof e.salt === "string" && e.salt.length > 0 &&
    typeof e.iv === "string" && e.iv.length > 0 &&
    typeof e.ct === "string" && e.ct.length > 0
  );
}
