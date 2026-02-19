# Fase 3 — Extensión de Navegador: Background Seeding Real

> Objetivo: El Service Worker de la extensión mantiene conexiones WebRTC activas y sirve chunks a peers en background, incluso sin la web app abierta.

---

## Contexto

Phase 1 (✅) entregó: chunking + hashing + Merkle tree, cliente Nostr, señalización WebRTC, web app mínima con uploader.

Phase 2 (✅) entregó: motor de créditos (proof-of-upstream, ledger, cold-storage), storage scaffolds (chunk-store, db, quota-manager, quota-aware-store), bridge protocol extendido (GET_CREDIT_SUMMARY, CREDIT_UPDATE, SERVE_CHUNK con gating), integración en extensión (credit-ledger persistido, popup/dashboard con créditos) y web (CreditPanel, useCredits).

### Lo que YA existe en la extensión

| Componente | Estado | Archivos |
|---|---|---|
| Manifest V3 scaffold | ✅ | `manifest.json`, `vite.config.ts` |
| Service Worker (message handler) | ✅ | `background/service-worker.ts` |
| Content script (bridge web↔ext) | ✅ | `content/content-script.ts` |
| Popup mini-dashboard | ✅ | `popup/main.ts`, `popup/styles.css` |
| Dashboard completo | ✅ | `dashboard/main.ts`, `dashboard/styles.css` |
| Seeder (delegaciones en chrome.storage) | ✅ | `background/seeder.ts` |
| Credit ledger (persistido) | ✅ | `background/credit-ledger.ts` |
| Scheduler (prune) | ✅ | `background/scheduler.ts` |
| Status client + messaging | ✅ | `shared/status-client.ts`, `shared/messaging.ts` |

### Lo que FALTA (única checkbox pendiente en architecture.md Fase 3)

> `[ ] Service Worker: mantener conexiones WebRTC activas`

### Estado actual (actualizado)

| Bloque | Estado | Notas |
|---|---|---|
| Bloque 1 (core infra) | ✅ Completado | Identity, NAT traversal, chunk transfer binario, IndexedDB chunk store, quota-manager-idb, exports y tests core. |
| Bloque 2 (extension background) | ✅ Completado (base funcional) | `identity-store`, `relay-manager`, `signaling-listener`, `chunk-server`, `chunk-ingest`, bootstrap del SW, permisos de manifest. |
| Bloque 3.1 (bridge messages) | ✅ Completado | `STORE_CHUNK`, `IMPORT_KEYPAIR`, `GET_PUBLIC_KEY`, `GET_NODE_SETTINGS`, `ADD_RELAY`, `REMOVE_RELAY`, `SET_SEEDING_ACTIVE` en protocolo y web/extension bridge. |
| Bloque 3.4 (web delegación con chunks) | ✅ Completado | La web envía chunks vía `STORE_CHUNK` antes de `DELEGATE_SEEDING`. |
| Bloque 3.2 (dashboard inventario real) | ✅ Completado | Dashboard muestra roots/chunks almacenados en IndexedDB y barra de uso de cuota. |
| Bloque 3.3 (dashboard settings de nodo) | ✅ Completado | Key management (`GET_PUBLIC_KEY`/`IMPORT_KEYPAIR`), relay list con add/remove, toggle seeding activo. SW maneja los 4 nuevos mensajes. |
| Bloque 4.1/4.3 (core tests + typecheck/build) | ✅ Completado | 86 tests core passing; typecheck 3 paquetes y build verificados. |
| Bloque 4.2 (tests unitarios extension) | ✅ Completado | Tests para `relay-manager`, `signaling-listener`, `chunk-server`, `identity-store` con Vitest. |
| Bloque 4.4 (E2E manual completo) | ⏳ Pendiente | Falta corrida E2E completa entre navegadores con validación manual end-to-end. |

---

## Dependencias de Phase 1 + Phase 2

Módulos existentes que se reutilizan directamente:

