# Fase 5 — Resiliencia y Escala

> **Objetivo:** Convertir Entropy de un prototipo funcional a una red P2P robusta que tolere peers maliciosos, desconexiones, codecs variados y escala creciente. Incluye reputación de peers, cold storage real, descubrimiento dinámico de seeders, compatibilidad multimedia ampliada, métricas operacionales y hardening de seguridad.

---

## Contexto

### Lo que YA existe (Phases 1–4)

| Capa | Módulos | Estado |
|---|---|---|
| **Core — Chunking** | `chunker.ts`, `assembler.ts`, `merkle.ts`, `hash.ts` | ✅ |
| **Core — Nostr** | `Relay`, `RelayPool`, `events.ts`, `nip-entropy.ts` (kind:7001), `signaling.ts`, `identity.ts` | ✅ |
| **Core — Transporte** | `peer-manager.ts`, `signaling-channel.ts`, `chunk-transfer.ts` (fragmentación 64KB + reassembly), `nat-traversal.ts`, `chunk-downloader.ts` (multi-peer paralelo) | ✅ |
| **Core — Créditos** | `proof-of-upstream.ts` (kind:7772), `ledger.ts`, `cold-storage.ts` (eligibilidad + asignación), `verify-receipt.ts`, `credit-gating` | ✅ |
| **Core — Storage** | `chunk-store.ts`, `indexeddb-chunk-store.ts`, `quota-manager.ts`, `quota-manager-idb.ts`, `quota-aware-store.ts`, `db.ts` (`PeerRecord` schema definido) | ✅ |
| **Core — Bridge** | `extension-bridge.ts` (12+ message types) | ✅ |
| **Extension** | SW completo: relay-manager, signaling-listener, chunk-server, chunk-ingest, identity-store, credit-ledger, scheduler, p2p-bridge, peer-fetch | ✅ |
| **Extension — P2P Debug** | Fragmentación 64KB, dedup GET_CHUNK, filtrado de señalización stale por ufrag/timestamp | ✅ |
| **Web** | Feed (kind:1 + kind:7001), perfiles (kind:0), upload pipeline, MSE player, descarga paralela, settings, quota manager, Tailwind v4, responsive | ✅ |

### Lo que FALTA (Phase 5 — architecture.md)

```
- [x] Reputación de peers: tracking de transfers exitosos/fallidos, banning automático por hash inválido
- [x] Exceso de Seeding automático para usuarios con ratio alto (cold storage real)
- [x] Prueba de Custodia periódica y Créditos Premium activos (self-verification)
- [x] Seeder Announcements: descubrimiento de peers sin gatekeepers explícitos
- [ ] Transmuxing client-side (mp4box.js/mux.js) para compatibilidad de codecs MSE
- [ ] Chunk alignment con keyframes en upload (pre-procesamiento)
- [x] Métricas de red y health checks (dashboard de extensión + web)
- [ ] Reconexión automática de WebRTC y tolerancia a desconexiones
- [ ] Soporte Tor opcional en la extensión
- [x] Auditoría de seguridad (rate limiting, message size validation, inactive DC timeout, CSP, SHA-256 en peer-fetch)
- [x] Credit gating: bloqueo de contenido multimedia sin créditos suficientes
- [x] Fix: recordDownloadCredit faltante en GET_CHUNK P2P fallback (ratio ∞ bug)
- [x] Fix: contenido propio no cobra créditos (owner bypass)
- [x] Fix: contenido cacheado localmente no cobra créditos (CHECK_LOCAL_CHUNKS bridge)
```

### Módulos existentes que se extienden

- `db.ts` → `PeerRecord` schema ya definido — ✅ **tracking implementado en `peer-reputation-idb.ts`**.
- `cold-storage.ts` → lógica pura — ✅ **integrada en `cold-storage-manager.ts` con ciclos reales**.
- `chunk-server.ts` → ✅ **registra reputación del requester + rate limiting + message size validation + inactivity timeout**.
- `chunk-downloader.ts` → ✅ **verifica hash SHA-256 + registra reputación + salta peers baneados**.
- `scheduler.ts` → ✅ **ejecuta cold storage cycles, prune, integrity check y health checks de métricas**.

---

## Bloque 1: Reputación de Peers y Banning Automático

### 1.1 `@entropy/core` — `credits/peer-reputation.ts` (nuevo)

Servicio de reputación sobre la interfaz `PeerRecord` ya definida en `db.ts`.

```typescript
export interface PeerReputationStore {
  getOrCreate(pubkey: string): Promise<PeerRecord>;
  recordSuccess(pubkey: string, bytes: number): Promise<void>;
  recordFailure(pubkey: string): Promise<void>;
  isBanned(pubkey: string): Promise<boolean>;
  ban(pubkey: string): Promise<void>;
  unban(pubkey: string): Promise<void>;
  getAll(): Promise<PeerRecord[]>;
  prune(maxAgeDays: number): Promise<number>;
}

// Banning policy
const FAILED_VERIFICATION_BAN_THRESHOLD = 3;
const AUTO_BAN_CHECK_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
```

**Reglas de banning automático:**

