# Credit Integrity — Plan de viabilidad

## Estado actual

### Cómo funcionan los créditos hoy

```
Transferencia P2P → service-worker.ts → credit-ledger.ts → chrome.storage.local
                                         (CreditEntry[])
```

Cada `CreditEntry` tiene:
- `id` — UUID generado localmente
- `peerPubkey` — pubkey del peer con quien se intercambió
- `direction` — "up" | "down"
- `bytes` — cantidad de bytes transferidos
- `chunkHash` — hash del chunk transferido
- `receiptSignature` — string libre, actualmente `"rtc-upload:{chunkHash}:{timestamp}"` o `"p2p-fetch"`
- `timestamp` — epoch seconds

### Vectores de ataque

| Ataque | Dificultad | Impacto |
|---|---|---|
| Editar `creditLedgerEntries` en chrome.storage.local | Trivial | Balance infinito, cold storage gratis |
| Inventar entries con peerPubkeys falsos | Trivial | Créditos fabricados sin transferencia real |
| Inflar `bytes` en entries existentes | Trivial | Multiplicar balance |
| Borrar entries de tipo "down" | Trivial | Eliminar descargas, ratio inflado |

### Infraestructura existente que podemos aprovechar

1. **`proof-of-upstream.ts`** — Ya existe un sistema de receipts firmados (kind 7772) con `buildReceiptDraft()`, `parseReceipt()`, `isValidReceipt()`. Actualmente NO se usa para validar entries del ledger.

2. **`verify-receipt.ts`** — `wireReceiptVerifier()` ya está conectado al service worker con `verifyEventSignature` de nostr-tools.

3. **`chunk-transfer.ts`** — Custody Challenge/Proof ya existe en el protocolo binario (tipos 0x05 y 0x06). Permite verificar que un peer realmente posee un chunk.

4. **`peer-reputation.ts`** — Sistema de reputación con ban automático por verificaciones fallidas.

5. **IndexedDB ChunkStore** — Inventario local de chunks que se puede cruzar con los entries del ledger.

---

## Diseño propuesto: Credit Integrity en 3 capas

### Capa 1 — Tamper Detection (hash chain local)

**Objetivo:** Detectar si alguien editó `chrome.storage.local` manualmente.

**Mecanismo:** Convertir el ledger en una **hash chain** (blockchain simplificada):

```
Entry[0].integrityHash = SHA-256(entry[0] fields)
Entry[1].integrityHash = SHA-256(entry[0].integrityHash + entry[1] fields)
Entry[N].integrityHash = SHA-256(entry[N-1].integrityHash + entry[N] fields)
```

Al leer el ledger, recalcular la cadena. Si algún hash no coincide → **ledger corrupto**.

**Campos nuevos en CreditEntry:**
```typescript
interface CreditEntry {
  // ... campos existentes ...
  integrityHash: string;      // SHA-256 chain link
  signedByNode: string;       // firma del nodo (con su privkey) sobre integrityHash
}
```

**Qué detecta:**
- ✅ Inserción de entries falsos
- ✅ Modificación de bytes/direction/timestamps
- ✅ Eliminación de entries (la cadena se rompe)
- ❌ No previene que el usuario recree toda la cadena desde cero con datos inventados

**Complejidad:** Baja — solo cambios en `credit-ledger.ts` y `ledger.ts`.

**Limitación honesta:** Un usuario técnico puede recalcular toda la cadena. Pero sube la barrera de "abrir DevTools y cambiar un número" a "escribir un script que entienda el formato".

### Capa 2 — Chunk-Backed Verification (cross-reference con inventario)

**Objetivo:** Verificar que cada credit entry corresponde a un chunk que realmente existe/existió.

**Mecanismo:** Al auditar el ledger, cruzar cada entry con el chunk store:

```
Para cada CreditEntry con direction="up":
  1. ¿Existe chunk con hash === entry.chunkHash en IndexedDB?
  2. ¿El tamaño del chunk ≈ entry.bytes? (tolerancia por overhead de protocolo)
  3. ¿El chunk pertenece a un rootHash que fue delegado al nodo?

Scoring:
  - Entry verificable (chunk existe + tamaño coincide) → confianza alta
  - Entry con chunk eliminado pero rootHash delegado → confianza media
  - Entry sin chunk ni delegación → confianza baja (sospechoso)
```

**Campos nuevos:**
```typescript
interface CreditEntry {
  // ... campos existentes ...
  rootHash?: string;           // rootHash del chunk (para cross-reference)
  verificationStatus?: "verified" | "unverifiable" | "suspicious";
}
```

**Qué detecta:**
- ✅ Entries inventados para chunks que nunca existieron
- ✅ Bytes inflados (chunk real es más pequeño que lo declarado)
- ✅ Entries con peerPubkeys que nunca interactuaron (cruzando con peer-reputation)

