import { sha256Hex } from "../crypto/hash";
import type { CreditEntry } from "./ledger";
import type { ChunkStore } from "../storage/chunk-store";
import {
  ENTROPY_UPSTREAM_RECEIPT_KIND,
  type ReceiptEventLike,
  type ReceiptSignatureVerifier
} from "./proof-of-upstream";

// ---------------------------------------------------------------------------
// Hash-chain integrity (Capa 1)
// ---------------------------------------------------------------------------

export function serializeEntryForHash(entry: CreditEntry): string {
  return [
    entry.id,
    entry.peerPubkey,
    entry.direction,
    String(entry.bytes),
    entry.chunkHash,
    entry.rootHash ?? "",
    entry.receiptSignature,
    String(entry.timestamp)
  ].join("|");
}

export async function computeIntegrityHash(
  entry: CreditEntry,
  previousHash: string
): Promise<string> {
  const payload = previousHash + ":" + serializeEntryForHash(entry);
  const encoder = new TextEncoder();
  return sha256Hex(encoder.encode(payload));
}

export async function computeIntegrityChain(
  entries: CreditEntry[]
): Promise<CreditEntry[]> {
  let previousHash = "";
  const result: CreditEntry[] = [];

  for (const entry of entries) {
    const hash = await computeIntegrityHash(entry, previousHash);
    result.push({ ...entry, integrityHash: hash });
    previousHash = hash;
  }

  return result;
}

export interface IntegrityVerificationResult {
  valid: boolean;
  totalEntries: number;
  verifiedEntries: number;
  firstCorruptedIndex: number | null;
  legacyEntries: number;
}

export async function verifyIntegrityChain(
  entries: CreditEntry[]
): Promise<IntegrityVerificationResult> {
  let previousHash = "";
  let verifiedEntries = 0;
  let legacyEntries = 0;
  let firstCorruptedIndex: number | null = null;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (!entry.integrityHash) {
      legacyEntries++;
      previousHash = "";
      continue;
    }

    const expectedHash = await computeIntegrityHash(entry, previousHash);

    if (entry.integrityHash !== expectedHash) {
      if (firstCorruptedIndex === null) {
        firstCorruptedIndex = i;
      }

      return {
        valid: false,
        totalEntries: entries.length,
        verifiedEntries,
        firstCorruptedIndex,
        legacyEntries
      };
    }

    verifiedEntries++;
    previousHash = entry.integrityHash;
  }

  return {
    valid: true,
    totalEntries: entries.length,
    verifiedEntries,
    firstCorruptedIndex: null,
    legacyEntries
  };
}

// ---------------------------------------------------------------------------
// Chunk-backed audit (Capa 2)
// ---------------------------------------------------------------------------

export type EntryVerificationStatus = "verified" | "unverifiable" | "suspicious";

export interface AuditedEntry {
  entry: CreditEntry;
  status: EntryVerificationStatus;
  reason: string;
}

export interface CreditAuditResult {
  integrity: IntegrityVerificationResult;
  totalEntries: number;
  verifiedEntries: number;
  unverifiableEntries: number;
  suspiciousEntries: number;
  receiptVerifiedEntries: number;
  auditedEntries: AuditedEntry[];
  trustScore: number;
}

export interface AuditOptions {
  verifySignature?: ReceiptSignatureVerifier;
}

function isRealReceiptSignature(sig: string): boolean {
  return sig.length === 128 && /^[0-9a-f]{128}$/.test(sig);
}

function buildReceiptEventForVerification(
  entry: CreditEntry
): ReceiptEventLike | null {
  if (!isRealReceiptSignature(entry.receiptSignature)) {
    return null;
  }

  return {
    id: "",
    pubkey: entry.peerPubkey,
    created_at: entry.timestamp,
    kind: ENTROPY_UPSTREAM_RECEIPT_KIND,
    content: "",
    tags: [
      ["p", entry.peerPubkey],
      ["x", entry.chunkHash],
      ["bytes", String(entry.bytes)],
      ["receipt", String(entry.timestamp)]
    ],
    sig: entry.receiptSignature
  };
}

export async function auditCredits(
  entries: CreditEntry[],
  chunkStore: ChunkStore,
  options: AuditOptions = {}
): Promise<CreditAuditResult> {
  const integrity = await verifyIntegrityChain(entries);

  const auditedEntries: AuditedEntry[] = [];
  let verifiedCount = 0;
  let unverifiableCount = 0;
  let suspiciousCount = 0;
  let receiptVerifiedCount = 0;

  for (const entry of entries) {
    if (entry.direction === "down") {
      auditedEntries.push({
        entry,
        status: "verified",
        reason: "Download entries are self-reported consumption."
      });
      verifiedCount++;
      continue;
    }

    const chunk = await chunkStore.getChunk(entry.chunkHash);

    if (!chunk) {
      if (entry.rootHash) {
        const rootChunks = await chunkStore.listChunksByRoot(entry.rootHash);

        if (rootChunks.length > 0) {
          auditedEntries.push({
            entry,
            status: "unverifiable",
            reason: "Chunk evicted but rootHash has other chunks stored."
          });
          unverifiableCount++;
          continue;
        }
      }

      auditedEntries.push({
        entry,
        status: "suspicious",
        reason: "No chunk found and no related rootHash chunks exist."
      });
      suspiciousCount++;
      continue;
    }

    const chunkBytes = chunk.data.byteLength;
    const declaredBytes = entry.bytes;
    const tolerance = 0.05;

    if (declaredBytes > chunkBytes * (1 + tolerance)) {
      auditedEntries.push({
        entry,
        status: "suspicious",
        reason: `Declared ${declaredBytes} bytes but chunk is ${chunkBytes} bytes.`
      });
      suspiciousCount++;
      continue;
    }

    if (entry.rootHash && chunk.rootHash !== entry.rootHash) {
      auditedEntries.push({
        entry,
        status: "suspicious",
        reason: `Entry rootHash ${entry.rootHash} does not match chunk rootHash ${chunk.rootHash}.`
      });
      suspiciousCount++;
      continue;
    }

    // Receipt signature verification (Capa 3)
    let receiptValid = false;
    if (options.verifySignature) {
      const receiptEvent = buildReceiptEventForVerification(entry);
      if (receiptEvent) {
        try {
          receiptValid = options.verifySignature(receiptEvent);
          if (receiptValid) {
            receiptVerifiedCount++;
          }
        } catch {
          receiptValid = false;
        }
      }
    }

    const reason = receiptValid
      ? "Chunk exists, size matches, and receipt signature verified."
      : "Chunk exists and size matches declared bytes.";

    auditedEntries.push({
      entry,
      status: "verified",
      reason
    });
    verifiedCount++;
  }

  const totalEntries = entries.length;
  const trustScore = totalEntries > 0
    ? Math.round(((verifiedCount + unverifiableCount * 0.5) / totalEntries) * 100)
    : 100;

  return {
    integrity,
    totalEntries,
    verifiedEntries: verifiedCount,
    unverifiableEntries: unverifiableCount,
    suspiciousEntries: suspiciousCount,
    receiptVerifiedEntries: receiptVerifiedCount,
    auditedEntries,
    trustScore
  };
}