1. Si `failedVerifications >= 3` dentro de 24h → auto-ban.
2. Peers baneados no reciben chunks (chunk-server rechaza) ni se les pide chunks (chunk-downloader los salta).
3. Unban manual desde dashboard de extensión o después de 7 días automáticamente.

### 1.2 `@entropy/core` — `storage/peer-reputation-idb.ts` (nuevo)

Implementación de `PeerReputationStore` sobre IndexedDB (Dexie.js), persistida en la extensión.

```typescript
export function createPeerReputationStore(db: Dexie): PeerReputationStore;
```

Tabla Dexie:

```
peers: "pubkey, lastSeen, banned"
```

### 1.3 Integración en `chunk-server.ts`

Después de servir un chunk exitosamente:

```typescript
await reputationStore.recordSuccess(requesterPubkey, chunk.data.byteLength);
```

### 1.4 Integración en `chunk-downloader.ts`

Después de recibir un chunk:

```typescript
const hash = await sha256Hex(new Uint8Array(data));
if (hash === expectedHash) {
  await reputationStore.recordSuccess(peerPubkey, data.byteLength);
  // store chunk...
} else {
  await reputationStore.recordFailure(peerPubkey);
  // re-queue chunk, skip this peer
}
```

Antes de conectar a un peer:

```typescript
if (await reputationStore.isBanned(peerPubkey)) {
  logger.warn(`[ChunkDownloader] skipping banned peer ${peerPubkey.slice(0,8)}…`);
  continue;
}
```

### 1.5 Integración en `peer-fetch.ts` (extensión)

Misma lógica que chunk-downloader: verificar hash del chunk recibido, registrar success/failure, saltar peers baneados.

### 1.6 UI: Dashboard de extensión — Sección "Peers"

Tabla de peers conocidos con columnas: pubkey (truncada), transfers exitosos, fallos, bytes intercambiados, último contacto, estado (activo/baneado). Botón para ban/unban manual.

### 1.7 Tests

- `peer-reputation.test.ts`: recording success/failure, auto-ban threshold, prune, unban.
- Actualizar `chunk-server.test.ts`: verificar que peers baneados reciben error.
- Actualizar `chunk-downloader.test.ts`: verificar que peers baneados se omiten.

---

## Bloque 2: Cold Storage Real + Exceso de Seeding

### 2.1 Protocolo de asignación de cold chunks

**Concepto:** Cuando un peer tiene ratio ≥ 2.0, el sistema le asigna automáticamente chunks "fríos" (contenido poco popular con poca replicación) para que los mantenga en su IndexedDB. Esto garantiza redundancia en la red.

**Flujo:**

```
1. Scheduler periódico (cada 30min) revisa elegibilidad:
   isEligibleForColdStorage(summary) → true

2. Consultar relays por eventos kind:7001 con pocos gatekeepers
   → Identificar chunks con baja replicación

3. assignColdChunks(available, { maxAssignments: 16 })
   → Lista de ColdChunkAssignment

4. Para cada asignación:
   a. Conectar al gatekeeper vía WebRTC
   b. Solicitar chunk vía CHUNK_REQUEST
   c. Verificar hash + almacenar en IndexedDB
   d. Publicar "seeder announcement" (ver Bloque 3)

5. Registrar asignación en chrome.storage.local
   → Incluir expiresAt, premiumCredits
```

### 2.2 `@entropy/extension` — `background/cold-storage-manager.ts` (nuevo)

```typescript
export interface ColdStorageManager {
  /** Run one cycle: check eligibility, discover cold chunks, fetch and store. */
  runCycle(): Promise<void>;

  /** Get current active cold assignments. */
  getAssignments(): ColdChunkAssignment[];

  /** Manually release a cold chunk assignment. */
  release(chunkHash: string): Promise<void>;
}

export function createColdStorageManager(deps: {
  chunkStore: ChunkStore;
  creditLedger: CreditLedger;
  relayPool: RelayPool;
  signalingChannel: SignalingChannel;
  identityStore: IdentityStore;
  reputationStore: PeerReputationStore;
}): ColdStorageManager;
```

### 2.3 Integración en `scheduler.ts`

```typescript
export function scheduleMaintenance(coldStorageManager: ColdStorageManager): void {
  // Existing: prune delegations every 5min
  setInterval(() => void pruneDelegations(MAX_DELEGATION_AGE_MS), PRUNE_INTERVAL_MS);

  // New: cold storage cycle every 30min
  setInterval(() => void coldStorageManager.runCycle(), COLD_STORAGE_CYCLE_MS);

  // New: prune expired cold assignments every 1h
  setInterval(() => void coldStorageManager.pruneExpired(), COLD_PRUNE_INTERVAL_MS);
}
```

### 2.4 UI: Dashboard — Sección "Cold Storage"

- Lista de cold chunk assignments activas: chunkHash, rootHash, premium credits earned, expires in.
- Indicador de elegibilidad (ratio actual vs mínimo).
- Botón "Release" por asignación individual.
- Total premium credits acumulados.

### 2.5 Tests

