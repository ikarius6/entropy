import { describe, expect, it } from "vitest";

import {
  createCreditLedger,
  type CreditEntry
} from "../credits/ledger";

import {
  isValidReceipt,
  type SignedReceipt
} from "../credits/proof-of-upstream";

import {
  isCreditSummaryPayload,
  isEntropyRuntimeMessage,
  isEntropyRuntimeResponse,
  ENTROPY_WEB_SOURCE
} from "../types/extension-bridge";

function buildReceipt(overrides: Partial<SignedReceipt> = {}): SignedReceipt {
  return {
    chunkHash: "chunk-abc",
    senderPubkey: "npub1sender",
    receiverPubkey: "npub1receiver",
    bytes: 5 * 1024 * 1024,
    timestamp: 1_700_000_000,
    signature: "sig-123",
    eventId: "event-123",
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Malformed CREDIT_UPDATE payload tests
// ---------------------------------------------------------------------------

describe("credit gating — malformed CREDIT_UPDATE handling", () => {
  it("rejects payload with missing history field", () => {
    expect(
      isCreditSummaryPayload({
        totalUploaded: 100,
        totalDownloaded: 50,
        ratio: 2,
        balance: 50,
        entryCount: 1,
        coldStorageEligible: false
        // history is missing
      })
    ).toBe(false);
  });

  it("rejects payload with non-array history", () => {
    expect(
      isCreditSummaryPayload({
        totalUploaded: 100,
        totalDownloaded: 50,
        ratio: 2,
        balance: 50,
        entryCount: 1,
        coldStorageEligible: false,
        history: "not-an-array"
      })
    ).toBe(false);
  });

  it("rejects payload with history entry containing invalid direction", () => {
    expect(
      isCreditSummaryPayload({
        totalUploaded: 100,
        totalDownloaded: 50,
        ratio: 2,
        balance: 50,
        entryCount: 1,
        coldStorageEligible: false,
        history: [
          {
            id: "c-1",
            peerPubkey: "peer",
            direction: "sideways",
            bytes: 100,
            chunkHash: "hash",
            timestamp: 1
          }
        ]
      })
    ).toBe(false);
  });

  it("rejects payload with missing coldStorageEligible", () => {
    expect(
      isCreditSummaryPayload({
        totalUploaded: 100,
        totalDownloaded: 50,
        ratio: 2,
        balance: 50,
        entryCount: 1,
        history: []
      })
    ).toBe(false);
  });

  it("rejects null and primitives", () => {
    expect(isCreditSummaryPayload(null)).toBe(false);
    expect(isCreditSummaryPayload(undefined)).toBe(false);
    expect(isCreditSummaryPayload(42)).toBe(false);
    expect(isCreditSummaryPayload("string")).toBe(false);
  });

  it("accepts payload with null ratio (representing Infinity)", () => {
    expect(
      isCreditSummaryPayload({
        totalUploaded: 100,
        totalDownloaded: 0,
        ratio: null,
        balance: 100,
        entryCount: 1,
        coldStorageEligible: false,
        integrityValid: true,
        trustScore: 100,
        receiptVerifiedEntries: 0,
        history: []
      })
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stale / invalid receipt rejection
// ---------------------------------------------------------------------------

describe("credit gating — stale / invalid receipt rejection", () => {
  it("rejects receipts that are too old", () => {
    const receipt = buildReceipt({ timestamp: 1_700_000_000 });

    expect(
      isValidReceipt(receipt, receipt.chunkHash, {
        nowSeconds: 1_700_002_000, // 2000s later
        maxAgeSeconds: 1800, // 30min window
        verifySignature: () => true
      })
    ).toBe(false);
  });

  it("rejects receipts from the future beyond skew limit", () => {
    const receipt = buildReceipt({ timestamp: 1_700_000_200 });

    expect(
      isValidReceipt(receipt, receipt.chunkHash, {
        nowSeconds: 1_700_000_000,
        maxFutureSkewSeconds: 60,
        verifySignature: () => true
      })
    ).toBe(false);
  });

  it("rejects receipts with empty signature", () => {
    const receipt = buildReceipt({ signature: "" });

    expect(
      isValidReceipt(receipt, receipt.chunkHash, {
        nowSeconds: receipt.timestamp + 10,
        verifySignature: () => true
      })
    ).toBe(false);
  });

  it("rejects receipts with empty eventId", () => {
    const receipt = buildReceipt({ eventId: "" });

    expect(
      isValidReceipt(receipt, receipt.chunkHash, {
        nowSeconds: receipt.timestamp + 10,
        verifySignature: () => true
      })
    ).toBe(false);
  });

  it("rejects receipts with zero bytes", () => {
    const receipt = buildReceipt({ bytes: 0 });

    expect(
      isValidReceipt(receipt, receipt.chunkHash, {
        nowSeconds: receipt.timestamp + 10,
        verifySignature: () => true
      })
    ).toBe(false);
  });

  it("rejects receipts with negative timestamp", () => {
    const receipt = buildReceipt({ timestamp: -1 });

    expect(
      isValidReceipt(receipt, receipt.chunkHash, {
        nowSeconds: 10,
        verifySignature: () => true
      })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Credit gating — canDownload / insufficient balance
// ---------------------------------------------------------------------------

describe("credit gating — canDownload behavior", () => {
  it("blocks download when balance is insufficient", () => {
    const ledger = createCreditLedger();

    ledger.recordUpload({
      peerPubkey: "peer-a",
      bytes: 100,
      chunkHash: "chunk-1",
      receiptSignature: "sig-1",
      timestamp: 1
    });

    expect(ledger.canDownload(100)).toBe(true);
    expect(ledger.canDownload(101)).toBe(false);
  });

  it("blocks download on a fresh ledger with no credit", () => {
    const ledger = createCreditLedger();

    expect(ledger.canDownload(1)).toBe(false);
    expect(ledger.getBalance()).toBe(0);
  });

  it("correctly updates balance after interleaved uploads and downloads", () => {
    const ledger = createCreditLedger();

    ledger.recordUpload({
      peerPubkey: "peer-a",
      bytes: 500,
      chunkHash: "c1",
      receiptSignature: "s1",
      timestamp: 1
    });

    ledger.recordDownload({
      peerPubkey: "peer-b",
      bytes: 200,
      chunkHash: "c2",
      receiptSignature: "s2",
      timestamp: 2
    });

    expect(ledger.canDownload(300)).toBe(true);
    expect(ledger.canDownload(301)).toBe(false);

    ledger.recordUpload({
      peerPubkey: "peer-c",
      bytes: 100,
      chunkHash: "c3",
      receiptSignature: "s3",
      timestamp: 3
    });

    expect(ledger.canDownload(400)).toBe(true);
    expect(ledger.canDownload(401)).toBe(false);
  });

  it("rejects non-positive or non-finite requestedBytes", () => {
    const ledger = createCreditLedger();

    ledger.recordUpload({
      peerPubkey: "peer-a",
      bytes: 1000,
      chunkHash: "c1",
      receiptSignature: "s1",
      timestamp: 1
    });

    expect(ledger.canDownload(0)).toBe(false);
    expect(ledger.canDownload(-10)).toBe(false);
    expect(ledger.canDownload(NaN)).toBe(false);
    expect(ledger.canDownload(Infinity)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Full content consumption flow — the exact scenario of the ∞ ratio bug
// ---------------------------------------------------------------------------

describe("credit gating — full content consumption flow", () => {
  it("ratio stays ∞ when only uploads are recorded (the bug)", () => {
    const ledger = createCreditLedger();

    // Simulate seeding multiple chunks without ever recording downloads
    for (let i = 0; i < 10; i++) {
      ledger.recordUpload({
        peerPubkey: `peer-${i}`,
        bytes: 1024 * 1024,
        chunkHash: `seed-chunk-${i}`,
        receiptSignature: `sig-${i}`,
        timestamp: i + 1
      });
    }

    // Balance keeps growing, ratio stays ∞
    expect(ledger.getBalance()).toBe(10 * 1024 * 1024);
    expect(ledger.getSummary().ratio).toBe(Number.POSITIVE_INFINITY);
    expect(ledger.getSummary().totalDownloaded).toBe(0);

    // canDownload allows anything up to balance
    expect(ledger.canDownload(10 * 1024 * 1024)).toBe(true);
  });

  it("ratio becomes finite and balance decreases once downloads are recorded", () => {
    const ledger = createCreditLedger();

    // Seed 10 MB
    ledger.recordUpload({
      peerPubkey: "seeder",
      bytes: 10 * 1024 * 1024,
      chunkHash: "seed-root",
      receiptSignature: "sig-seed",
      timestamp: 1
    });

    expect(ledger.getSummary().ratio).toBe(Number.POSITIVE_INFINITY);

    // User consumes 3 MB video (GET_CHUNK records download credit)
    ledger.recordDownload({
      peerPubkey: "provider-1",
      bytes: 3 * 1024 * 1024,
      chunkHash: "video-chunk-1",
      receiptSignature: "p2p-fetch",
      timestamp: 2
    });

    const summary = ledger.getSummary();
    expect(Number.isFinite(summary.ratio)).toBe(true);
    expect(summary.ratio).toBeCloseTo(10 / 3, 5);
    expect(summary.balance).toBe(7 * 1024 * 1024);
    expect(summary.totalDownloaded).toBe(3 * 1024 * 1024);
  });

  it("simulates realistic multi-chunk content download debiting balance per chunk", () => {
    const ledger = createCreditLedger();
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB chunks
    const NUM_CHUNKS = 6; // 30 MB total content

    // User has earned 50 MB via seeding
    ledger.recordUpload({
      peerPubkey: "seeder",
      bytes: 50 * 1024 * 1024,
      chunkHash: "seed-all",
      receiptSignature: "sig-seed",
      timestamp: 1
    });

    // Pre-download check
    expect(ledger.canDownload(NUM_CHUNKS * CHUNK_SIZE)).toBe(true);

    // Download each chunk, recording credit for each P2P fetch
    for (let i = 0; i < NUM_CHUNKS; i++) {
      ledger.recordDownload({
        peerPubkey: `provider-${i}`,
        bytes: CHUNK_SIZE,
        chunkHash: `content-chunk-${i}`,
        receiptSignature: "p2p-fetch",
        timestamp: 10 + i
      });
    }

    // After consuming 30 MB, balance should be 20 MB
    expect(ledger.getBalance()).toBe(20 * 1024 * 1024);
    expect(ledger.getSummary().totalDownloaded).toBe(30 * 1024 * 1024);

    // Should still be able to download another 20 MB content
    expect(ledger.canDownload(20 * 1024 * 1024)).toBe(true);
    expect(ledger.canDownload(20 * 1024 * 1024 + 1)).toBe(false);
  });

  it("gate blocks when user has never seeded or earned credits", () => {
    const ledger = createCreditLedger();

    expect(ledger.getBalance()).toBe(0);
    expect(ledger.canDownload(1)).toBe(false);
    expect(ledger.getSummary().totalUploaded).toBe(0);
    expect(ledger.getSummary().totalDownloaded).toBe(0);
  });

  it("gate re-opens after earning credits post-exhaustion", () => {
    const ledger = createCreditLedger();

    // Earn 5 MB
    ledger.recordUpload({
      peerPubkey: "peer-a",
      bytes: 5 * 1024 * 1024,
      chunkHash: "seed-1",
      receiptSignature: "s1",
      timestamp: 1
    });

    // Consume 5 MB — balance exhausted
    ledger.recordDownload({
      peerPubkey: "peer-b",
      bytes: 5 * 1024 * 1024,
      chunkHash: "dl-1",
      receiptSignature: "s2",
      timestamp: 2
    });

    expect(ledger.getBalance()).toBe(0);
    expect(ledger.canDownload(1024)).toBe(false);

    // Earn 2 MB more by seeding
    ledger.recordUpload({
      peerPubkey: "peer-c",
      bytes: 2 * 1024 * 1024,
      chunkHash: "seed-2",
      receiptSignature: "s3",
      timestamp: 3
    });

    expect(ledger.getBalance()).toBe(2 * 1024 * 1024);
    expect(ledger.canDownload(1024)).toBe(true);
    expect(ledger.canDownload(2 * 1024 * 1024)).toBe(true);
    expect(ledger.canDownload(2 * 1024 * 1024 + 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SERVE_CHUNK bridge message validation
// ---------------------------------------------------------------------------

describe("credit gating — SERVE_CHUNK message validation", () => {
  it("accepts valid SERVE_CHUNK messages", () => {
    expect(
      isEntropyRuntimeMessage({
        source: ENTROPY_WEB_SOURCE,
        requestId: "req-1",
        type: "SERVE_CHUNK",
        payload: {
          chunkHash: "abc123",
          requestedBytes: 5242880,
          peerPubkey: "npub1peer"
        }
      })
    ).toBe(true);
  });

  it("rejects SERVE_CHUNK with missing payload", () => {
    expect(
      isEntropyRuntimeMessage({
        source: ENTROPY_WEB_SOURCE,
        requestId: "req-1",
        type: "SERVE_CHUNK"
      })
    ).toBe(false);
  });

  it("rejects SERVE_CHUNK with incomplete payload", () => {
    expect(
      isEntropyRuntimeMessage({
        source: ENTROPY_WEB_SOURCE,
        requestId: "req-1",
        type: "SERVE_CHUNK",
        payload: {
          chunkHash: "abc123"
          // missing requestedBytes, peerPubkey
        }
      })
    ).toBe(false);
  });

  it("validates SERVE_CHUNK runtime response with credit summary", () => {
    expect(
      isEntropyRuntimeResponse({
        ok: true,
        requestId: "req-1",
        type: "SERVE_CHUNK",
        payload: {
          totalUploaded: 1024,
          totalDownloaded: 512,
          ratio: 2,
          balance: 512,
          entryCount: 1,
          coldStorageEligible: false,
          integrityValid: true,
          trustScore: 100,
          receiptVerifiedEntries: 0,
          history: []
        }
      })
    ).toBe(true);
  });

  it("validates SERVE_CHUNK error response for insufficient credit", () => {
    expect(
      isEntropyRuntimeResponse({
        ok: false,
        requestId: "req-1",
        type: "SERVE_CHUNK",
        error: "INSUFFICIENT_CREDIT"
      })
    ).toBe(true);
  });
});