- `@entropy/core` — `transport/peer-manager.ts` (pool de RTCPeerConnection con eventos)
- `@entropy/core` — `transport/signaling-channel.ts` (señalización WebRTC vía Nostr)
- `@entropy/core` — `nostr/client.ts` (Relay, RelayPool)
- `@entropy/core` — `storage/chunk-store.ts` (interfaz ChunkStore — necesita impl IndexedDB)
- `@entropy/core` — `storage/quota-aware-store.ts` (storeChunkWithQuota)
- `@entropy/core` — `credits/proof-of-upstream.ts`, `credits/ledger.ts`
- `@entropy/extension` — `background/credit-ledger.ts` (accounting persistido)
- `@entropy/extension` — `background/seeder.ts` (registro de delegaciones)

---

## Entregables

### 1. `@entropy/core` — Storage IndexedDB real ✅

#### 1.1 `storage/indexeddb-chunk-store.ts` — Implementación de `ChunkStore` sobre Dexie.js

El `ChunkStore` actual (`InMemoryChunkStore`) solo vive en memoria. Para background seeding real necesitamos persistencia en IndexedDB.

**Implementación:**

```typescript
import Dexie from "dexie";
import type { ChunkStore, StoredChunk } from "./chunk-store";

class IndexedDbChunkStore extends Dexie implements ChunkStore {
  chunks!: Dexie.Table<StoredChunk, string>;

  constructor(dbName = "entropy-chunks") {
    super(dbName);
    this.version(1).stores({
      chunks: "hash, rootHash, lastAccessed, pinned"
    });
  }

  async storeChunk(chunk: StoredChunk): Promise<void>;
  async getChunk(hash: string): Promise<StoredChunk | null>;
  async hasChunk(hash: string): Promise<boolean>;
  async deleteChunk(hash: string): Promise<void>;
  async listChunksByRoot(rootHash: string): Promise<StoredChunk[]>;
  async listAllChunks(): Promise<StoredChunk[]>;
  async getStoreSize(): Promise<number>;
}
```

**Nota:** Dexie.js funciona en Service Workers y soporta `ArrayBuffer` nativamente.

#### 1.2 `storage/quota-manager-idb.ts` — QuotaManager conectado a IndexedDB

Versión del QuotaManager que usa `navigator.storage.estimate()` real y delega evicción LRU al `IndexedDbChunkStore` (ordenar por `lastAccessed`, excluir `pinned`).

---

### 2. `@entropy/core` — Protocolo de transferencia de chunks ✅

#### 2.1 `transport/chunk-transfer.ts` — Protocolo binario sobre DataChannel

Define el protocolo para solicitar y enviar chunks sobre RTCDataChannel.

**Tipos:**

```typescript
type ChunkRequestMessage = {
  type: "CHUNK_REQUEST";
  chunkHash: string;
  rootHash: string;
  requesterPubkey: string;
};

type ChunkResponseMessage = {
  type: "CHUNK_DATA";
  chunkHash: string;
  data: ArrayBuffer;
};

type ChunkErrorMessage = {
  type: "CHUNK_ERROR";
  chunkHash: string;
  reason: "NOT_FOUND" | "INSUFFICIENT_CREDIT" | "BUSY";
};

type ChunkTransferMessage = ChunkRequestMessage | ChunkResponseMessage | ChunkErrorMessage;
```

**Funciones:**

| Función | Descripción |
|---|---|
| `encodeChunkRequest(msg: ChunkRequestMessage): ArrayBuffer` | Serializa solicitud a binario. |
| `encodeChunkResponse(msg: ChunkResponseMessage): ArrayBuffer` | Serializa respuesta (header + data). |
| `encodeChunkError(msg: ChunkErrorMessage): ArrayBuffer` | Serializa error. |
| `decodeChunkTransferMessage(buffer: ArrayBuffer): ChunkTransferMessage` | Deserializa cualquier mensaje del protocolo. |
| `sendChunkOverDataChannel(channel: RTCDataChannel, chunk: StoredChunk): void` | Envía un chunk respetando el bufferedAmount del canal (backpressure). |