- `cold-storage-manager.test.ts`: mock de dependencias, verificar ciclo de asignación, fetch, storage, prune.
- Integración: verificar que scheduler ejecuta cold storage cycles.

---

## Bloque 3: Seeder Announcements (Descubrimiento Dinámico)

### 3.1 Problema

Actualmente, el `ChunkDownloader` solo conoce seeders a través del campo `gatekeepers` del evento kind:7001. Si el uploader original se desconecta y no hay gatekeepers online, el contenido es inaccesible aunque otros peers tengan los chunks (por cold storage o re-seeding).

### 3.2 Solución: `kind:20002` — Seeder Announcement (efímero)

```json
{
  "kind": 20002,
  "pubkey": "<seeder_pubkey>",
  "content": "",
  "tags": [
    ["x", "<root_hash>"],
    ["chunks", "<count_of_chunks_available>"]
  ]
}
```

- **Efímero** (kind 20000-29999): no se persiste en relays permanentemente.
- Un seeder publica este evento cuando acepta la custodia de un contenido (vía `DELEGATE_SEEDING` o cold storage).
- Se re-publica periódicamente (cada 15 min) mientras el seeder está activo.

### 3.3 `@entropy/core` — `nostr/seeder-announcement.ts` (nuevo)

```typescript
export const SEEDER_ANNOUNCEMENT_KIND = 20002;

export function buildSeederAnnouncement(rootHash: string, chunkCount: number): NostrEventDraft;
export function parseSeederAnnouncement(event: NostrEvent): { rootHash: string; chunkCount: number; seederPubkey: string };
```

### 3.4 Integración en `signaling-listener.ts`

Al aceptar una delegación de seeding, publicar seeder announcement y programar re-publicación periódica.

### 3.5 Integración en `chunk-downloader.ts`

Antes de conectar a los gatekeepers estáticos del kind:7001, suscribirse a `kind:20002` con tag `["x", rootHash]` para descubrir seeders dinámicos. Combinar ambas listas.

```typescript
// 1. Static gatekeepers from chunk map
const staticPeers = chunkMap.gatekeepers ?? [chunkMap.authorPubkey];

// 2. Dynamic seeders from announcements
const dynamicPeers = await discoverSeeders(relayPool, rootHash, { timeout: 3000 });

// 3. Merge, deduplicate, filter banned
const allPeers = [...new Set([...staticPeers, ...dynamicPeers])]
  .filter(pk => pk !== myPubkey && !reputationStore.isBanned(pk));
```

### 3.6 Tests

- `seeder-announcement.test.ts`: build/parse round-trip.
- Actualizar `chunk-downloader.test.ts`: mock seeder discovery, verify dynamic peers used.

---

## Bloque 4: Prueba de Custodia Periódica + Créditos Premium Activos

### 4.1 Concepto

Para evitar que peers reclamen créditos premium sin realmente mantener los chunks, se implementa un **challenge-response periódico**:

1. Un peer verificador (cualquier peer interesado en el contenido) envía un `CUSTODY_CHALLENGE` por DataChannel.
2. El custodio debe responder con un `CUSTODY_PROOF` que demuestra posesión del chunk (hash de un rango aleatorio de bytes).
3. Si la prueba es válida, el custodio sigue acumulando premium credits.
4. Si falla o no responde en 30s, pierde la asignación.

### 4.2 Protocolo binario — Extensión de `chunk-transfer.ts`

```
CUSTODY_CHALLENGE (type=0x05)
┌──────┬──────────────┬──────────┬──────────┐
│ 0x05 │ chunk_hash   │ offset   │ length   │
│ 1B   │ 32B (SHA256) │ 4B (u32) │ 4B (u32) │
└──────┴──────────────┴──────────┴──────────┘

CUSTODY_PROOF (type=0x06)
┌──────┬──────────────┬──────────────────────┐
│ 0x06 │ chunk_hash   │ sha256(slice)        │
│ 1B   │ 32B (SHA256) │ 32B (SHA256)         │
└──────┴──────────────┴──────────────────────┘
```

### 4.3 `@entropy/core` — Extensiones a `chunk-transfer.ts`

```typescript
export const MESSAGE_TYPE_CUSTODY_CHALLENGE = 0x05;
export const MESSAGE_TYPE_CUSTODY_PROOF = 0x06;

export function encodeCustodyChallenge(chunkHash: string, offset: number, length: number): ArrayBuffer;
export function decodeCustodyChallenge(data: ArrayBuffer): { chunkHash: string; offset: number; length: number };

export function encodeCustodyProof(chunkHash: string, sliceHash: string): ArrayBuffer;
export function decodeCustodyProof(data: ArrayBuffer): { chunkHash: string; sliceHash: string };
```

### 4.4 Integración en `chunk-server.ts`

Manejar `CUSTODY_CHALLENGE` messages: leer el slice del chunk, computar SHA-256, responder con `CUSTODY_PROOF`.

### 4.5 Integración en `cold-storage-manager.ts`

Periódicamente (cada 2h), para cada asignación activa:

1. Verificar que el chunk aún existe en IndexedDB local.
2. Si no existe, marcar asignación como perdida (sin premium credits).
3. Opcionalmente, emitir challenge a sí mismo (self-verification) para detección temprana de corrupción.

