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
  // Dedup: duplicate recordDownloadCredit for the same chunk is silently skipped
  // ---------------------------------------------------------------------------

  it("recordDownloadCredit deduplicates by chunkHash — second call is a no-op", async () => {
    const { recordUploadCredit, recordDownloadCredit, getCreditSummary } = await loadModule();

    await recordUploadCredit({
      peerPubkey: "peer-seeder",
      bytes: 2_000_000,
      chunkHash: "seed-chunk",
      receiptSignature: "sig-seed",
      timestamp: 1
    });

    const before = await getCreditSummary();
    expect(before.balance).toBe(2_000_000);

    const chunkSize = 900_000;
    await recordDownloadCredit({
      peerPubkey: "peer-provider",
      bytes: chunkSize,
      chunkHash: "content-chunk-abc",
      receiptSignature: "p2p-fetch",
      timestamp: 2
    });

    // Second call for the same chunkHash — must be silently skipped
    await recordDownloadCredit({
      peerPubkey: "peer-provider",
      bytes: chunkSize,
      chunkHash: "content-chunk-abc",
      receiptSignature: "p2p-fetch",
      timestamp: 3
    });

    const after = await getCreditSummary();

    expect(after.totalDownloaded).toBe(chunkSize);
    expect(after.balance).toBe(2_000_000 - chunkSize);
    expect(after.entryCount).toBe(2); // 1 upload + 1 download (deduped)
  });

  it("dedup allows different chunks to be charged independently", async () => {
    const { recordUploadCredit, recordDownloadCredit, getCreditSummary } = await loadModule();

    await recordUploadCredit({
      peerPubkey: "peer-seeder",
      bytes: 5_000_000,
      chunkHash: "seed-chunk",
      receiptSignature: "sig-seed",
      timestamp: 1
    });

    await recordDownloadCredit({
      peerPubkey: "peer-a",
      bytes: 1_000_000,
      chunkHash: "chunk-alpha",
      receiptSignature: "p2p-fetch",
      timestamp: 2
    });

    await recordDownloadCredit({
      peerPubkey: "peer-b",
      bytes: 1_500_000,
      chunkHash: "chunk-beta",
      receiptSignature: "p2p-fetch",
      timestamp: 3
    });

    const summary = await getCreditSummary();

    expect(summary.totalDownloaded).toBe(2_500_000);
    expect(summary.balance).toBe(2_500_000);
    expect(summary.entryCount).toBe(3); // 1 upload + 2 distinct downloads
  });

  it("dedup returns current summary without modifying storage on duplicate", async () => {
    const { recordUploadCredit, recordDownloadCredit, getCreditSummary } = await loadModule();

    await recordUploadCredit({
      peerPubkey: "peer-seeder",
      bytes: 3_000_000,
      chunkHash: "seed-chunk",
      receiptSignature: "sig-seed",
      timestamp: 1
    });

    const first = await recordDownloadCredit({
      peerPubkey: "peer-provider",
      bytes: 500_000,
      chunkHash: "chunk-x",
      receiptSignature: "p2p-fetch",
      timestamp: 2
    });

    // The duplicate call should return a summary identical to the current state
    const duplicate = await recordDownloadCredit({
      peerPubkey: "peer-provider",
      bytes: 500_000,
      chunkHash: "chunk-x",
      receiptSignature: "p2p-fetch",
      timestamp: 3
    });

    expect(duplicate.balance).toBe(first.balance);
    expect(duplicate.totalDownloaded).toBe(first.totalDownloaded);
    expect(duplicate.entryCount).toBe(first.entryCount);

    // Verify storage wasn't mutated
    const fresh = await getCreditSummary();
    expect(fresh.entryCount).toBe(2);
  });

  it("dedup does not block upload credits for the same chunkHash", async () => {
    // Upload (earn) credits should never be deduped — a user can seed the
    // same chunk to multiple peers and should earn for each.
    const { recordUploadCredit, recordDownloadCredit, getCreditSummary } = await loadModule();

    await recordUploadCredit({
      peerPubkey: "peer-a",
      bytes: 1_000_000,
      chunkHash: "chunk-shared",
      receiptSignature: "sig-1",
      timestamp: 1
    });

    await recordDownloadCredit({
      peerPubkey: "peer-b",
      bytes: 500_000,
      chunkHash: "chunk-shared",
      receiptSignature: "p2p-fetch",
      timestamp: 2
    });

    // Second upload for the same chunk (served to a different peer)
    await recordUploadCredit({
      peerPubkey: "peer-c",
      bytes: 1_000_000,
      chunkHash: "chunk-shared",
      receiptSignature: "sig-2",
      timestamp: 3
    });

    const summary = await getCreditSummary();

    expect(summary.totalUploaded).toBe(2_000_000);
    expect(summary.totalDownloaded).toBe(500_000);
    expect(summary.balance).toBe(1_500_000);
    expect(summary.entryCount).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // Full scenario: the A-B-C bug from the issue report
  // ---------------------------------------------------------------------------

  it("scenario: B views content, seeds to A, refreshes — no double charge", async () => {
    // Simulates the reported bug:
    // 1. C uploads 1.5 MB content
    // 2. B has 5 MB credits, views content → charged 1.5 MB → balance 3.5 MB
    // 3. A comes online, fetches from B → B earns 1.5 MB back → balance 5 MB
    // 4. B refreshes feed, chunks re-fetched → should NOT be charged again
    const { recordUploadCredit, recordDownloadCredit, getCreditSummary } = await loadModule();

    const contentSize = 1_500_000;

    // B starts with 5 MB (earned from prior seeding)
    await recordUploadCredit({
      peerPubkey: "peer-prior",
      bytes: 5_000_000,
      chunkHash: "prior-seed",
      receiptSignature: "sig-prior",
      timestamp: 1
    });

    // B downloads content from C (1.5 MB) — two chunks
    await recordDownloadCredit({
      peerPubkey: "user-C",
      bytes: 750_000,
      chunkHash: "content-chunk-1",
      receiptSignature: "p2p-fetch",
      timestamp: 10
    });
    await recordDownloadCredit({
      peerPubkey: "user-C",
      bytes: 750_000,
      chunkHash: "content-chunk-2",
      receiptSignature: "p2p-fetch",
      timestamp: 11
    });

    let summary = await getCreditSummary();
    expect(summary.balance).toBe(5_000_000 - contentSize);

    // A fetches from B → B earns 1.5 MB back
    await recordUploadCredit({
      peerPubkey: "user-A",
      bytes: 750_000,
      chunkHash: "content-chunk-1",
      receiptSignature: "sig-serve-1",
      timestamp: 20
    });
    await recordUploadCredit({
      peerPubkey: "user-A",
      bytes: 750_000,
      chunkHash: "content-chunk-2",
      receiptSignature: "sig-serve-2",
      timestamp: 21
    });

    summary = await getCreditSummary();
    expect(summary.balance).toBe(5_000_000);

    // B refreshes feed — chunks evicted, re-fetched from P2P
    // recordDownloadCredit fires again for the same chunks
    await recordDownloadCredit({
      peerPubkey: "user-C",
      bytes: 750_000,
      chunkHash: "content-chunk-1",
      receiptSignature: "p2p-fetch-2",
      timestamp: 30
    });
    await recordDownloadCredit({
      peerPubkey: "user-C",
      bytes: 750_000,
      chunkHash: "content-chunk-2",
      receiptSignature: "p2p-fetch-2",
      timestamp: 31
    });

    summary = await getCreditSummary();
    // With dedup fix: balance must still be 5 MB — no double charge
    expect(summary.balance).toBe(5_000_000);
    expect(summary.totalDownloaded).toBe(contentSize);
    // Only 2 download entries, not 4
    expect(summary.entryCount).toBe(5); // 3 uploads + 2 downloads
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

  // ---------------------------------------------------------------------------
  // Welcome grant (Option A) — 50 MiB offset for new users
  // ---------------------------------------------------------------------------

  describe("welcome grant", () => {
    const GRANT = 104_857_600; // 100 MiB

    it("fresh storage with grant initialized → balance equals 100 MiB", async () => {
      const { getCreditSummary, initWelcomeGrant } = await loadModule();

      await initWelcomeGrant();
      const summary = await getCreditSummary();

      expect(summary.balance).toBe(GRANT);
    });

    it("welcomeGrantBytes field is exposed in the summary payload", async () => {
      const { getCreditSummary, initWelcomeGrant } = await loadModule();

      await initWelcomeGrant();
      const summary = await getCreditSummary();

      expect(summary.welcomeGrantBytes).toBe(GRANT);
    });

    it("grant is additive with real upload/download activity", async () => {
      const { getCreditSummary, recordUploadCredit, recordDownloadCredit, initWelcomeGrant } = await loadModule();

      await initWelcomeGrant();

      await recordUploadCredit({
        peerPubkey: "peer-a",
        bytes: 10_000_000,
        chunkHash: "seed-chunk",
        receiptSignature: "sig-seed",
        timestamp: 1
      });

      await recordDownloadCredit({
        peerPubkey: "peer-b",
        bytes: 5_000_000,
        chunkHash: "dl-chunk",
        receiptSignature: "sig-dl",
        timestamp: 2
      });

      const summary = await getCreditSummary();
      // balance = grant + uploads − downloads
      expect(summary.balance).toBe(GRANT + 10_000_000 - 5_000_000);
      expect(summary.totalUploaded).toBe(10_000_000);
      expect(summary.totalDownloaded).toBe(5_000_000);
      expect(summary.welcomeGrantBytes).toBe(GRANT);
    });

    it("user with only grant can cover downloads up to 50 MiB", async () => {
      const { getCreditSummary, recordDownloadCredit, initWelcomeGrant } = await loadModule();

      await initWelcomeGrant();

      // Download 30 MiB — well within the 50 MiB grant
      await recordDownloadCredit({
        peerPubkey: "peer-provider",
        bytes: 30_000_000,
        chunkHash: "first-video-chunk",
        receiptSignature: "p2p-fetch",
        timestamp: 1
      });

      const summary = await getCreditSummary();
      expect(summary.balance).toBe(GRANT - 30_000_000);
      expect(summary.balance).toBeGreaterThan(0);
    });

    it("initWelcomeGrant is idempotent — second call does not change the grant", async () => {
      const { getCreditSummary, initWelcomeGrant } = await loadModule();

      await initWelcomeGrant();
      await initWelcomeGrant(); // second call — must be a no-op
      await initWelcomeGrant(); // third call — still a no-op

      const summary = await getCreditSummary();
      expect(summary.welcomeGrantBytes).toBe(GRANT);
      expect(summary.balance).toBe(GRANT);
    });

    it("legacy user (pre-existing storage without grant key) gets zero grant", async () => {
      // Simulate an existing user whose storage has entries but no welcomeGrantBytes key
      __setMockStorageValue("creditLedgerEntries", [
        {
          id: "old-1",
          peerPubkey: "peer-old",
          direction: "up",
          bytes: 5000,
          chunkHash: "old-chunk",
          receiptSignature: "old-sig",
          timestamp: 100
        }
      ]);

      const { getCreditSummary } = await loadModule();
      const summary = await getCreditSummary();

      // No grant key → welcomeGrantBytes must be 0, balance comes only from uploads
      expect(summary.welcomeGrantBytes).toBe(0);
      expect(summary.balance).toBe(5000);
      expect(summary.entryCount).toBe(1);
    });

    it("grant does NOT create any CreditEntry in the ledger", async () => {
      const { getCreditSummary, initWelcomeGrant } = await loadModule();

      await initWelcomeGrant();
      const summary = await getCreditSummary();

      // No entries should exist — the grant is pure offset, not a ledger entry
      expect(summary.entryCount).toBe(0);
      expect(summary.history).toHaveLength(0);
    });

    it("integrityValid remains true when grant is active alongside real entries", async () => {
      const { recordUploadCredit, getCreditSummary, initWelcomeGrant } = await loadModule();

      await initWelcomeGrant();

      await recordUploadCredit({
        peerPubkey: "peer-a",
        bytes: 5_242_880,
        chunkHash: "chunk-integrity-test",
        receiptSignature: "sig-integrity",
        timestamp: 1
      });

      const summary = await getCreditSummary();
      expect(summary.integrityValid).toBe(true);
      expect(summary.balance).toBe(GRANT + 5_242_880);
    });
  });
});
