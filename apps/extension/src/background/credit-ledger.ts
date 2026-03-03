import browser from "webextension-polyfill";
import {
  createCreditLedger,
  isEligibleForColdStorage,
  computeIntegrityHash,
  verifyIntegrityChain,
  type CreditEntry,
  type CreditEntryInput,
  type CreditSummaryPayload,
  type IntegrityVerificationResult
} from "@entropy/core";

interface CreditStorageSchema {
  creditLedgerEntries: CreditEntry[];
}

const STORAGE_KEY = "creditLedgerEntries";

function toCreditSummaryPayload(entries: CreditEntry[]): CreditSummaryPayload {
  const ledger = createCreditLedger(entries);
  const summary = ledger.getSummary();

  return {
    ...summary,
    ratio: Number.isFinite(summary.ratio) ? summary.ratio : null,
    coldStorageEligible: isEligibleForColdStorage(summary),
    history: ledger.getHistory(20).map((entry) => ({
      id: entry.id,
      peerPubkey: entry.peerPubkey,
      direction: entry.direction,
      bytes: entry.bytes,
      chunkHash: entry.chunkHash,
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
  const entries = await readCreditEntries();
  const ledger = createCreditLedger(entries);
  ledger.recordUpload(entry);

  const nextEntries = await stampIntegrityHash(ledger.getEntries());
  await writeCreditEntries(nextEntries);

  return toCreditSummaryPayload(nextEntries);
}

export async function recordDownloadCredit(entry: CreditEntryInput): Promise<CreditSummaryPayload> {
  const entries = await readCreditEntries();
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

export async function getCreditSummary(): Promise<CreditSummaryPayload> {
  return toCreditSummaryPayload(await readCreditEntries());
}
