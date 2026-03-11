# Entropy - Phase 2 Next Steps

## 1) Current implementation status

Phase 2 foundation is already in place:

- `packages/core/src/credits/`
  - `proof-of-upstream.ts`
  - `ledger.ts`
  - `cold-storage.ts`
- `packages/core/src/storage/`
  - `chunk-store.ts`
  - `db.ts`
  - `quota-manager.ts`
- Bridge protocol extended in `packages/core/src/types/extension-bridge.ts`
  - `GET_CREDIT_SUMMARY`
  - `CREDIT_UPDATE`
- Extension integration
  - `apps/extension/src/background/credit-ledger.ts`
  - `apps/extension/src/background/service-worker.ts`
- Web integration
  - `apps/web/src/hooks/useCredits.ts`
  - `apps/web/src/components/CreditPanel.tsx`

---

## 2) Baseline checks (currently green)

```bash
pnpm typecheck
pnpm test
pnpm build
```

---

## 3) Recommended next implementation block (Phase 2)

### A) Signature verification wiring

- Keep `proof-of-upstream.ts` verifier-agnostic.
- In app bootstrap (web/extension), wire real signature verification with:
  - `configureReceiptSignatureVerifier(...)`
- Use `nostr-tools` there as the concrete verification provider.

### B) Active credit gating in extension

- Before serving chunks, enforce credit policy via ledger summary / `canDownload` semantics.
- Return explicit error when user does not have sufficient credit.
- Keep `requestId`-correlated bridge errors for UI handling.

### C) Download accounting

- Add `recordDownloadCredit(...)` on real download path.
- Ensure each successful transfer creates a complete accounting chain:
  1. receipt generated/parsed
  2. receipt validated
  3. ledger recorded (`up` or `down`)
  4. `CREDIT_UPDATE` emitted

### D) Storage lifecycle integration

- Connect `chunk-store` + `quota-manager` into extension seeder flow.
- Enforce quota checks before persisting chunks.
- Trigger LRU eviction (`evictLRU`) when quota pressure is detected.

### E) Test hardening

- Add tests for:
  - malformed `CREDIT_UPDATE` payload handling
  - stale / invalid receipt rejection
  - end-to-end credit update propagation (extension -> web)
  - gating behavior when balance is insufficient

---

## 4) Manual verification checklist for next session

1. Delegate seeding from web and verify upload credit increments.
2. Simulate/download a chunk and verify download debit is recorded.
3. Validate insufficient credit path blocks serving/download as designed.
4. Confirm `CreditPanel` updates live via `CREDIT_UPDATE` without manual refresh.
5. Reload extension and verify credit ledger persistence.

---

## 5) Quick resume commands

```bash
pnpm typecheck
pnpm --filter @entropy/core test
pnpm --filter @entropy/extension build
pnpm --filter @entropy/web dev
```