**Decisión de diseño:** Se usa un formato binario simple: 1 byte de tipo + 32 bytes de hash + payload. Esto minimiza overhead vs JSON para transferencias de 5MB.

---

#### 2.2 `transport/nat-traversal.ts` — Configuración STUN/TURN

```typescript
interface StunTurnConfig {
  iceServers: RTCIceServer[];
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];

function createRtcConfiguration(custom?: Partial<StunTurnConfig>): RTCConfiguration;
```

**Nota:** Solo STUN para Phase 3. TURN servers (para NATs simétricos) se evaluarán en Phase 5.

---

### 3. `@entropy/core` — Gestión de identidad ✅

#### 3.1 `nostr/identity.ts` — Keypair management

El seeding en background requiere firmar eventos Nostr (señalización, recibos). Necesitamos gestión de keypair.

**Funciones:**

| Función | Descripción |
|---|---|
| `generateKeypair(): { pubkey: string; privkey: string }` | Genera un nuevo keypair secp256k1. |
| `pubkeyFromPrivkey(privkey: string): string` | Deriva la pubkey desde la privkey. |
| `signEvent(draft: NostrEventDraft, privkey: string): NostrEvent` | Firma un evento Nostr (usa `nostr-tools`). |
| `verifyEventSignature(event: NostrEvent): boolean` | Verifica la firma de un evento. |

**Dependencia:** `nostr-tools` (ya alineado con el stack per phase2.md decisión).

---

### 4. `@entropy/extension` — Seeding activo en background ✅ (base funcional)

#### 4.1 `background/relay-manager.ts` — Conexión a relays desde el Service Worker

El Service Worker mantiene su propia conexión a relays Nostr, independiente de la web app.

**Responsabilidades:**

- Conectar a una lista configurable de relays al activarse el SW.
- Reconectar automáticamente tras desconexión o restart del SW.
- Exponer el `RelayPool` para que el signaling listener y el publisher lo usen.
- Persistir la lista de relays en `chrome.storage.local`.

**API:**

```typescript
function initRelayManager(relayUrls?: string[]): Promise<RelayPool>;
function getRelayPool(): RelayPool;
function addRelay(url: string): Promise<void>;
function removeRelay(url: string): Promise<void>;
function getRelayStatuses(): RelayInfo[];
```

**Ciclo de vida del SW:**

```
SW activado → initRelayManager() → conectar a relays
         ↓
chrome.runtime.onStartup → reconectar relays
         ↓
SW idle timeout (30s-5min) → relays se desconectan
         ↓
chrome.alarms (cada 25s) → keepAlive() para mantener SW activo
         ↓
SW killed → siguiente evento → re-init
```

Se usa `chrome.alarms` API para mantener el SW activo mientras haya delegaciones activas.

---

#### 4.2 `background/signaling-listener.ts` — Escuchar solicitudes WebRTC entrantes

**Responsabilidades:**

- Suscribirse a eventos efímeros de señalización (kind 20001) dirigidos a la pubkey del usuario.
- Para cada offer recibido:
  1. Verificar que el rootHash solicitado existe en nuestras delegaciones.
  2. Verificar crédito del peer solicitante (vía ledger).
  3. Crear un `RTCPeerConnection` con configuración STUN.
  4. Generar answer y enviarlo vía relay.
  5. Intercambiar ICE candidates.
  6. Establecer DataChannel.

**API:**

```typescript
function startSignalingListener(
  pool: RelayPool,
  myPubkey: string,
  onPeerConnected: (pubkey: string, dataChannel: RTCDataChannel) => void
): () => void;
```

---

#### 4.3 `background/chunk-server.ts` — Servir chunks a peers conectados

**Responsabilidades:**

- Escuchar mensajes `CHUNK_REQUEST` en DataChannels activos.
- Buscar el chunk en `IndexedDbChunkStore`.
- Verificar crédito del peer antes de servir.
- Enviar el chunk vía DataChannel (con backpressure).
- Generar `UpstreamReceipt` y registrar en el credit ledger.
- Emitir `CREDIT_UPDATE` a popup/dashboard/web.

