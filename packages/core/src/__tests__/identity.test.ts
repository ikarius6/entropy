import { describe, expect, it } from "vitest";

import { type NostrEventDraft } from "../nostr/events";
import {
  generateKeypair,
  pubkeyFromPrivkey,
  signEvent,
  verifyEventSignature
} from "../nostr/identity";

function buildDraft(overrides: Partial<NostrEventDraft> = {}): NostrEventDraft {
  return {
    kind: 1,
    created_at: 1_700_000_000,
    content: "entropy",
    tags: [["x", "chunk-hash"]],
    ...overrides
  };
}

describe("nostr identity", () => {
  it("generates keypairs and derives matching pubkeys", () => {
    const keypair = generateKeypair();

    expect(keypair.privkey).toMatch(/^[0-9a-f]{64}$/);
    expect(keypair.pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(pubkeyFromPrivkey(keypair.privkey)).toBe(keypair.pubkey);
  });

  it("signs events that pass signature verification", () => {
    const keypair = generateKeypair();
    const signed = signEvent(buildDraft(), keypair.privkey);

    expect(signed.pubkey).toBe(keypair.pubkey);
    expect(signed.id).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyEventSignature(signed)).toBe(true);
  });

  it("does not mutate the original draft during signing", () => {
    const keypair = generateKeypair();
    const draft = buildDraft({ tags: [["a", "1"], ["b", "2"]] });
    const before = JSON.stringify(draft);

    signEvent(draft, keypair.privkey);

    expect(JSON.stringify(draft)).toBe(before);
  });

  it("rejects invalid private keys", () => {
    expect(() => pubkeyFromPrivkey("not-hex")).toThrowError(
      "Private key must be a hex string."
    );

    expect(() => pubkeyFromPrivkey("ab")).toThrowError(
      "Private key must be a 32-byte hex string."
    );
  });
});