### 4.6 Tests

- `chunk-transfer.test.ts`: encode/decode custody challenge + proof round-trip.
- `chunk-server.test.ts`: respond to custody challenge correctly.
- `cold-storage-manager.test.ts`: self-verification flow.

---

## Bloque 5: Transmuxing Client-Side + Keyframe Alignment

### 5.1 Problema

MSE (`MediaSource.isTypeSupported()`) solo funciona con codecs específicos por navegador. MP4/H.264/AAC es universalmente soportado, pero si el usuario sube WebM, MKV u otros formatos, el `SourceBuffer` fallará. Además, para que el streaming progresivo sea fluido, los chunks deben estar alineados con keyframes (IDR frames) del video.

### 5.2 Dependencias nuevas

| Paquete | Dependencia | Versión | Uso |
|---|---|---|---|
| `@entropy/core` | `mp4box` | `^0.5.x` | Parsing MP4 boxes, detección de keyframes, remuxing a fMP4 |
| `@entropy/web` | `mp4box` | (vía core) | Transmuxing on-the-fly durante playback |

### 5.3 `@entropy/core` — `chunking/keyframe-aligner.ts` (nuevo)

Pre-procesamiento en upload: detectar keyframes del video y ajustar los puntos de corte del chunker para que cada chunk empiece en un keyframe.

```typescript
export interface KeyframeAlignedChunkingOptions {
  file: Blob;
  targetChunkSize?: number;    // default: 5MB
  mimeType: string;
}

export interface AlignedChunkResult {
  chunks: ChunkRecord[];
  chunkHashes: string[];
  rootHash: string;
  keyframeOffsets: number[];   // byte offset of each keyframe
}

export async function chunkFileWithKeyframeAlignment(
  options: KeyframeAlignedChunkingOptions
): Promise<AlignedChunkResult>;
```

**Lógica:**

1. Parsear el archivo con `mp4box` para extraer posiciones de keyframes (sync samples).
2. En lugar de cortar cada 5MB exactos, ajustar el punto de corte al keyframe más cercano.
3. Tolerar variación de ±20% en el tamaño del chunk para mantener alineación.
4. Fallback: si no se puede parsear (formato no MP4), usar chunking estándar.

### 5.4 `@entropy/core` — `transport/transmuxer.ts` (nuevo)

Transmuxing on-the-fly durante playback para convertir chunks a fMP4 si el formato original no es soportado por MSE.

```typescript
export interface Transmuxer {
  /** Initialize with the codec info from the first chunk. */
  init(firstChunk: ArrayBuffer, mimeType: string): Promise<{
    initSegment: ArrayBuffer;
    outputMimeType: string;
  }>;

  /** Transmux a chunk into an fMP4 media segment. */
  transmux(chunk: ArrayBuffer, index: number): Promise<ArrayBuffer>;
}

export function createTransmuxer(): Transmuxer;
```

### 5.5 Integración en `useMediaSource.ts`

```typescript
// Before appending to SourceBuffer:
if (!MediaSource.isTypeSupported(mimeType)) {
  // Try transmuxing to fMP4
  const transmuxed = await transmuxer.transmux(chunkData, index);
  sourceBuffer.appendBuffer(transmuxed);
} else {
  sourceBuffer.appendBuffer(chunkData);
}
```

### 5.6 Integración en `useUploadPipeline.ts`

Para archivos de video, ofrecer opción de pre-procesamiento con keyframe alignment:

```typescript
if (isVideoMimeType(file.type)) {
  result = await chunkFileWithKeyframeAlignment({ file, mimeType: file.type });
} else {
  result = await chunkFile(file);
}
```

### 5.7 Tests

- `keyframe-aligner.test.ts`: mock mp4box, verificar que chunks se alinean a keyframes.
- `transmuxer.test.ts`: verificar transmuxing produce fMP4 válido.
- Actualizar `useUploadPipeline.test.ts`: verificar path de keyframe alignment.

---

## Bloque 6: Reconexión WebRTC + Tolerancia a Desconexiones

### 6.1 Problema

Actualmente, si un peer se desconecta durante una transferencia (ICE disconnected → failed), la conexión se pierde permanentemente. El chunk en vuelo se pierde y debe re-solicitarse a otro peer.

### 6.2 Estrategia de reconexión

```
ICE state: "disconnected"
       │
       ▼
  Start reconnection timer (5s)
       │
       ├── ICE recovers to "connected" within 5s → cancel timer, continue
       │
       └── Timer expires → ICE state "failed"
              │
              ▼
        ICE restart attempt:
          pc.restartIce()
          Create new offer with iceRestart: true
          Send via signaling channel
              │
              ├── New ICE connection established → resume pending requests
              │
              └── Timeout (15s) → mark peer as disconnected
                   → re-assign pending chunks to other peers
                   → close RTCPeerConnection
```

### 6.3 Integración en `chunk-downloader.ts`