**API:**

```typescript
function handleDataChannel(
  channel: RTCDataChannel,
  peerPubkey: string,
  chunkStore: ChunkStore,
  onChunkServed: (chunkHash: string, bytes: number) => void
): void;
```

---

#### 4.4 `background/chunk-ingest.ts` — Persistir chunks reales al delegar seeding

Actualmente `DELEGATE_SEEDING` solo almacena **metadatos** (rootHash, chunkHashes, size). Para servir chunks reales, necesitamos que la web app envíe los chunks binarios.

**Opciones (elegir una):**

| Opción | Pros | Contras |
|---|---|---|
| **A) Enviar chunks vía chrome.runtime como ArrayBuffer** | Simple; sin cambios en content script. | Limitado por tamaño de mensaje (~64MB en Chrome). |
| **B) Escribir chunks a IndexedDB desde web y compartir DB** | Cero transferencia inter-proceso. | Requiere que web y extensión compartan la misma DB. |
| **C) Enviar chunks en batches vía bridge** | Funciona con cualquier tamaño. | Más complejo; múltiples mensajes. |

**Recomendación:** Opción B — compartir IndexedDB. La web app escribe chunks al `IndexedDbChunkStore` usando el mismo `dbName`. El SW solo necesita verificar que los chunks existen cuando recibe `DELEGATE_SEEDING`. Esto es posible porque extensión y web comparten el mismo origin si el content script media el acceso, o se puede usar la misma DB desde el content script context.

**Alternativa pragmática:** Opción C con batches. Nuevo mensaje bridge:

```typescript
type EntropyRuntimeMessage =
  | ... // existentes
  | {
      source: "entropy-web";
      requestId: string;
      type: "STORE_CHUNK";
      payload: {
        hash: string;
        rootHash: string;
        index: number;
        data: ArrayBuffer;  // El chunk binario
      };
    };
```

---

#### 4.5 `background/identity-store.ts` — Persistencia de keypair

**Responsabilidades:**

- Almacenar la privkey del usuario en `chrome.storage.local` (cifrada con `chrome.storage.session` si disponible).
- Exponer funciones para firmar eventos desde el SW.
- Permitir importar keypair existente desde la web app.

**API:**

```typescript
function getOrCreateKeypair(): Promise<{ pubkey: string; privkey: string }>;
function importKeypair(privkey: string): Promise<{ pubkey: string }>;
function getPublicKey(): Promise<string>;
function signNostrEvent(draft: NostrEventDraft): Promise<NostrEvent>;
```

**Nuevo mensaje bridge:**

| Mensaje | Dirección | Payload |
|---|---|---|
| `IMPORT_KEYPAIR` | Web → Ext | `{ privkey: string }` |
| `GET_PUBLIC_KEY` | Web → Ext | — |

---

#### 4.6 Actualizar `background/service-worker.ts` — Bootstrap completo

El SW actual solo maneja mensajes del bridge. Necesita:

1. **Al activarse:**
   - Cargar keypair desde storage.
   - Inicializar `RelayPool` y conectar a relays.
   - Inicializar `IndexedDbChunkStore`.
   - Iniciar signaling listener.
   - Registrar `chrome.alarms` keep-alive.

2. **Nuevos handlers de mensajes:**
   - `STORE_CHUNK` — persistir chunk en IndexedDB.
   - `IMPORT_KEYPAIR` — guardar keypair.
   - `GET_PUBLIC_KEY` — retornar pubkey.

3. **Lifecycle:**
   - `chrome.alarms.onAlarm` → reconectar relays si desconectados.
   - `chrome.runtime.onStartup` → full re-init.
   - `chrome.runtime.onInstalled` → inicializar storage, schedule maintenance.

---

#### 4.7 Actualizar `manifest.json`

Nuevos permisos necesarios:

