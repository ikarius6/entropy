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

  it("ratio transitions from Infinity to finite after first download", () => {
    const ledger = createCreditLedger();

    ledger.recordUpload({
      peerPubkey: "peer-a",
      bytes: 1000,
      chunkHash: "c1",
      receiptSignature: "s1",
      timestamp: 1
    });

    expect(ledger.getSummary().ratio).toBe(Number.POSITIVE_INFINITY);

    ledger.recordDownload({
      peerPubkey: "peer-b",
      bytes: 500,
      chunkHash: "c2",
      receiptSignature: "s2",
      timestamp: 2
    });

    expect(ledger.getSummary().ratio).toBe(2);
    expect(Number.isFinite(ledger.getSummary().ratio)).toBe(true);
  });

  it("balance decreases after each download", () => {
    const ledger = createCreditLedger();

    ledger.recordUpload({
      peerPubkey: "peer-a",
      bytes: 1000,
      chunkHash: "c1",
      receiptSignature: "s1",
      timestamp: 1
    });

    expect(ledger.getBalance()).toBe(1000);

    ledger.recordDownload({
      peerPubkey: "peer-b",
      bytes: 300,
      chunkHash: "c2",
      receiptSignature: "s2",
      timestamp: 2
    });

    expect(ledger.getBalance()).toBe(700);

    ledger.recordDownload({
      peerPubkey: "peer-c",
      bytes: 400,
      chunkHash: "c3",
      receiptSignature: "s3",
      timestamp: 3
    });

    expect(ledger.getBalance()).toBe(300);
  });

  it("balance goes negative when downloads exceed uploads", () => {
    const ledger = createCreditLedger();

    ledger.recordUpload({
      peerPubkey: "peer-a",
      bytes: 100,
      chunkHash: "c1",
      receiptSignature: "s1",
      timestamp: 1
    });

    ledger.recordDownload({
      peerPubkey: "peer-b",
      bytes: 500,
      chunkHash: "c2",
      receiptSignature: "s2",
      timestamp: 2
    });

    expect(ledger.getBalance()).toBe(-400);
    expect(ledger.canDownload(1)).toBe(false);
  });

  it("full flow: upload → gate allows → download → gate blocks → upload → gate allows again", () => {
    const ledger = createCreditLedger();
    const CONTENT_SIZE = 5 * 1024 * 1024; // 5 MB

    // Fresh ledger: no credits, gate should block
    expect(ledger.canDownload(CONTENT_SIZE)).toBe(false);

    // Seed content (earn credits via upload)
    ledger.recordUpload({
      peerPubkey: "peer-a",
      bytes: 10 * 1024 * 1024, // 10 MB
      chunkHash: "seeded-chunk",
      receiptSignature: "sig-seed",
      timestamp: 1
    });

    // Gate should allow 5 MB download
    expect(ledger.canDownload(CONTENT_SIZE)).toBe(true);
    expect(ledger.getBalance()).toBe(10 * 1024 * 1024);

    // Consume content (download debits balance)
    ledger.recordDownload({
      peerPubkey: "peer-b",
      bytes: CONTENT_SIZE,
      chunkHash: "consumed-chunk-1",
      receiptSignature: "sig-dl-1",
      timestamp: 2
    });

    expect(ledger.getBalance()).toBe(5 * 1024 * 1024);
    expect(ledger.canDownload(CONTENT_SIZE)).toBe(true);

    // Consume again
    ledger.recordDownload({
      peerPubkey: "peer-c",
      bytes: CONTENT_SIZE,
      chunkHash: "consumed-chunk-2",
      receiptSignature: "sig-dl-2",
      timestamp: 3
    });

    expect(ledger.getBalance()).toBe(0);
    expect(ledger.canDownload(CONTENT_SIZE)).toBe(false);
    expect(ledger.canDownload(1)).toBe(false);

    // Earn more credits via seeding
    ledger.recordUpload({
      peerPubkey: "peer-d",
      bytes: 3 * 1024 * 1024,
      chunkHash: "seeded-chunk-2",
      receiptSignature: "sig-seed-2",
      timestamp: 4
    });

    expect(ledger.getBalance()).toBe(3 * 1024 * 1024);
    expect(ledger.canDownload(CONTENT_SIZE)).toBe(false); // 3 MB < 5 MB
    expect(ledger.canDownload(2 * 1024 * 1024)).toBe(true); // 3 MB >= 2 MB
  });

  it("ratio is computed correctly with multiple uploads and downloads", () => {
    const ledger = createCreditLedger();

    ledger.recordUpload({ peerPubkey: "p1", bytes: 200, chunkHash: "c1", receiptSignature: "s1", timestamp: 1 });
    ledger.recordUpload({ peerPubkey: "p2", bytes: 300, chunkHash: "c2", receiptSignature: "s2", timestamp: 2 });
    ledger.recordDownload({ peerPubkey: "p3", bytes: 100, chunkHash: "c3", receiptSignature: "s3", timestamp: 3 });
    ledger.recordDownload({ peerPubkey: "p4", bytes: 150, chunkHash: "c4", receiptSignature: "s4", timestamp: 4 });

    const summary = ledger.getSummary();
    expect(summary.totalUploaded).toBe(500);
    expect(summary.totalDownloaded).toBe(250);
    expect(summary.ratio).toBe(2);
    expect(summary.balance).toBe(250);
    expect(summary.entryCount).toBe(4);
  });

  it("initializing with seed entries preserves balance and ratio", () => {
    const seedEntries: CreditEntry[] = [
      { id: "e1", peerPubkey: "p1", direction: "up", bytes: 800, chunkHash: "c1", receiptSignature: "s1", timestamp: 1 },
      { id: "e2", peerPubkey: "p2", direction: "down", bytes: 200, chunkHash: "c2", receiptSignature: "s2", timestamp: 2 }
    ];

    const ledger = createCreditLedger(seedEntries);

    expect(ledger.getBalance()).toBe(600);
    expect(ledger.getSummary().ratio).toBe(4);
    expect(ledger.canDownload(600)).toBe(true);
    expect(ledger.canDownload(601)).toBe(false);
  });

  it("canDownload returns false for zero-balance ledger even with 0 bytes requested", () => {
    const ledger = createCreditLedger();
    expect(ledger.canDownload(0)).toBe(false);
  });
});