```typescript
pc.oniceconnectionstatechange = () => {
  if (pc.iceConnectionState === "disconnected") {
    startReconnectionTimer(peerPubkey, pc);
  } else if (pc.iceConnectionState === "connected") {
    cancelReconnectionTimer(peerPubkey);
  } else if (pc.iceConnectionState === "failed") {
    attemptIceRestart(peerPubkey, pc);
  }
};
```

### 6.4 Integración en `peer-fetch.ts` (extensión)

Misma lógica para la conexión individual de peer-fetch. Si la reconexión falla, devolver null y dejar que el service worker intente otro gatekeeper.

### 6.5 Integración en `signaling-listener.ts` (extensión, seeder side)

Aceptar offers con `iceRestart: true` — regenerar answer sin crear una nueva RTCPeerConnection.

### 6.6 Tests

- `chunk-downloader.test.ts`: mock ICE state changes, verify reconnection flow.
- `peer-fetch.test.ts`: verify ICE restart attempt on failure.

---

## Bloque 7: Métricas de Red y Health Checks

### 7.1 `@entropy/extension` — `background/metrics.ts` (nuevo)

Recopilar métricas operacionales del nodo:

```typescript
export interface NodeMetrics {
  // Uptime
  startedAt: number;
  uptimeSeconds: number;

  // Transfers
  chunksServed: number;
  chunksFailed: number;
  bytesUploaded: number;
  bytesDownloaded: number;

  // Connections
  activePeerConnections: number;
  totalConnectionsEstablished: number;
  totalConnectionsFailed: number;

  // Cold storage
  coldAssignmentsActive: number;
  premiumCreditsEarned: number;

  // Relays
  connectedRelays: number;
  totalRelays: number;

  // Reputation
  knownPeers: number;
  bannedPeers: number;
}

export function createMetricsCollector(): MetricsCollector;
```

### 7.2 Health check endpoint

El scheduler periódicamente verifica:

1. **Relay connectivity:** ¿Al menos 1 relay conectado? Si no, intentar reconexión.
2. **Storage health:** ¿Hay espacio disponible? Si < 5% libre, trigger evicción LRU.
3. **Signaling health:** ¿Se han recibido señales en los últimos 5min? (Si seeding activo.)
4. **Cold storage health:** ¿Los chunks de las asignaciones activas siguen en IndexedDB?

### 7.3 UI: Dashboard — Panel de métricas

Ampliar el dashboard de extensión existente:

- **Uptime:** tiempo desde inicio del SW.
- **Transfers:** gráfico simple de chunks served/failed en las últimas 24h.
- **Connections:** peers activos, total histórico.
- **Health status:** indicadores verde/amarillo/rojo para cada health check.

### 7.4 UI: Web App — Componente `NetworkHealth`

Widget compacto en la TopBar o Settings que muestra estado de conectividad:

- Relays: X/Y conectados.
- Peers: X activos.
- Storage: X% usado.

### 7.5 Mensaje bridge: `GET_NODE_METRICS`

Nuevo message type en `extension-bridge.ts`:

```typescript
| Web → Ext | `GET_NODE_METRICS` | Query detailed node metrics |
| Ext → Web | `METRICS_UPDATE`   | Push: periodic metrics snapshot |
```

### 7.6 Tests

- `metrics.test.ts`: verify metric recording and aggregation.
- Integración: verify scheduler triggers health checks.

---

## Bloque 8: Soporte Tor Opcional

### 8.1 Alcance Phase 5

Soporte Tor es un feature avanzado. En Phase 5, el alcance es:

1. **Documentar** la arquitectura para routing de WebRTC sobre Tor.
2. **Preparar** la configuración del extension manifest para permitir conexiones a `.onion` relays.
3. **Implementar** la opción de usar relays Nostr sobre Tor (`.onion` relay URLs) para señalización.
4. **NO** implementar routing de tráfico WebRTC data channel sobre Tor (requiere TURN sobre Tor, fuera de scope).

### 8.2 Configuración en `SettingsPage` / Dashboard

- Toggle "Use Tor for signaling" (off por defecto).
- Campo para agregar `.onion` relay URLs.
- Warning: "WebRTC data transfers still expose your IP to peers. Only signaling is routed through Tor."

### 8.3 Integración en `relay-manager.ts`

Detectar `.onion` URLs y configurar proxy SOCKS si disponible.

---

## Bloque 9: Auditoría de Seguridad

### 9.1 Checklist de seguridad

| Área | Verificación | Estado |
|---|---|---|
| **NIP-04/44 encryption** | SDP offers/answers encriptados — ¿puede un relay leer la señalización? | Pendiente |
| **Hash verification** | ¿Se verifica SHA-256 de cada chunk recibido antes de almacenarlo? | Parcial (chunk-downloader sí, peer-fetch hay que verificar) |
| **Private key handling** | ¿La privkey nunca se expone fuera del extension SW? | Verificar |
| **Content script isolation** | ¿El content script solo relaya mensajes sin acceder a datos sensibles? | Verificar |
| **IndexedDB access** | ¿Solo el origen de la extensión puede leer chunks almacenados? | Verificar |
| **Replay attacks** | ¿Los timestamps de señalización previenen replay de offers/answers? | ✅ (5s window) |
| **DoS protection** | ¿Hay rate limiting en chunk requests entrantes? | Pendiente |
| **Memory leaks** | ¿Se limpian RTCPeerConnections y DataChannels correctamente? | Verificar |
| **CSP headers** | ¿La web app tiene Content Security Policy apropiada? | Pendiente |

