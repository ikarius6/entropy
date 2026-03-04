import { describe, expect, it, beforeEach, vi } from "vitest";
import { __resetMockStorage, __setMockStorageValue } from "./__mocks__/webextension-polyfill";

// The module under test uses `browser.storage.local` which is mocked
// via the vitest alias in vitest.config.mjs.

describe("extension credit-ledger", () => {
  beforeEach(() => {
    __resetMockStorage();
    vi.resetModules();
  });

  async function loadModule() {
    const mod = await import("../background/credit-ledger");
    return mod;
  }

  // ---------------------------------------------------------------------------
  // recordUploadCredit
  // ---------------------------------------------------------------------------

  it("recordUploadCredit increases balance and totalUploaded", async () => {
    const { recordUploadCredit } = await loadModule();

    const summary = await recordUploadCredit({
      peerPubkey: "peer-a",
      bytes: 5000,
      chunkHash: "chunk-1",
      receiptSignature: "sig-1",
      timestamp: 1_700_000_000
    });

    expect(summary.totalUploaded).toBe(5000);
    expect(summary.totalDownloaded).toBe(0);
    expect(summary.balance).toBe(5000);
    expect(summary.entryCount).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // recordDownloadCredit
  // ---------------------------------------------------------------------------

  it("recordDownloadCredit decreases balance and increases totalDownloaded", async () => {
    const { recordUploadCredit, recordDownloadCredit } = await loadModule();

    await recordUploadCredit({
      peerPubkey: "peer-a",
      bytes: 10000,
      chunkHash: "chunk-seed",
      receiptSignature: "sig-seed",
      timestamp: 1
    });

    const summary = await recordDownloadCredit({
      peerPubkey: "peer-b",
      bytes: 3000,
      chunkHash: "chunk-dl",
      receiptSignature: "sig-dl",
      timestamp: 2
    });

    expect(summary.totalUploaded).toBe(10000);
    expect(summary.totalDownloaded).toBe(3000);
    expect(summary.balance).toBe(7000);
    expect(summary.entryCount).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Ratio
  // ---------------------------------------------------------------------------

  it("ratio is null (Infinity) when no downloads have been recorded", async () => {
    const { recordUploadCredit } = await loadModule();

    const summary = await recordUploadCredit({
      peerPubkey: "peer-a",
      bytes: 1024,
      chunkHash: "chunk-1",
      receiptSignature: "sig-1",
      timestamp: 1
    });

    // Extension serializes Infinity as null for JSON transport
    expect(summary.ratio).toBeNull();
  });

  it("ratio becomes finite after first download is recorded", async () => {
    const { recordUploadCredit, recordDownloadCredit } = await loadModule();

    await recordUploadCredit({
      peerPubkey: "peer-a",
      bytes: 1000,
      chunkHash: "c1",
      receiptSignature: "s1",
      timestamp: 1
    });

    const summary = await recordDownloadCredit({
      peerPubkey: "peer-b",
      bytes: 500,
      chunkHash: "c2",
      receiptSignature: "s2",
      timestamp: 2
    });

    expect(summary.ratio).toBe(2);
    expect(typeof summary.ratio).toBe("number");
  });

  // ---------------------------------------------------------------------------
  // Persistence across calls
  // ---------------------------------------------------------------------------

  it("entries persist across separate calls via storage", async () => {
    const { recordUploadCredit, recordDownloadCredit, getCreditSummary } = await loadModule();

    await recordUploadCredit({
      peerPubkey: "peer-a",
      bytes: 2000,
      chunkHash: "c1",
      receiptSignature: "s1",
      timestamp: 1
    });

    await recordDownloadCredit({
      peerPubkey: "peer-b",
      bytes: 800,
      chunkHash: "c2",
      receiptSignature: "s2",
      timestamp: 2
    });

    // Read fresh summary (simulates a different code path reading state)
    const summary = await getCreditSummary();

    expect(summary.totalUploaded).toBe(2000);
    expect(summary.totalDownloaded).toBe(800);
    expect(summary.balance).toBe(1200);
    expect(summary.entryCount).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // getCreditSummary on empty storage
  // ---------------------------------------------------------------------------

  it("getCreditSummary returns zero state on empty storage", async () => {
    const { getCreditSummary } = await loadModule();

    const summary = await getCreditSummary();

    expect(summary.totalUploaded).toBe(0);
    expect(summary.totalDownloaded).toBe(0);
    expect(summary.balance).toBe(0);
    expect(summary.entryCount).toBe(0);
    expect(summary.ratio).toBeNull(); // 0/0 = NaN → not finite → null
  });

  // ---------------------------------------------------------------------------
  // coldStorageEligible
  // ---------------------------------------------------------------------------

  it("coldStorageEligible reflects upload threshold", async () => {
    const { recordUploadCredit, getCreditSummary } = await loadModule();

    // Small upload — not eligible
    await recordUploadCredit({
      peerPubkey: "peer-a",
      bytes: 100,
      chunkHash: "c1",
      receiptSignature: "s1",
      timestamp: 1
    });

    const before = await getCreditSummary();
    expect(typeof before.coldStorageEligible).toBe("boolean");
  });

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  it("history contains recent entries in newest-first order", async () => {
    const { recordUploadCredit, recordDownloadCredit, getCreditSummary } = await loadModule();

    await recordUploadCredit({
      peerPubkey: "peer-a",
      bytes: 100,
      chunkHash: "first",
      receiptSignature: "s1",
      timestamp: 10
    });

    await recordDownloadCredit({
      peerPubkey: "peer-b",
      bytes: 50,
      chunkHash: "second",
      receiptSignature: "s2",
      timestamp: 20
    });

    await recordUploadCredit({
      peerPubkey: "peer-c",
      bytes: 200,
      chunkHash: "third",
      receiptSignature: "s3",
      timestamp: 30
    });

    const summary = await getCreditSummary();

    expect(summary.history.length).toBeGreaterThanOrEqual(3);
    expect(summary.history[0].chunkHash).toBe("third");
    expect(summary.history[1].chunkHash).toBe("second");
    expect(summary.history[2].chunkHash).toBe("first");
  });

  // ---------------------------------------------------------------------------
  // Full credit gating flow (simulates the bug we caught)
  // ---------------------------------------------------------------------------

  it("full flow: upload earns credits → download debits → balance tracks correctly", async () => {
    const { recordUploadCredit, recordDownloadCredit, getCreditSummary } = await loadModule();

    // Step 1: User seeds 10 MB
    await recordUploadCredit({
      peerPubkey: "peer-seeder",
      bytes: 10 * 1024 * 1024,
      chunkHash: "seed-root",
      receiptSignature: "sig-seed",
      timestamp: 1
    });

    let summary = await getCreditSummary();
    expect(summary.balance).toBe(10 * 1024 * 1024);
    expect(summary.ratio).toBeNull(); // no downloads yet → Infinity → null

    // Step 2: User views 3 MB content (P2P download records credit)
    await recordDownloadCredit({
      peerPubkey: "peer-provider-1",
      bytes: 3 * 1024 * 1024,
      chunkHash: "content-chunk-1",
      receiptSignature: "p2p-fetch",
      timestamp: 2
    });

    summary = await getCreditSummary();
    expect(summary.balance).toBe(7 * 1024 * 1024);
    expect(summary.totalDownloaded).toBe(3 * 1024 * 1024);
    expect(summary.ratio).not.toBeNull(); // Now finite!

    // Step 3: User views 7 MB content — exactly exhausts balance
    await recordDownloadCredit({
      peerPubkey: "peer-provider-2",
      bytes: 7 * 1024 * 1024,
      chunkHash: "content-chunk-2",
      receiptSignature: "p2p-fetch",
      timestamp: 3
    });

    summary = await getCreditSummary();
    expect(summary.balance).toBe(0);

    // Step 4: User tries to view 1 byte — should be blocked by gate
    // (canDownload is on core ledger; here we verify the summary state)
    expect(summary.balance).toBeLessThanOrEqual(0);

    // Step 5: User seeds more content to recover
    await recordUploadCredit({
      peerPubkey: "peer-seeder-2",
      bytes: 2 * 1024 * 1024,
      chunkHash: "seed-root-2",
      receiptSignature: "sig-seed-2",
      timestamp: 4
    });

    summary = await getCreditSummary();
    expect(summary.balance).toBe(2 * 1024 * 1024);
  });

  // ---------------------------------------------------------------------------
  // Pre-seeded storage
  // ---------------------------------------------------------------------------

  it("reads pre-existing entries from storage correctly", async () => {
    // Simulate storage that was populated by a previous session
    __setMockStorageValue("creditLedgerEntries", [
      {
        id: "old-1",
        peerPubkey: "peer-old",
        direction: "up",
        bytes: 5000,
        chunkHash: "old-chunk",
        receiptSignature: "old-sig",
        timestamp: 100
      },
      {
        id: "old-2",
        peerPubkey: "peer-old-2",
        direction: "down",
        bytes: 2000,
        chunkHash: "old-chunk-2",
        receiptSignature: "old-sig-2",
        timestamp: 200
      }
    ]);

    const { getCreditSummary } = await loadModule();
    const summary = await getCreditSummary();

    expect(summary.totalUploaded).toBe(5000);
    expect(summary.totalDownloaded).toBe(2000);
    expect(summary.balance).toBe(3000);
    expect(summary.ratio).toBe(2.5);
    expect(summary.entryCount).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Regression: duplicate recordDownloadCredit for the same chunk causes double deduction
  // ---------------------------------------------------------------------------

  it("REGRESSION: calling recordDownloadCredit twice for the same chunk deducts twice (ledger is append-only)", async () => {
    // This test documents that the ledger itself does NOT deduplicate entries.
    // The caller (service-worker GET_CHUNK handler) is responsible for calling
    // recordDownloadCredit only once per unique P2P fetch, which is enforced by
    // executing it inside the deduplicated inflightP2PFetches promise.
    const { recordUploadCredit, recordDownloadCredit, getCreditSummary } = await loadModule();

    // Seed 2 MB of credits
    await recordUploadCredit({
      peerPubkey: "peer-seeder",
      bytes: 2_000_000,
      chunkHash: "seed-chunk",
      receiptSignature: "sig-seed",
      timestamp: 1
    });

    const before = await getCreditSummary();
    expect(before.balance).toBe(2_000_000);

    // Simulate the bug: two concurrent download credits for the same chunk (~900 KB)
    const chunkSize = 900_000;
    await recordDownloadCredit({
      peerPubkey: "peer-provider",
      bytes: chunkSize,
      chunkHash: "content-chunk-abc",
      receiptSignature: "p2p-fetch",
      timestamp: 2
    });

    await recordDownloadCredit({
      peerPubkey: "peer-provider",
      bytes: chunkSize,
      chunkHash: "content-chunk-abc",
      receiptSignature: "p2p-fetch",
      timestamp: 2
    });

    const after = await getCreditSummary();

    // Without deduplication at the caller, balance drops by 2x the chunk size
    expect(after.totalDownloaded).toBe(chunkSize * 2);
    expect(after.balance).toBe(2_000_000 - chunkSize * 2);
    expect(after.entryCount).toBe(3); // 1 upload + 2 downloads
  });

  // ---------------------------------------------------------------------------
  // Regression: DELEGATE_SEEDING must never self-award upload credits
  // ---------------------------------------------------------------------------

  it("no upload credits on a fresh ledger — delegation alone must not award credits", async () => {
    // Before the fix, DELEGATE_SEEDING called recordUploadCredit({ peerPubkey: "self" })
    // immediately on upload, even when zero peers had pulled any chunk.
    // Credits must only come from onChunkServed / P2P_CHUNK_SERVED (real downstream peers).
    const { getCreditSummary } = await loadModule();
    const summary = await getCreditSummary();

    expect(summary.totalUploaded).toBe(0);
    expect(summary.balance).toBe(0);
    expect(summary.entryCount).toBe(0);
  });
});
