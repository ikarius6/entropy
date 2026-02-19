export interface CreditEntry {
  id: string;
  peerPubkey: string;
  direction: "up" | "down";
  bytes: number;
  chunkHash: string;
  receiptSignature: string;
  timestamp: number;
}

export interface LedgerSummary {
  totalUploaded: number;
  totalDownloaded: number;
  ratio: number;
  balance: number;
  entryCount: number;
}

export type CreditEntryInput = Omit<CreditEntry, "id" | "direction">;

function createCreditEntryId(prefix = "credit"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isFinitePositiveInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function validateCreditEntryInput(entry: CreditEntryInput): void {
  if (
    entry.peerPubkey.length === 0 ||
    entry.chunkHash.length === 0 ||
    entry.receiptSignature.length === 0 ||
    !isFinitePositiveInteger(entry.bytes) ||
    !isFinitePositiveInteger(entry.timestamp)
  ) {
    throw new Error("Invalid credit entry input.");
  }
}

function summarize(entries: CreditEntry[]): LedgerSummary {
  const totalUploaded = entries
    .filter((entry) => entry.direction === "up")
    .reduce((sum, entry) => sum + entry.bytes, 0);

  const totalDownloaded = entries
    .filter((entry) => entry.direction === "down")
    .reduce((sum, entry) => sum + entry.bytes, 0);

  return {
    totalUploaded,
    totalDownloaded,
    ratio: totalDownloaded === 0 ? Number.POSITIVE_INFINITY : totalUploaded / totalDownloaded,
    balance: totalUploaded - totalDownloaded,
    entryCount: entries.length
  };
}

function mapEntry(direction: "up" | "down", entry: CreditEntryInput): CreditEntry {
  validateCreditEntryInput(entry);

  return {
    id: createCreditEntryId(),
    direction,
    peerPubkey: entry.peerPubkey,
    bytes: entry.bytes,
    chunkHash: entry.chunkHash,
    receiptSignature: entry.receiptSignature,
    timestamp: entry.timestamp
  };
}

export interface CreditLedger {
  recordUpload(entry: CreditEntryInput): CreditEntry;
  recordDownload(entry: CreditEntryInput): CreditEntry;
  getSummary(): LedgerSummary;
  getBalance(): number;
  canDownload(requestedBytes: number): boolean;
  getHistory(limit?: number): CreditEntry[];
  getEntries(): CreditEntry[];
}

class InMemoryCreditLedger implements CreditLedger {
  private entries: CreditEntry[];

  constructor(seedEntries: CreditEntry[] = []) {
    this.entries = [...seedEntries];
  }

  recordUpload(entry: CreditEntryInput): CreditEntry {
    const next = mapEntry("up", entry);
    this.entries.push(next);
    return next;
  }

  recordDownload(entry: CreditEntryInput): CreditEntry {
    const next = mapEntry("down", entry);
    this.entries.push(next);
    return next;
  }

  getSummary(): LedgerSummary {
    return summarize(this.entries);
  }

  getBalance(): number {
    return this.getSummary().balance;
  }

  canDownload(requestedBytes: number): boolean {
    if (!Number.isFinite(requestedBytes) || requestedBytes <= 0) {
      return false;
    }

    return this.getBalance() >= requestedBytes;
  }

  getHistory(limit?: number): CreditEntry[] {
    if (limit === undefined) {
      return [...this.entries].reverse();
    }

    const clamped = Math.max(0, Math.floor(limit));

    if (clamped === 0) {
      return [];
    }

    return this.entries.slice(-clamped).reverse();
  }

  getEntries(): CreditEntry[] {
    return [...this.entries];
  }
}

export function createCreditLedger(seedEntries: CreditEntry[] = []): CreditLedger {
  return new InMemoryCreditLedger(seedEntries);
}

export function summarizeLedgerEntries(entries: CreditEntry[]): LedgerSummary {
  return summarize(entries);
}
