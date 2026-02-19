import { describe, expect, it } from "vitest";

import { createCreditLedger, summarizeLedgerEntries, type CreditEntry } from "../credits/ledger";

describe("credit ledger", () => {
  it("records uploads and downloads and computes summary", () => {
    const ledger = createCreditLedger();

    ledger.recordUpload({
      peerPubkey: "npub1receiver",
      bytes: 2048,
      chunkHash: "chunk-a",
      receiptSignature: "sig-a",
      timestamp: 1_700_000_000
    });

    ledger.recordDownload({
      peerPubkey: "npub1sender",
      bytes: 512,
      chunkHash: "chunk-b",
      receiptSignature: "sig-b",
      timestamp: 1_700_000_010
    });

    const summary = ledger.getSummary();

    expect(summary.totalUploaded).toBe(2048);
    expect(summary.totalDownloaded).toBe(512);
    expect(summary.balance).toBe(1536);
    expect(summary.ratio).toBe(4);
    expect(summary.entryCount).toBe(2);
    expect(ledger.canDownload(1000)).toBe(true);
    expect(ledger.canDownload(2000)).toBe(false);
  });

  it("returns ratio Infinity when there are no downloads", () => {
    const ledger = createCreditLedger();

    ledger.recordUpload({
      peerPubkey: "npub1receiver",
      bytes: 1024,
      chunkHash: "chunk-a",
      receiptSignature: "sig-a",
      timestamp: 1_700_000_000
    });

    expect(ledger.getSummary().ratio).toBe(Number.POSITIVE_INFINITY);
  });

  it("returns history newest-first and respects limit", () => {
    const ledger = createCreditLedger();

    ledger.recordUpload({
      peerPubkey: "peer-1",
      bytes: 100,
      chunkHash: "chunk-1",
      receiptSignature: "sig-1",
      timestamp: 10
    });

    ledger.recordUpload({
      peerPubkey: "peer-2",
      bytes: 200,
      chunkHash: "chunk-2",
      receiptSignature: "sig-2",
      timestamp: 20
    });

    ledger.recordDownload({
      peerPubkey: "peer-3",
      bytes: 50,
      chunkHash: "chunk-3",
      receiptSignature: "sig-3",
      timestamp: 30
    });

    const latestTwo = ledger.getHistory(2);

    expect(latestTwo).toHaveLength(2);
    expect(latestTwo[0].chunkHash).toBe("chunk-3");
    expect(latestTwo[1].chunkHash).toBe("chunk-2");
  });

  it("can summarize plain entry arrays", () => {
    const entries: CreditEntry[] = [
      {
        id: "a",
        peerPubkey: "peer",
        direction: "up",
        bytes: 120,
        chunkHash: "chunk-a",
        receiptSignature: "sig-a",
        timestamp: 1
      },
      {
        id: "b",
        peerPubkey: "peer",
        direction: "down",
        bytes: 20,
        chunkHash: "chunk-b",
        receiptSignature: "sig-b",
        timestamp: 2
      }
    ];

    const summary = summarizeLedgerEntries(entries);

    expect(summary.totalUploaded).toBe(120);
    expect(summary.totalDownloaded).toBe(20);
    expect(summary.balance).toBe(100);
    expect(summary.ratio).toBe(6);
  });

  it("rejects invalid entries", () => {
    const ledger = createCreditLedger();

    expect(() =>
      ledger.recordUpload({
        peerPubkey: "",
        bytes: 120,
        chunkHash: "chunk-a",
        receiptSignature: "sig-a",
        timestamp: 1
      })
    ).toThrowError("Invalid credit entry input.");
  });
});