```json
{
  "permissions": ["storage", "alarms", "idle"],
  "host_permissions": ["<all_urls>"]
}
```

- `alarms` — para keep-alive del SW y tareas programadas.
- `idle` — para detectar si el usuario está activo (optimizar seeding).

---

### 5. `@entropy/extension` — Dashboard mejorado ⏳

#### 5.1 Inventario de chunks real

El dashboard actualmente muestra solo estadísticas básicas. Con chunks persistidos en IndexedDB, puede mostrar:

- Lista de chunks en custodia (agrupados por rootHash).
- Tamaño total almacenado vs cuota.
- Estado de cada delegación (chunks completos / parciales).
- Botón para pin/unpin chunks.
- Barra de uso de cuota con visual de distribución.

#### 5.2 Configuración de nodo

Panel de settings en el dashboard:

- Lista de relays (agregar/remover).
- Límite de cuota de almacenamiento.
- Límite de ancho de banda (opcional).
- ✅ Importar keypair + mostrar pubkey actual (base).
- ⏳ Exportar keypair.
- Toggle de seeding activo/pausado.

---

### 6. `@entropy/core` — Tests nuevos ✅

| Archivo | Cobertura |
|---|---|
| `indexeddb-chunk-store.test.ts` | CRUD sobre IndexedDB (fake-indexeddb), LRU tracking, listado por root. |
| `chunk-transfer.test.ts` | Encode/decode de mensajes binarios, roundtrip, manejo de mensajes malformados. |
| `nat-traversal.test.ts` | Generación de RTCConfiguration con STUN servers default y custom. |
| `identity.test.ts` | Generación de keypair, firma de eventos, verificación de firma, derivación pubkey. |
| `quota-manager-idb.test.ts` | Adaptador de quota manager para escenarios de store IDB. |

### 7. `@entropy/extension` — Tests ✅ (unitarios)

| Archivo | Cobertura |
|---|---|
| `relay-manager.test.ts` | Init, reconnect, add/remove relay. |
| `signaling-listener.test.ts` | Parseo de offers, filtrado por pubkey, rechazo de rootHash desconocido. |
| `chunk-server.test.ts` | Servir chunk existente, rechazar por crédito insuficiente, rechazar chunk no encontrado. |
| `identity-store.test.ts` | Persist/retrieve keypair, import, sign. |

Estado actual: ✅ tests ejecutándose en `@entropy/extension` vía Vitest.

---

## Orden de implementación

