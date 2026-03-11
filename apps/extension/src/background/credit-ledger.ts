import browser from "webextension-polyfill";
import {
  createCreditLedger,
  isEligibleForColdStorage,
  computeIntegrityHash,
  verifyIntegrityChain,
  logger,
  type CreditEntry,
  type CreditEntryInput,
  type CreditSummaryPayload,
  type CreditHistoryPayload,
  type IntegrityVerificationResult
} from "@entropy/core";

interface CreditStorageSchema {
  creditLedgerEntries: CreditEntry[];
}

const STORAGE_KEY = "creditLedgerEntries";

async function toCreditSummaryPayload(entries: CreditEntry[]): Promise<CreditSummaryPayload> {
  const ledger = createCreditLedger(entries);
  const summary = ledger.getSummary();

  const integrity = await verifyIntegrityChain(entries);

  const receiptVerified = entries.filter(
    (e) => e.direction === "up" && e.receiptSignature.length === 128 && /^[0-9a-f]{128}$/.test(e.receiptSignature)
  ).length;

  const uploadEntries = entries.filter((e) => e.direction === "up").length;
  const trustScore = entries.length > 0 && uploadEntries > 0
    ? Math.round((receiptVerified / uploadEntries) * 100)
    : (entries.length === 0 ? 100 : 0);

  return {
    ...summary,
    ratio: Number.isFinite(summary.ratio) ? summary.ratio : null,
    coldStorageEligible: integrity.valid ? isEligibleForColdStorage(summary) : false,
    integrityValid: integrity.valid,
    trustScore,
    receiptVerifiedEntries: receiptVerified,
    history: ledger.getHistory(20).map((entry) => ({
      id: entry.id,
      peerPubkey: entry.peerPubkey,
      direction: entry.direction,
      bytes: entry.bytes,
      chunkHash: entry.chunkHash,
      rootHash: entry.rootHash,
      timestamp: entry.timestamp
    }))
  };
}

async function readCreditEntries(): Promise<CreditEntry[]> {
  const stored = (await browser.storage.local.get(STORAGE_KEY)) as Partial<CreditStorageSchema>;
  return Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
}

async function writeCreditEntries(entries: CreditEntry[]): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: entries });
}

async function stampIntegrityHash(entries: CreditEntry[]): Promise<CreditEntry[]> {
  if (entries.length === 0) {
    return entries;
  }

  const lastEntry = entries[entries.length - 1];

  if (lastEntry.integrityHash) {
    return entries;
  }

  const previousHash = entries.length >= 2
    ? (entries[entries.length - 2].integrityHash ?? "")
    : "";

  const hash = await computeIntegrityHash(lastEntry, previousHash);
  const stamped = [...entries];
  stamped[stamped.length - 1] = { ...lastEntry, integrityHash: hash };

  return stamped;
}

export async function recordUploadCredit(entry: CreditEntryInput): Promise<CreditSummaryPayload> {
  let entries = await readCreditEntries();
  entries = await enforceIntegrity(entries);

  const ledger = createCreditLedger(entries);
  ledger.recordUpload(entry);

  const nextEntries = await stampIntegrityHash(ledger.getEntries());
  await writeCreditEntries(nextEntries);

  return toCreditSummaryPayload(nextEntries);
}

export async function recordDownloadCredit(entry: CreditEntryInput): Promise<CreditSummaryPayload> {
  let entries = await readCreditEntries();
  entries = await enforceIntegrity(entries);

  const ledger = createCreditLedger(entries);
  ledger.recordDownload(entry);

  const nextEntries = await stampIntegrityHash(ledger.getEntries());
  await writeCreditEntries(nextEntries);

  return toCreditSummaryPayload(nextEntries);
}

export async function verifyLedgerIntegrity(): Promise<IntegrityVerificationResult> {
  const entries = await readCreditEntries();
  return verifyIntegrityChain(entries);
}

export async function getLedgerEntries(): Promise<CreditEntry[]> {
  return readCreditEntries();
}

export async function resetLedger(): Promise<void> {
  logger.warn("[credit-ledger] ⚠ RESETTING ledger — integrity chain was corrupted");
  await writeCreditEntries([]);
}

async function enforceIntegrity(entries: CreditEntry[]): Promise<CreditEntry[]> {
  if (entries.length === 0) {
    return entries;
  }

  const integrity = await verifyIntegrityChain(entries);

  if (!integrity.valid) {
    logger.warn(
      "[credit-ledger] ⚠ INTEGRITY VIOLATION detected at index",
      integrity.firstCorruptedIndex,
      "— resetting ledger (",
      entries.length,
      "entries discarded)"
    );
    await resetLedger();
    return [];
  }

  return entries;
}

export async function getCreditSummary(): Promise<CreditSummaryPayload> {
  const entries = await readCreditEntries();
  return toCreditSummaryPayload(entries);
}

export async function getFullCreditHistory(): Promise<CreditHistoryPayload> {
  const entries = await readCreditEntries();
  const ledger = createCreditLedger(entries);
  const summary = ledger.getSummary();

  // Compute running balance for each entry (chronological order)
  let runningBalance = 0;
  const entriesWithBalance = entries.map((entry) => {
    if (entry.direction === "up") {
      runningBalance += entry.bytes;
    } else {
      runningBalance -= entry.bytes;
    }
    return {
      id: entry.id,
      peerPubkey: entry.peerPubkey,
      direction: entry.direction,
      bytes: entry.bytes,
      chunkHash: entry.chunkHash,
      rootHash: entry.rootHash,
      receiptSignature: entry.receiptSignature,
      timestamp: entry.timestamp,
      balanceAfter: runningBalance
    };
  });

  // Detect duplicate download charges (same chunkHash charged more than once)
  const downloadsByChunk = new Map<string, { rootHash?: string; count: number; totalBytes: number }>();
  for (const entry of entries) {
    if (entry.direction !== "down") continue;
    const existing = downloadsByChunk.get(entry.chunkHash);
    if (existing) {
      existing.count++;
      existing.totalBytes += entry.bytes;
    } else {
      downloadsByChunk.set(entry.chunkHash, {
        rootHash: entry.rootHash,
        count: 1,
        totalBytes: entry.bytes
      });
    }
  }

  const duplicateChunks = Array.from(downloadsByChunk.entries())
    .filter(([, info]) => info.count > 1)
    .map(([chunkHash, info]) => ({
      chunkHash,
      rootHash: info.rootHash,
      count: info.count,
      totalBytes: info.totalBytes
    }));

  // Return newest-first for display
  return {
    entries: entriesWithBalance.reverse(),
    totalEntries: entries.length,
    currentBalance: summary.balance,
    duplicateChunks
  };
}
