import browser from "webextension-polyfill";
import {
  createCreditLedger,
  isEligibleForColdStorage,
  type CreditEntry,
  type CreditEntryInput,
  type CreditSummaryPayload
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

export async function recordUploadCredit(entry: CreditEntryInput): Promise<CreditSummaryPayload> {
  const entries = await readCreditEntries();
  const ledger = createCreditLedger(entries);
  ledger.recordUpload(entry);

  const nextEntries = ledger.getEntries();
  await writeCreditEntries(nextEntries);

  return toCreditSummaryPayload(nextEntries);
}

export async function recordDownloadCredit(entry: CreditEntryInput): Promise<CreditSummaryPayload> {
  const entries = await readCreditEntries();
  const ledger = createCreditLedger(entries);
  ledger.recordDownload(entry);

  const nextEntries = ledger.getEntries();
  await writeCreditEntries(nextEntries);

  return toCreditSummaryPayload(nextEntries);
}

export async function getCreditSummary(): Promise<CreditSummaryPayload> {
  return toCreditSummaryPayload(await readCreditEntries());
}
