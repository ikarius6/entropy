import { beforeEach, describe, expect, it, vi } from "vitest";
import browser, {
  __resetMockStorage,
  __setMockStorageValue,
  __getMockStorageValue
} from "./__mocks__/webextension-polyfill";

// ---------------------------------------------------------------------------
// @entropy/core mocks — only the non-crypto primitives are mocked.
// vaultEncrypt / vaultDecrypt / isVaultEntry use the REAL SubtleCrypto
// (available in Node.js ≥ 19 via globalThis.crypto.subtle) so we get
// genuine encryption round-trip coverage without snapshot brittleness.
// ---------------------------------------------------------------------------

const generateKeypairMock = vi.fn(() => ({
  pubkey: "generated-pub",
  privkey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}));

const pubkeyFromPrivkeyMock = vi.fn((privkey: string) => `pub-${privkey}`);

const signEventMock = vi.fn(
  (
    draft: { kind: number; created_at: number; content: string; tags: string[][] },
    privkey: string
  ) => ({
    id: "signed-id",
    pubkey: `pub-${privkey}`,
    sig: "signed-sig",
    kind: draft.kind,
    created_at: draft.created_at,
    content: draft.content,
    tags: draft.tags
  })
);

vi.mock("@entropy/core", async (importOriginal) => {
  // Import the REAL vault functions from the actual module.
  const real = await importOriginal<typeof import("@entropy/core")>();
  return {
    ...real,
    generateKeypair: generateKeypairMock,
    pubkeyFromPrivkey: pubkeyFromPrivkeyMock,
    signEvent: signEventMock
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Private key that passes the hex format check in pubkeyFromPrivkeyMock. */
const MOCK_PRIVKEY = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const MOCK_PUBKEY = `pub-${MOCK_PRIVKEY}`;

describe("identity-store (encrypted)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    __resetMockStorage();
  });

  // -------------------------------------------------------------------------
  // Baseline — existing behaviours must still work
  // -------------------------------------------------------------------------

  it("generates and persists a keypair when storage is empty", async () => {
    const identityStore = await import("../background/identity-store");

    const identity = await identityStore.getOrCreateKeypair();

    expect(identity.pubkey).toBe("generated-pub");
    expect(generateKeypairMock).toHaveBeenCalledOnce();
  });

  it("does NOT store the raw private key in plain text", async () => {
    const identityStore = await import("../background/identity-store");
    await identityStore.getOrCreateKeypair();

    // The old entropyIdentity key must be absent.
    const legacyValue = __getMockStorageValue("entropyIdentity");
    expect(legacyValue).toBeUndefined();

    // The new vault entry must exist and must NOT contain a bare privkey field.
    const vaultEntry = __getMockStorageValue("entropyIdentityV2") as Record<string, unknown> | undefined;
    expect(vaultEntry).toBeDefined();
    expect(typeof vaultEntry?.ct).toBe("string");
    expect(typeof vaultEntry?.iv).toBe("string");
    expect(typeof vaultEntry?.salt).toBe("string");
    expect(vaultEntry?.v).toBe(1);
    // No raw private key anywhere in the stored object.
    expect(JSON.stringify(vaultEntry)).not.toContain("generated-priv");
  });

  it("reuses a valid encrypted keypair already stored (round-trip)", async () => {
    // Import the real vault helpers to verify round-trip independently.
    const { vaultDecrypt, isVaultEntry } = await import("@entropy/core");

    // First call: generate and persist.
    const store = await import("../background/identity-store");
    const first = await store.getOrCreateKeypair();

    // The vault entry in storage should decrypt back to the original privkey.
    const vaultEntry = __getMockStorageValue("entropyIdentityV2");
    expect(isVaultEntry(vaultEntry)).toBe(true);

    // Read the per-install vault secret that identity-store generated.
    const vaultSecret = __getMockStorageValue("entropyVaultSecret") as string;
    expect(typeof vaultSecret).toBe("string");
    expect(vaultSecret.length).toBeGreaterThan(0);

    // Decrypt and verify the stored privkey matches what was generated.
    const decryptedPrivkey = await vaultDecrypt(vaultEntry as Parameters<typeof vaultDecrypt>[0], vaultSecret);
    expect(decryptedPrivkey).toBe(first.privkey);

    // Second call in the same SW instance hits the in-memory cache.
    const second = await store.getOrCreateKeypair();
    expect(second.pubkey).toBe(first.pubkey);
    expect(second.privkey).toBe(first.privkey);

    // generateKeypair should only have been called once.
    expect(generateKeypairMock).toHaveBeenCalledOnce();
  });

  it("imports a private key, encrypts it, and exposes the derived public key", async () => {
    const store = await import("../background/identity-store");

    const imported = await store.importKeypair(MOCK_PRIVKEY);
    const pubkey = await store.getPublicKey();

    expect(imported).toEqual({ pubkey: MOCK_PUBKEY });
    expect(pubkey).toBe(MOCK_PUBKEY);

    // Verify storage contains encrypted vault entry, not the raw privkey.
    const vaultEntry = __getMockStorageValue("entropyIdentityV2") as Record<string, unknown> | undefined;
    expect(vaultEntry?.v).toBe(1);
    expect(JSON.stringify(vaultEntry)).not.toContain(MOCK_PRIVKEY);
  });

  it("signs nostr drafts with the persisted (decrypted) private key", async () => {
    const store = await import("../background/identity-store");
    await store.importKeypair(MOCK_PRIVKEY);

    const draft = {
      kind: 20_001,
      created_at: 1_700_000_000,
      content: "{}",
      tags: [] as string[][]
    };
    const signed = await store.signNostrEvent(draft);

    expect(signEventMock).toHaveBeenCalledWith(draft, MOCK_PRIVKEY);
    expect(signed.pubkey).toBe(MOCK_PUBKEY);
  });

  // -------------------------------------------------------------------------
  // Migration: v1 plain-text → v2 encrypted
  // -------------------------------------------------------------------------

  it("migrates a legacy plain-text entropyIdentity to encrypted entropyIdentityV2", async () => {
    // Seed the OLD format into storage.
    __setMockStorageValue("entropyIdentity", {
      pubkey: MOCK_PUBKEY,
      privkey: MOCK_PRIVKEY
    });

    const store = await import("../background/identity-store");
    const identity = await store.getOrCreateKeypair();

    // Returns the correct identity.
    expect(identity.privkey).toBe(MOCK_PRIVKEY);
    expect(identity.pubkey).toBe(MOCK_PUBKEY);

    // Old key is removed.
    expect(__getMockStorageValue("entropyIdentity")).toBeUndefined();

    // New encrypted key is present.
    const vaultEntry = __getMockStorageValue("entropyIdentityV2") as Record<string, unknown> | undefined;
    expect(vaultEntry?.v).toBe(1);
    expect(JSON.stringify(vaultEntry)).not.toContain(MOCK_PRIVKEY);
  });

  it("generates a new keypair when the legacy entry is corrupt", async () => {
    __setMockStorageValue("entropyIdentity", {
      pubkey: "wrong-pub",   // does not match pub-${privkey}
      privkey: MOCK_PRIVKEY
    });

    const store = await import("../background/identity-store");
    const identity = await store.getOrCreateKeypair();

    // Falls back to generating a fresh keypair.
    expect(generateKeypairMock).toHaveBeenCalledOnce();
    expect(identity.pubkey).toBe("generated-pub");
  });
});