**Complejidad:** Media — requiere auditor que lea ChunkStore + seeder delegations.

### Capa 3 — Peer-Signed Receipts (prueba criptográfica bilateral)

**Objetivo:** Que cada crédito esté respaldado por una firma del peer que participó en la transferencia.

**Mecanismo:** Usar el sistema de receipts que ya existe en `proof-of-upstream.ts`:

```
Flujo de transferencia P2P actual:
  Peer A solicita chunk → Peer B envía chunk → se registra crédito local

Flujo propuesto:
  Peer A solicita chunk → Peer B envía chunk
  → Peer B firma UpstreamReceipt (kind 7772) con su privkey
  → Peer A recibe el receipt firmado
  → Peer A almacena la firma como parte del CreditEntry
  → Al auditar: verificar firma con pubkey del peer
```

**Cambios en el protocolo de transferencia:**
```typescript
// Nuevo mensaje después de CHUNK_DATA:
type TransferReceiptMessage = {
  type: "TRANSFER_RECEIPT";
  chunkHash: string;
  receiptEvent: SignedNostrEvent; // kind 7772, firmado por el sender
};
```

**Campo actualizado en CreditEntry:**
```typescript
interface CreditEntry {
  // ... campos existentes ...
  receiptSignature: string;    // ahora: firma real del peer (sig del event 7772)
  receiptEventId: string;      // id del evento Nostr del receipt
  receiptPubkey: string;       // pubkey del firmante (peer)
}
```

**Validación:**
```typescript
function isLegitimateCredit(entry: CreditEntry): boolean {
  // 1. Reconstruir el evento receipt
  const receiptEvent = rebuildReceiptEvent(entry);
  // 2. Verificar firma con nostr-tools
  return verifyEventSignature(receiptEvent);
  // 3. Verificar que receiptPubkey === entry.peerPubkey
}
```

**Qué detecta:**
- ✅ Todo lo anterior
- ✅ Créditos inventados sin participación real de un peer (imposible falsificar la firma del peer)
- ✅ Manipulación de bytes (el receipt firmado tiene los bytes originales)

**Complejidad:** Alta — requiere cambios en el protocolo P2P de chunk-transfer, p2p-bridge, y el flujo de ambos lados de la conexión.

---

## Plan de implementación por fases

### Fase A — Hash Chain + Audit (Capa 1 + 2) ✅ IMPLEMENTADA

1. ✅ Agregados `integrityHash` y `rootHash` a `CreditEntry` en `ledger.ts`
2. ✅ `credit-ledger.ts` calcula hash chain automáticamente al escribir (`stampIntegrityHash`)
3. ✅ `verifyLedgerIntegrity()` recalcula la cadena al leer
4. ✅ `rootHash` disponible en `CreditEntry` y pasado desde transferencias P2P
5. ✅ `auditCredits()` cruza entries con ChunkStore (size, rootHash, existencia)
6. ✅ 35 tests para integridad de cadena + auditoría de chunks
7. Pendiente: Exponer resultado de auditoría en dashboard/web UI

### Fase B — Peer-Signed Receipts (Capa 3) ✅ IMPLEMENTADA

1. ✅ `TRANSFER_RECEIPT` (0x07) message type en `chunk-transfer.ts` con encode/decode
2. ✅ `chunk-server.ts` firma receipt (kind 7772) con `buildReceiptDraft()` después de servir chunk
3. ✅ `peer-fetch.ts` recibe receipt, verifica, incluye sig en `PeerChunkResult`
4. ✅ `service-worker.ts` pasa `receiptSignature` real al registrar créditos
5. ✅ `auditCredits()` verifica firmas de receipts via `AuditOptions.verifySignature`
6. ✅ Entries legacy sin receipt → `receiptVerifiedEntries = 0`, `isRealReceiptSignature()` los filtra
7. ✅ 6 tests nuevos para encode/decode de receipts + 5 tests para verificación de firmas

### Fase C — Consecuencias (enforcement) — Pendiente

1. Si ledger integrity falla → resetear créditos a 0
2. Si % de entries verificados es bajo → reducir cold storage eligibility
3. Exponer "credit score" (trustScore) basado en auditoría en dashboard y web settings
4. Peers pueden pedir tu credit score antes de servirte chunks

---

## Estado actual

- **190/190 tests** pasan en @entropy/core
- **Typecheck** pasa en los 3 packages (core, extension, web)
- Entries legacy (sin `integrityHash` ni receipt real) son backward-compatible
- El flujo P2P ahora firma y envía receipts automáticamente
- El fetcher espera hasta 500ms por el receipt antes de resolver sin él
