import { describe, expect, it } from "vitest";

import {
  configureReceiptSignatureVerifier,
  ENTROPY_UPSTREAM_RECEIPT_KIND,
  buildReceiptDraft,
  isValidReceipt,
  parseReceipt,
  receiptToBytes,
  type SignedReceipt,
  type UpstreamReceipt
} from "../credits/proof-of-upstream";

const BASE_RECEIPT: UpstreamReceipt = {
  chunkHash: "chunk-abc",
  senderPubkey: "npub1sender",
  receiverPubkey: "npub1receiver",
  bytes: 5 * 1024 * 1024,
  timestamp: 1_700_000_000
};

function buildSignedReceipt(overrides: Partial<SignedReceipt> = {}): SignedReceipt {
  return {
    ...BASE_RECEIPT,
    signature: "sig-123",
    eventId: "event-123",
    ...overrides
  };
}

describe("proof-of-upstream", () => {
  it("builds unsigned receipt drafts with kind 7772", () => {
    const draft = buildReceiptDraft(BASE_RECEIPT);

    expect(draft.kind).toBe(ENTROPY_UPSTREAM_RECEIPT_KIND);
    expect(draft.created_at).toBe(BASE_RECEIPT.timestamp);
    expect(draft.tags).toEqual([
      ["p", BASE_RECEIPT.senderPubkey],
      ["x", BASE_RECEIPT.chunkHash],
      ["bytes", String(BASE_RECEIPT.bytes)],
      ["receipt", String(BASE_RECEIPT.timestamp)]
    ]);
  });

  it("parses signed receipts from nostr-like events", () => {
    const parsed = parseReceipt({
      kind: ENTROPY_UPSTREAM_RECEIPT_KIND,
      pubkey: BASE_RECEIPT.receiverPubkey,
      id: "event-id",
      sig: "event-sig",
      created_at: BASE_RECEIPT.timestamp,
      tags: [
        ["p", BASE_RECEIPT.senderPubkey],
        ["x", BASE_RECEIPT.chunkHash],
        ["bytes", String(BASE_RECEIPT.bytes)],
        ["receipt", String(BASE_RECEIPT.timestamp)]
      ]
    });

    expect(parsed.senderPubkey).toBe(BASE_RECEIPT.senderPubkey);
    expect(parsed.receiverPubkey).toBe(BASE_RECEIPT.receiverPubkey);
    expect(parsed.chunkHash).toBe(BASE_RECEIPT.chunkHash);
    expect(parsed.bytes).toBe(BASE_RECEIPT.bytes);
    expect(parsed.timestamp).toBe(BASE_RECEIPT.timestamp);
    expect(parsed.signature).toBe("event-sig");
    expect(parsed.eventId).toBe("event-id");
  });

  it("validates receipts with time window and signature verifier", () => {
    const receipt = buildSignedReceipt();

    expect(
      isValidReceipt(receipt, receipt.chunkHash, {
        nowSeconds: receipt.timestamp + 10,
        verifySignature: () => true
      })
    ).toBe(true);

    expect(
      isValidReceipt(receipt, "another-chunk", {
        nowSeconds: receipt.timestamp + 10,
        verifySignature: () => true
      })
    ).toBe(false);

    expect(
      isValidReceipt(receipt, receipt.chunkHash, {
        nowSeconds: receipt.timestamp + 10,
        verifySignature: () => false
      })
    ).toBe(false);

    expect(
      isValidReceipt(receipt, receipt.chunkHash, {
        nowSeconds: receipt.timestamp + 1000,
        maxAgeSeconds: 30,
        verifySignature: () => true
      })
    ).toBe(false);
  });

  it("extracts credited bytes from signed receipts", () => {
    expect(receiptToBytes(buildSignedReceipt({ bytes: 1024 }))).toBe(1024);

    expect(() => receiptToBytes(buildSignedReceipt({ bytes: 0 }))).toThrowError(
      "Receipt bytes must be a positive integer."
    );
  });

  it("supports a configurable default signature verifier", () => {
    const receipt = buildSignedReceipt();

    configureReceiptSignatureVerifier(() => true);
    expect(
      isValidReceipt(receipt, receipt.chunkHash, {
        nowSeconds: receipt.timestamp + 10
      })
    ).toBe(true);

    configureReceiptSignatureVerifier(() => false);
    expect(
      isValidReceipt(receipt, receipt.chunkHash, {
        nowSeconds: receipt.timestamp + 10
      })
    ).toBe(false);

    configureReceiptSignatureVerifier(null);
  });

  it("throws when isValidReceipt is called with no verifier configured", () => {
    // configureReceiptSignatureVerifier(null) was called by the previous test — verifier is null
    const receipt = buildSignedReceipt();

    expect(() =>
      isValidReceipt(receipt, receipt.chunkHash, {
        nowSeconds: receipt.timestamp + 10
        // no verifySignature option → falls back to defaultSignatureVerifier → should throw
      })
    ).toThrowError("Receipt signature verifier is not configured");
  });

  it("explicit verifySignature option works even without a global verifier configured", () => {
    // verifier is still null from the previous tests
    const receipt = buildSignedReceipt();

    // Passing an explicit option should bypass the null global verifier
    expect(
      isValidReceipt(receipt, receipt.chunkHash, {
        nowSeconds: receipt.timestamp + 10,
        verifySignature: () => true
      })
    ).toBe(true);

    expect(
      isValidReceipt(receipt, receipt.chunkHash, {
        nowSeconds: receipt.timestamp + 10,
        verifySignature: () => false
      })
    ).toBe(false);
  });
});