### 9.2 Tareas de hardening

1. **Rate limiting en chunk-server:** Máximo 10 requests/segundo por peer. Rechazar con `CHUNK_ERROR(reason=BUSY)`.
2. **Validar tamaño de mensajes entrantes:** Rechazar mensajes > 10MB en DataChannel `onmessage`.
3. **Timeout de DataChannels inactivos:** Cerrar canales sin actividad en 60s.
4. **Limpiar RTCPeerConnections:** Verificar que `pc.close()` se llama en todos los paths de error.
5. **CSP para web app:** Configurar `Content-Security-Policy` en `index.html`.
6. **Verificar SHA-256 en peer-fetch.ts:** Añadir verificación de hash antes de resolver el chunk.

---

## Orden de Implementación

```
┌─────────────────────────────────────────────────────────────────┐
│  Bloque 1: Reputación de Peers + Banning                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ✅ 1.1  peer-reputation.ts (PeerReputationStore interface)      │
│  ✅ 1.2  peer-reputation-idb.ts (Dexie implementation)           │
│  ✅ 1.3  Integrar en chunk-server.ts (seeder side)               │
│  ✅ 1.4  Integrar en chunk-downloader.ts (downloader side)       │
│  ✅ 1.5  Integrar en peer-fetch.ts (extension fetcher)           │
│  ✅ 1.6  Dashboard UI: peers table + ban/unban                   │
│  ✅ 1.7  Tests                                                   │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Bloque 2: Cold Storage Real                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ✅ 2.1  cold-storage-manager.ts (extension)                     │
│  ✅ 2.2  Integrar en scheduler.ts (periodic cycles)              │
│  ✅ 2.3  Dashboard UI: cold storage panel (ext + web)            │
│  ✅ 2.4  Tests                                                   │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Bloque 3: Seeder Announcements                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ✅ 3.1  seeder-announcement.ts (core: build/parse kind:20002)   │
│  ✅ 3.2  Publicar announcements en signaling-listener.ts         │
│  ✅ 3.3  Descubrir seeders en chunk-downloader.ts                │
│  ✅ 3.4  Tests                                                   │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Bloque 4: Prueba de Custodia                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ✅ 4.1  Extend chunk-transfer.ts (CUSTODY_CHALLENGE/PROOF)      │
│  ✅ 4.2  Handle challenges in chunk-server.ts                    │
│  ✅ 4.3  Self-verification in cold-storage-manager.ts            │
│  ✅ 4.4  Tests                                                   │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Bloque 5: Transmuxing + Keyframe Alignment                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ○ 5.1  Install mp4box dependency                               │
│  ○ 5.2  keyframe-aligner.ts (core: upload pre-processing)       │
│  ○ 5.3  transmuxer.ts (core: playback transmuxing)              │
│  ○ 5.4  Integrar en useMediaSource.ts                           │
│  ○ 5.5  Integrar en useUploadPipeline.ts                        │
│  ○ 5.6  Tests                                                   │
│                                                                 │
│  ⚠️  PENDIENTE                                                   │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Bloque 6: Reconexión WebRTC                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ○ 6.1  ICE restart logic in chunk-downloader.ts                │
│  ○ 6.2  ICE restart in peer-fetch.ts                            │
│  ○ 6.3  Accept iceRestart offers in signaling-listener.ts       │
│  ○ 6.4  Tests                                                   │
│                                                                 │
│  ⚠️  PENDIENTE                                                   │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Bloque 7: Métricas + Health Checks                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ✅ 7.1  metrics.ts (extension: MetricsCollector)                │
│  ✅ 7.2  Health checks in scheduler.ts                           │
│  ✅ 7.3  GET_NODE_METRICS bridge message                         │
│  ✅ 7.4  Dashboard: metrics panel (ext + web NodeMetricsPanel)   │
│  ○ 7.5  Web: NetworkHealth widget en TopBar                     │
│  ✅ 7.6  Tests (metrics.test.ts — 8 tests)                       │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Bloque 8: Soporte Tor (señalización only)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ○ 8.1  .onion relay URL support in relay-manager.ts            │
│  ○ 8.2  Settings UI: Tor toggle + .onion relay config           │
│  ○ 8.3  Documentation                                           │
│                                                                 │
│  ⚠️  PENDIENTE                                                   │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Bloque 9: Auditoría de Seguridad                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ✅ 9.1  Rate limiting in chunk-server.ts (10 req/s per peer)    │
│  ✅ 9.2  Message size validation (4 MB max) in DataChannel       │
│  ✅ 9.3  Inactive DataChannel timeout (60s)                      │
│  ○ 9.4  RTCPeerConnection cleanup audit                         │
│  ✅ 9.5  CSP headers for web app (index.html meta tag)           │
│  ✅ 9.6  SHA-256 verification in peer-fetch.ts                   │
│  ○ 9.7  Full security checklist pass                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Archivos Nuevos

| Paquete | Archivo | Estado | Descripción |
|---|---|---|---|
| core | `credits/peer-reputation.ts` | ✅ | `PeerReputationStore` interface + banning policy |
| core | `storage/peer-reputation-idb.ts` | ✅ | IndexedDB implementation de PeerReputationStore |
| core | `nostr/seeder-announcement.ts` | ✅ | Build/parse kind:20002 seeder announcements |
| core | `chunking/keyframe-aligner.ts` | ⏳ pendiente | Chunking con alineación a keyframes de video |
| core | `transport/transmuxer.ts` | ⏳ pendiente | Transmuxing on-the-fly para MSE playback |
| core | `__tests__/peer-reputation.test.ts` | ✅ | Tests de reputación de peers (6 tests) |
| core | `__tests__/peer-reputation-idb.test.ts` | ✅ | Tests de IDB reputation store (5 tests) |
| core | `__tests__/seeder-announcement.test.ts` | ✅ | Tests de seeder announcements (4 tests) |
| core | `__tests__/keyframe-aligner.test.ts` | ⏳ pendiente | Tests de keyframe alignment |
| core | `__tests__/transmuxer.test.ts` | ⏳ pendiente | Tests de transmuxing |
| extension | `background/cold-storage-manager.ts` | ✅ | Gestor de cold storage real (runCycle, pruneExpired, verifyIntegrity) |
| extension | `background/metrics.ts` | ✅ | MetricsCollector con persistencia y health checks |
| extension | `__tests__/cold-storage-manager.test.ts` | ✅ | Tests de cold storage manager (8 tests) |
| extension | `__tests__/metrics.test.ts` | ✅ | Tests de métricas (8 tests) |
| extension | `__tests__/credit-ledger.test.ts` | ✅ | Tests de credit ledger persistence (10 tests) |
| extension | `__tests__/chunk-server.test.ts` | ✅ | Tests de rate limiting + oversized messages (7 tests) |
| extension | `__tests__/signaling-listener.test.ts` | ✅ | Tests de seeder announcements en signaling (3 tests) |
| web | `src/hooks/useColdStorage.ts` | ✅ | Hook para cold storage assignments desde extensión |
| web | `src/hooks/useNodeMetrics.ts` | ✅ | Hook para métricas del nodo con auto-refresh 30s |
| web | `src/hooks/useCreditGate.ts` | ✅ | Hook de credit gating con bypass por owner y local cache |
| web | `src/components/CreditGate.tsx` | ✅ | Componente UI de overlay bloqueante con ad placeholder y earn options |
| web | `src/components/ColdStoragePanel.tsx` | ✅ | Panel web de cold storage con release individual |
| web | `src/components/NodeMetricsPanel.tsx` | ✅ | Panel web de métricas con health badge |
| web | `src/__tests__/useCreditGate.test.ts` | ✅ | Tests de credit gate hook: owner bypass, local bypass, balance check (16 tests) |

## Archivos Modificados

| Paquete | Archivo | Estado | Cambio |
|---|---|---|---|
| core | `transport/chunk-transfer.ts` | ✅ | CUSTODY_CHALLENGE (0x05) y CUSTODY_PROOF (0x06) |
| core | `transport/chunk-downloader.ts` | ✅ | Reputación + seeder discovery (kind:20002) + SHA-256 verify |
| core | `storage/db.ts` | ✅ | Tabla `peers` en Dexie schema |
| core | `types/extension-bridge.ts` | ✅ | `GET_NODE_METRICS`, `NodeMetricsPayload`, `isNodeMetricsPayload`, `GET_COLD_STORAGE_ASSIGNMENTS`, `RELEASE_COLD_ASSIGNMENT`, `CHECK_LOCAL_CHUNKS`, `CheckLocalChunksPayload`, `CheckLocalChunksResultPayload` |
| core | `index.ts` | ✅ | Exportar todos los módulos nuevos |
| core | `package.json` | ⏳ pendiente | Agregar `mp4box` dependency (Bloque 5) |
| extension | `background/chunk-server.ts` | ✅ | Reputación + rate limiting (10 req/s) + 4MB size guard + 60s inactivity timeout + custody challenge handler |
| extension | `background/peer-fetch.ts` | ✅ | Reputación + SHA-256 hash verification + skip banned peers + peerPubkey en PeerChunkResult |
| extension | `background/p2p-bridge.ts` | ✅ | peerPubkey en PeerChunkResult de offscreen path |
| extension | `background/signaling-listener.ts` | ✅ | Publicar seeder announcements (kind:20002) + re-publicación periódica |
| extension | `background/scheduler.ts` | ✅ | Cold storage cycles (30min) + prune (1h) + integrity check (2h) + health checks (10min) |
| extension | `background/service-worker.ts` | ✅ | Bootstrap metricsCollector + coldStorageManager + GET_NODE_METRICS + CHECK_LOCAL_CHUNKS + recordDownloadCredit en GET_CHUNK P2P fallback |
| extension | `shared/status-client.ts` | ✅ | `requestNodeMetrics`, `requestColdStorageAssignments`, `releaseColdStorageAssignment` |
| extension | `dashboard/index.html` | ✅ | Secciones peers, cold storage, metrics |
| extension | `dashboard/main.ts` | ✅ | Panels: peers table + ban/unban, cold storage list + release, metrics |
| extension | `dashboard/styles.css` | ✅ | Estilos para todos los paneles nuevos |
| web | `src/lib/extension-bridge.ts` | ✅ | `getNodeMetrics()`, `getColdStorageAssignments()`, `releaseColdAssignment()`, `checkLocalChunks()` + overloads |
| web | `src/App.tsx` | ✅ | Integrar ColdStoragePanel + NodeMetricsPanel |
| web | `src/styles.css` | ✅ | Estilos para panels de cold storage, métricas y CreditGate |
| web | `src/components/feed/PostCard.tsx` | ✅ | Integrar CreditGate con owner bypass + chunk hashes para local check |
| web | `src/pages/WatchPage.tsx` | ✅ | Integrar CreditGate con author pubkey tracking + local check |
| web | `index.html` | ✅ | CSP meta tag |
| web | `src/hooks/useMediaSource.ts` | ⏳ pendiente | Integrar transmuxer fallback (Bloque 5) |
| web | `src/hooks/useUploadPipeline.ts` | ⏳ pendiente | Integrar keyframe alignment para video (Bloque 5) |
| web | `src/components/layout/TopBar.tsx` | ⏳ pendiente | NetworkHealth widget (Bloque 7 restante) |

---

## Dependencias Nuevas

| Paquete | Dependencia | Versión | Uso |
|---|---|---|---|
| `@entropy/core` | `mp4box` | `^0.5.x` | Parsing MP4, detección de keyframes, generación de init segments |

---

## Verificación

### Automatizada

```bash
pnpm --filter @entropy/core test          # Tests existentes + peer-reputation, seeder-announcement, keyframe-aligner, transmuxer, custody protocol
pnpm --filter @entropy/extension test     # Tests existentes + cold-storage-manager, metrics
pnpm --filter @entropy/web test           # Tests existentes + updated hooks
pnpm typecheck                             # 3/3 paquetes sin errores
pnpm --filter @entropy/web build          # Build exitoso
pnpm --filter @entropy/extension build    # Sin regresiones
```

### Manual

1. **Peer reputation:** Simular envío de chunk con hash inválido → verificar que el peer se marca como failed y eventualmente se banea.
2. **Cold storage:** Con un nodo con ratio ≥ 2.0, verificar que el scheduler asigna cold chunks automáticamente y que aparecen en el dashboard.
3. **Seeder discovery:** Subir contenido desde nodo A, aceptar seeding en nodo B (no listado como gatekeeper), descargar desde nodo C → verificar que C descubre B vía kind:20002.
4. **Custody proof:** Enviar custody challenge a un custodio → verificar respuesta correcta. Corromper chunk → verificar que el challenge falla.
5. **Transmuxing:** Subir un archivo WebM → verificar que el reproductor lo reproduce mediante transmuxing a fMP4.
6. **Reconexión:** Durante una descarga, desconectar la red del seeder por 3s → verificar que ICE se reconecta. Desconectar por 20s → verificar que el chunk se re-asigna a otro peer.
7. **Métricas:** Verificar que el dashboard muestra métricas en tiempo real y que los health checks se ejecutan periódicamente.
8. **Rate limiting:** Enviar >10 CHUNK_REQUEST/s desde un peer → verificar que se recibe CHUNK_ERROR(BUSY).

---

## Criterios de Aceptación (DoD)

- [x] Peers que envían chunks con hash inválido son baneados automáticamente después de 3 fallos y no se les solicitan ni sirven más chunks.
- [x] Nodos con ratio ≥ 2.0 reciben automáticamente asignaciones de cold storage y acumulan premium credits.
- [x] Seeders dinámicos son descubiertos vía kind:20002 sin necesidad de estar listados como gatekeepers en el chunk map original.
- [x] Las pruebas de custodia (self-verification) verifican que los custodios realmente poseen los chunks asignados.
- [ ] Archivos multimedia no-MP4 se reproducen mediante transmuxing client-side. *(Bloque 5 — pendiente)*
- [ ] Los chunks de video se alinean con keyframes durante el upload para streaming fluido. *(Bloque 5 — pendiente)*
- [ ] Conexiones WebRTC se reconectan automáticamente tras desconexiones temporales (≤5s). *(Bloque 6 — pendiente)*
- [x] El dashboard de extensión y la web app muestran métricas operacionales detalladas y health checks.
- [x] Chunk requests entrantes están rate-limited (10 req/s) y todos los mensajes se validan por tamaño (4 MB max).
- [x] Credit gating bloquea descargas P2P cuando el usuario no tiene créditos suficientes, con bypass para contenido propio y cacheado localmente.
- [x] Typecheck, build y tests pasan sin errores en los 3 paquetes. *(core: 130 tests ✅ · extension: 46 tests ✅ · web: 19 tests ✅)*
