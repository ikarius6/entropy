# Credit Integrity

### How credits work today

```
P2P Transfer → service-worker.ts → credit-ledger.ts → chrome.storage.local
                                         (CreditEntry[])
```

Each `CreditEntry` has:
- `id` — Locally generated UUID
- `peerPubkey` — pubkey of the peer it was exchanged with
- `direction` — "up" | "down"
- `bytes` — amount of bytes transferred
- `chunkHash` — hash of the transferred chunk
- `receiptSignature` — free string, currently `"rtc-upload:{chunkHash}:{timestamp}"` or `"p2p-fetch"`
- `timestamp` — epoch seconds

### Attack Vectors

| Attack | Difficulty | Impact |
|---|---|---|
| Edit `creditLedgerEntries` in chrome.storage.local | Trivial | Infinite balance, free cold storage |
| Invent entries with fake peerPubkeys | Trivial | Fabricated credits without real transfer |
| Inflate `bytes` in existing entries | Trivial | Multiply balance |
| Delete "down" type entries | Trivial | Eliminate downloads, inflated ratio |

### Existing Infrastructure we can leverage

1. **`proof-of-upstream.ts`** — Signed receipts system (kind 7772) already exists with `buildReceiptDraft()`, `parseReceipt()`, `isValidReceipt()`. Currently NOT used to validate ledger entries.

2. **`verify-receipt.ts`** — `wireReceiptVerifier()` is already connected to the service worker with nostr-tools' `verifyEventSignature`.

3. **`chunk-transfer.ts`** — Custody Challenge/Proof already exists in the binary protocol (types 0x05 and 0x06). Allows verifying that a peer actually possesses a chunk.

4. **`peer-reputation.ts`** — Reputation system with automatic ban for failed verifications.

5. **IndexedDB ChunkStore** — Local repository of chunks that can be cross-referenced with ledger entries.

---

## Proposed Design: Credit Integrity in 3 Layers

### Layer 1 — Tamper Detection (local hash chain)

**Goal:** Detect if someone manually edited `chrome.storage.local`.

**Mechanism:** Convert the ledger into a **hash chain** (simplified blockchain):

```
Entry[0].integrityHash = SHA-256(entry[0] fields)
Entry[1].integrityHash = SHA-256(entry[0].integrityHash + entry[1] fields)
Entry[N].integrityHash = SHA-256(entry[N-1].integrityHash + entry[N] fields)
```

When reading the ledger, recalculate the chain. If any hash doesn't match → **corrupt ledger**.

**New fields in CreditEntry:**
```typescript
interface CreditEntry {
  // ... existing fields ...
  integrityHash: string;      // SHA-256 chain link
  signedByNode: string;       // node signature (with its privkey) over integrityHash
}
```

**What it detects:**
- ✅ Insertion of fake entries
- ✅ Modification of bytes/direction/timestamps
- ✅ Deletion of entries (the chain breaks)
- ❌ Does not prevent the user from recreating the entire chain from scratch with fabricated data

**Honest limitation:** A technical user can recalculate the entire chain. But it raises the bar from "opening DevTools and changing a number" to "writing a script that understands the format".

### Layer 2 — Chunk-Backed Verification (cross-reference with inventory)

**Goal:** Verify that each credit entry corresponds to a chunk that actually exists/existed.

**Mechanism:** When auditing the ledger, cross-reference each entry with the chunk store:

```
For each CreditEntry with direction="up":
  1. Does a chunk with hash === entry.chunkHash exist in IndexedDB?
  2. Is the chunk size ≈ entry.bytes? (tolerance for protocol overhead)
  3. Does the chunk belong to a rootHash that was delegated to the node?

Scoring:
  - Verifiable entry (chunk exists + size matches) → high confidence
  - Entry with deleted chunk but delegated rootHash → medium confidence
  - Entry without chunk or delegation → low confidence (suspicious)
```

**New fields:**
```typescript
interface CreditEntry {
  // ... existing fields ...
  rootHash?: string;           // rootHash of the chunk (for cross-reference)
  verificationStatus?: "verified" | "unverifiable" | "suspicious";
}
```

**What it detects:**
- ✅ Fabricated entries for chunks that never existed
- ✅ Inflated bytes (real chunk is smaller than declared)
- ✅ Entries with peerPubkeys that never interacted (crossing with peer-reputation)

### Layer 3 — Peer-Signed Receipts (bilateral cryptographic proof)