```
┌─────────────────────────────────────────────────────────────────┐
│  Bloque 1: Infraestructura core (sin dependencia de extensión)  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ✅ 1.1  identity.ts + tests                                     │
│  ✅ 1.2  nat-traversal.ts + tests                                │
│  ✅ 1.3  chunk-transfer.ts + tests                               │
│  ✅ 1.4  indexeddb-chunk-store.ts + tests                        │
│  ✅ 1.5  quota-manager-idb.ts (conectar a IndexedDB real)        │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Bloque 2: Extension background seeding                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ✅ 2.1  identity-store.ts (keypair en chrome.storage)           │
│  ✅ 2.2  relay-manager.ts (RelayPool + reconnect + keep-alive)   │
│  ✅ 2.3  signaling-listener.ts (escuchar offers, negociar WebRTC)│
│  ✅ 2.4  chunk-server.ts (servir chunks vía DataChannel)         │
│  ✅ 2.5  chunk-ingest.ts (persistir chunks al delegar)           │
│  ✅ 2.6  service-worker.ts update (bootstrap completo)           │
│  ✅ 2.7  manifest.json update (permisos)                         │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Bloque 3: Dashboard + bridge updates                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ✅ 3.1  Nuevos mensajes bridge (STORE_CHUNK, IMPORT_KEYPAIR,    │
│       GET_PUBLIC_KEY) en extension-bridge.ts                    │
│  ✅ 3.2  Dashboard: inventario de chunks real                    │
│  ◐ 3.3  Dashboard: panel de configuración (identity base ✅)     │
│  ✅ 3.4  Web: actualizar delegateSeeding para enviar chunks      │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Bloque 4: Tests + verificación                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ✅ 4.1  Tests unitarios (core: identity, nat, transfer, idb)    │
│  ✅ 4.2  Tests unitarios (ext: relay-mgr, signaling, chunk-server)|
│  ✅ 4.3  Typecheck + build de los 3 paquetes                     │
│  ⏳ 4.4  Test E2E manual: 2 navegadores intercambiando un chunk  │
│       vía la extensión en background                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Estimación:** ~12-15 archivos nuevos, ~5-7 archivos modificados. *(Superada por ampliación de alcance con dashboard/inventario + tests extension.)*

---

## Archivos nuevos

| Paquete | Archivo | Descripción |
|---|---|---|
| core | `nostr/identity.ts` | Keypair generation, signing, verification |
| core | `transport/chunk-transfer.ts` | Protocolo binario de transferencia |
| core | `transport/nat-traversal.ts` | Configuración STUN/TURN |
| core | `storage/indexeddb-chunk-store.ts` | ChunkStore sobre Dexie.js |
| core | `storage/quota-manager-idb.ts` | QuotaManager con IndexedDB real |
| core | `__tests__/identity.test.ts` | Tests de identity |
| core | `__tests__/chunk-transfer.test.ts` | Tests de protocolo |
| core | `__tests__/nat-traversal.test.ts` | Tests de configuración ICE |
| core | `__tests__/indexeddb-chunk-store.test.ts` | Tests de storage IDB |
| ext | `background/relay-manager.ts` | Gestión de relays en SW |
| ext | `background/signaling-listener.ts` | Listener de señalización |
| ext | `background/chunk-server.ts` | Servidor de chunks vía DataChannel |
| ext | `background/chunk-ingest.ts` | Ingesta de chunks binarios |
| ext | `background/identity-store.ts` | Keypair persistido |
| ext | `__tests__/relay-manager.test.ts` | Tests unitarios relay manager |
| ext | `__tests__/signaling-listener.test.ts` | Tests unitarios signaling listener |
| ext | `__tests__/chunk-server.test.ts` | Tests unitarios chunk server |
| ext | `__tests__/identity-store.test.ts` | Tests unitarios identity store |
| ext | `vitest.config.mjs` | Configuración de tests para extensión |

## Archivos modificados

| Paquete | Archivo | Cambio |
|---|---|---|
| core | `types/extension-bridge.ts` | Nuevos mensajes: `STORE_CHUNK`, `IMPORT_KEYPAIR`, `GET_PUBLIC_KEY` |
| core | `index.ts` | Exportar nuevos módulos |
| ext | `background/service-worker.ts` | Bootstrap completo: relays, signaling, chunk server, nuevos handlers |
| ext | `shared/messaging.ts` | Re-export de nuevos payloads/guards del bridge |
| ext | `shared/status-client.ts` | Helpers para `GET_PUBLIC_KEY` e `IMPORT_KEYPAIR` |
| ext | `manifest.json` | Permisos: `alarms`, `idle` |
| ext | `dashboard/main.ts` | UI/acciones para cargar pubkey e importar privkey |
| ext | `dashboard.html`, `dashboard/styles.css` | Controles de settings básicos para identidad |
| ext | `package.json` | Script `test` real + `vitest` devDependency |
| web | `lib/extension-bridge.ts` | Nuevas funciones: `storeChunk`, `importKeypair`, `getPublicKey` |
| web | `App.tsx` | Enviar chunks binarios al delegar seeding |

---

## Dependencias nuevas

| Paquete | Dependencia | Uso |
|---|---|---|
| `@entropy/core` | `dexie` (^4.x) | IndexedDB ergonómico para `IndexedDbChunkStore` |
| `@entropy/core` | `nostr-tools` (^2.x) | Firma y verificación de eventos Nostr (`signEvent`, `verifyEvent`, `getPublicKey`) |
| `@entropy/core` (devDep) | `fake-indexeddb` (^6.x) | Mock de IndexedDB para tests en Node |

**Nota:** `nostr-tools` ya estaba previsto en phase2.md como proveedor de firma. Phase 3 lo integra como dependencia real.

---

## Verificación

### Automatizada

```bash
pnpm --filter @entropy/core test          # Unit tests (chunking, identity, transfer, IDB store)
pnpm typecheck                             # 3/3 paquetes sin errores
pnpm --filter @entropy/extension build     # Build exitoso
pnpm --filter @entropy/web build           # Build exitoso
```

Estado actual: ✅ comandos ejecutados y pasando.

### Manual

1. **Instalar extensión** en Chrome (modo desarrollador, cargar `dist/`).
2. **Importar keypair** desde la web app → verificar que aparece en el dashboard.
3. **Generar chunk map** y delegar seeding → verificar que los chunks se persisten en IndexedDB del SW.
4. **Desde otro navegador** (o perfil): solicitar un chunk → verificar que el SW responde con señalización WebRTC → establece conexión → sirve el chunk.
5. **Cerrar la pestaña de la web app** → verificar que el seeding continúa desde el SW.
6. **Verificar dashboard**: estado/credits en vivo (inventario real y settings avanzados quedan pendientes de UI).
7. **Recargar extensión** → verificar que relays se reconectan y seeding se reanuda automáticamente.

### Test E2E completo (objetivo)

```
Browser A (web app)                Browser B (extensión only)
      │                                    │
      ├─ Upload archivo                    │
      ├─ Chunk + hash + Merkle             │
      ├─ Publicar kind:7001 a relay        │
      ├─ DELEGATE_SEEDING + chunks ───────►├─ Almacenar chunks en IDB
      │                                    ├─ Escuchar señalización
      │                                    │
      ├─ (cerrar pestaña)                  │
      │                                    │
