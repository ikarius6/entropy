import { beforeEach, describe, expect, it, vi } from "vitest";
import browser, { __resetMockStorage, __setMockStorageValue } from "./__mocks__/webextension-polyfill";

const generateKeypairMock = vi.fn(() => ({
  pubkey: "generated-pub",
  privkey: "generated-priv"
}));

const pubkeyFromPrivkeyMock = vi.fn((privkey: string) => `pub-${privkey}`);

const signEventMock = vi.fn((draft: { kind: number; created_at: number; content: string; tags: string[][] }, privkey: string) => ({
  id: "signed-id",
  pubkey: `pub-${privkey}`,
  sig: "signed-sig",
  kind: draft.kind,
  created_at: draft.created_at,
  content: draft.content,
  tags: draft.tags
}));

vi.mock("@entropy/core", () => ({
  generateKeypair: generateKeypairMock,
  pubkeyFromPrivkey: pubkeyFromPrivkeyMock,
  signEvent: signEventMock
}));

describe("identity-store", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    __resetMockStorage();
  });

  it("generates and persists a keypair when storage is empty", async () => {
    const identityStore = await import("../background/identity-store");

    const identity = await identityStore.getOrCreateKeypair();

    expect(identity).toEqual({
      pubkey: "generated-pub",
      privkey: "generated-priv"
    });
    expect(generateKeypairMock).toHaveBeenCalledOnce();
    expect(browser.storage.local.set).toHaveBeenCalledOnce();
  });

  it("reuses a valid keypair already stored", async () => {
    __setMockStorageValue("entropyIdentity", {
      pubkey: "pub-seeded-priv",
      privkey: "seeded-priv"
    });

    const identityStore = await import("../background/identity-store");
    const identity = await identityStore.getOrCreateKeypair();

    expect(identity).toEqual({
      pubkey: "pub-seeded-priv",
      privkey: "seeded-priv"
    });
    expect(generateKeypairMock).not.toHaveBeenCalled();
    expect(pubkeyFromPrivkeyMock).toHaveBeenCalledWith("seeded-priv");
  });

  it("imports a private key and exposes the derived public key", async () => {
    const identityStore = await import("../background/identity-store");

    const imported = await identityStore.importKeypair("imported-priv");
    const pubkey = await identityStore.getPublicKey();

    expect(imported).toEqual({ pubkey: "pub-imported-priv" });
    expect(pubkey).toBe("pub-imported-priv");
  });

  it("signs nostr drafts with the persisted private key", async () => {
    const identityStore = await import("../background/identity-store");

    await identityStore.importKeypair("signed-priv");

    const draft = {
      kind: 20_001,
      created_at: 1_700_000_000,
      content: "{}",
      tags: [] as string[][]
    };

    const signed = await identityStore.signNostrEvent(draft);

    expect(signEventMock).toHaveBeenCalledWith(draft, "signed-priv");
    expect(signed.pubkey).toBe("pub-signed-priv");
  });
});