**Goal:** Ensure each credit is backed by a signature from the peer that participated in the transfer.

**Mechanism:** Use the receipts system that already exists in `proof-of-upstream.ts`:

```
Current P2P transfer flow:
  Peer A requests chunk → Peer B sends chunk → local credit is registered

Proposed flow:
  Peer A requests chunk → Peer B sends chunk
  → Peer B signs UpstreamReceipt (kind 7772) with its privkey
  → Peer A receives the signed receipt
  → Peer A stores the signature as part of the CreditEntry
  → When auditing: verify signature with peer's pubkey
```

**Changes in transfer protocol:**
```typescript
// New message after CHUNK_DATA:
type TransferReceiptMessage = {
  type: "TRANSFER_RECEIPT";
  chunkHash: string;
  receiptEvent: SignedNostrEvent; // kind 7772, signed by the sender
};
```

**Updated field in CreditEntry:**
```typescript
interface CreditEntry {
  // ... existing fields ...
  receiptSignature: string;    // now: real signature from the peer (sig of event 7772)
  receiptEventId: string;      // Id of the Nostr event of the receipt
  receiptPubkey: string;       // pubkey of the signer (peer)
}
```

**Validation:**
```typescript
function isLegitimateCredit(entry: CreditEntry): boolean {
  // 1. Rebuild the receipt event
  const receiptEvent = rebuildReceiptEvent(entry);
  // 2. Verify signature with nostr-tools
  return verifyEventSignature(receiptEvent);
  // 3. Verify that receiptPubkey === entry.peerPubkey
}
```

**What it detects:**
- ✅ Everything above
- ✅ Fabricated credits without real peer participation (impossible to forge peer's signature)
- ✅ Byte manipulation (the signed receipt has the original bytes)

---

## Phased Implementation Plan

### Phase A — Hash Chain + Audit (Layer 1 + 2) ✅ IMPLEMENTED

1. ✅ Added `integrityHash` and `rootHash` to `CreditEntry` in `ledger.ts`
2. ✅ `credit-ledger.ts` automatically calculates hash chain on write (`stampIntegrityHash`)
3. ✅ `verifyLedgerIntegrity()` recalculates the chain on read
4. ✅ `rootHash` available in `CreditEntry` and passed from P2P transfers
5. ✅ `auditCredits()` cross-references entries with ChunkStore (size, rootHash, existence)
6. ✅ 35 tests for chain integrity + chunk auditing
7. Pending: Expose audit result in dashboard/web UI

### Phase B — Peer-Signed Receipts (Layer 3) ✅ IMPLEMENTED

1. ✅ `TRANSFER_RECEIPT` (0x07) message type in `chunk-transfer.ts` with encode/decode
2. ✅ `chunk-server.ts` signs receipt (kind 7772) with `buildReceiptDraft()` after serving chunk
3. ✅ `peer-fetch.ts` receives receipt, verifies, includes sig in `PeerChunkResult`
4. ✅ `service-worker.ts` passes real `receiptSignature` when registering credits
5. ✅ `auditCredits()` verifies receipt signatures via `AuditOptions.verifySignature`
6. ✅ Legacy entries without receipt → `receiptVerifiedEntries = 0`, `isRealReceiptSignature()` filters them out
7. ✅ 6 new tests for receipts encode/decode + 5 tests for signature verification

### Phase C — Consequences (enforcement) ✅ IMPLEMENTED

1. ✅ If ledger integrity fails → `enforceIntegrity()` automatically resets credits to 0
2. ✅ If integrity corrupted → `coldStorageEligible` is forced to `false`
3. ✅ `CreditSummaryPayload` includes `integrityValid`, `trustScore`, `receiptVerifiedEntries`
4. ✅ Extension dashboard shows "Credit Integrity" section with valid/corrupted badge + trust score
5. ✅ Extension popup shows integrity + trust in text
6. ✅ Web app CreditPanel shows integrity, trust score, receipt-verified uploads
7. ✅ `isCreditSummaryPayload` type guard validated for new fields

---

## Current State

- Legacy entries (without `integrityHash` or real receipt) are backward-compatible
- P2P flow now automatically signs and sends receipts
- The fetcher waits up to 500ms for the receipt before resolving without it
- If the user manipulates `creditLedgerEntries` in storage → ledger resets to 0
- `coldStorageEligible` is blocked if the chain is corrupted
- Trust score and receipt-verified visible in popup, dashboard and web app