Browser C (web app, otro usuario)          │
      │                                    │
      ├─ Ver kind:7001 en feed             │
      ├─ Solicitar chunk via señalización ►├─ Recibir offer
      │                                    ├─ Generar answer
      ├◄─ ICE exchange ──────────────────►├
      ├◄─ DataChannel established ────────►├
      ├◄─ CHUNK_REQUEST ─────────────────►├─ Verificar crédito
      ├◄─ CHUNK_DATA ◄────────────────────├─ Enviar chunk
      ├─ Verificar SHA-256                 ├─ Generar receipt
      ├─ Firmar receipt ──────────────────►├─ Registrar en ledger
      ├─ Almacenar chunk                   │
      ├─ Re-seed (ahora Browser C          │
      │   también es seeder)               │
      ▼                                    ▼
```

---

## Riesgos y decisiones abiertas

> [!IMPORTANT]
> **Service Worker lifecycle:** Chrome puede matar el SW después de ~30s de inactividad. `chrome.alarms` con intervalo mínimo de 1 minuto no es suficiente para mantener WebRTC connections alive. Soluciones: (1) usar `chrome.offscreen` API para crear un offscreen document que mantenga las conexiones, (2) usar `chrome.runtime.getBackgroundPage()` no disponible en MV3, (3) aceptar que las conexiones se re-establecen bajo demanda. **Recomendación: usar offscreen document como fallback para conexiones WebRTC activas.**

> [!WARNING]
> **Transferencia de chunks grandes vía bridge:** Enviar 5MB ArrayBuffers a través de `chrome.runtime.sendMessage` puede ser lento. Si la Opción B (IndexedDB compartida) no es viable por diferencia de origin, considerar usar `chrome.runtime.connectPort()` para streaming.

> [!NOTE]
> **TURN servers:** Phase 3 solo usa STUN (NAT traversal básico). Los NATs simétricos (~15% de usuarios) no podrán conectarse. TURN relay se evaluará en Phase 5.

> [!NOTE]
> **Firma real de recibos:** ✅ Integrada con `verifyEventSignature` en el Service Worker (ya no usa placeholder `wireReceiptVerifier(() => true)`).
