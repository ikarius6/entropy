# Fase 4 — Web App Completa: Red Social y Streaming Multimedia

> **Objetivo:** Transformar la infraestructura P2P de Entropy en una aplicación web funcional para el usuario final, con feed social Nostr, perfiles, carga de contenido con retroalimentación visual, y reproducción de video por streaming progresivo descentralizado (MediaSource Extensions + WebRTC multi-peer).

---

## Contexto

### Lo que YA existe

| Capa | Módulos | Estado |
|---|---|---|
| **Core — Chunking** | `chunker.ts`, `assembler.ts`, `merkle.ts`, `hash.ts` | ✅ |
| **Core — Nostr** | `client.ts` (`Relay`, `RelayPool`), `events.ts` (`buildEntropyChunkMapEvent`, `parseEntropyChunkMapEvent`), `nip-entropy.ts` (`kind:7001`, `EntropyChunkMap`), `signaling.ts`, `identity.ts` | ✅ |
| **Core — Transporte** | `peer-manager.ts` (`PeerManager`), `signaling-channel.ts` (`SignalingChannel`), `chunk-transfer.ts` (protocolo binario), `nat-traversal.ts` (STUN) | ✅ |
| **Core — Créditos** | `proof-of-upstream.ts`, `ledger.ts`, `cold-storage.ts`, `verify-receipt.ts` | ✅ |
| **Core — Storage** | `chunk-store.ts` (`ChunkStore`, `InMemoryChunkStore`), `indexeddb-chunk-store.ts` (Dexie), `quota-manager.ts`, `quota-manager-idb.ts`, `quota-aware-store.ts`, `db.ts` | ✅ |
| **Core — Bridge** | `extension-bridge.ts` (12 message types, `requestId` correlation, push messages) | ✅ |
| **Extension** | SW completo (relay-manager, signaling-listener, chunk-server, chunk-ingest, identity-store, credit-ledger, scheduler), popup, dashboard con inventario/settings | ✅ |
| **Web** | `App.tsx` (file picker + chunk map generator), `extension-bridge.ts`, `NodeStatusPanel`, `CreditPanel`, hooks `useCredits`, `useExtensionNodeStatus` | ✅ (mínima) |

### Lo que FALTA (architecture.md Fase 4)

```
- [ ] Feed de publicaciones (consulta de eventos kind:7001 + kind:1)
- [ ] Reproductor de video con MediaSource Extensions (streaming progresivo)
- [ ] UI de upload con progreso de chunking en tiempo real
- [ ] Perfiles Nostr (kind:0) y follows
- [ ] Descarga paralela desde múltiples peers
- [ ] Quota Manager y política de evicción LRU
- [ ] UI responsiva y accesible
```

---

## Dependencias de Phases 1–3

Módulos existentes que se reutilizan directamente:

- `@entropy/core` — `RelayPool` + `Relay` para conectar a relays Nostr y suscribirse a eventos.
- `@entropy/core` — `parseEntropyChunkMapEvent` / `parseEntropyChunkMapTags` para extraer `EntropyChunkMap` de eventos `kind:7001`.
- `@entropy/core` — `PeerManager` para mantener pool de conexiones WebRTC activas.
- `@entropy/core` — `SignalingChannel` para enviar offers/answers/ICE vía Nostr ephemeral events.
- `@entropy/core` — `encodeChunkRequest` / `decodeChunkTransferMessage` para protocolo binario sobre DataChannel.
- `@entropy/core` — `assembleChunks` para reensamblar `ArrayBuffer[]` a `Blob`.
- `@entropy/core` — `createRtcConfiguration` (STUN config) de `nat-traversal.ts`.
- `@entropy/core` — `ChunkStore` / `createIndexedDbChunkStore` para caché de chunks en el navegador web.
- `@entropy/core` — `QuotaManagerIdb` para evicción LRU.
- `@entropy/core` — `signEvent` / `verifyEventSignature` de `identity.ts` para firmar eventos desde la web.
- `@entropy/web` — `extension-bridge.ts` para delegar seeding, store chunks, get pubkey, etc.

---

## Dependencias nuevas

| Paquete | Dependencia | Versión | Uso |
|---|---|---|---|
| `@entropy/web` | `react-router-dom` | `^7.x` | Routing SPA: `/`, `/watch/:rootHash`, `/upload`, `/profile/:pubkey`, `/settings` |
| `@entropy/web` | `zustand` | `^5.x` | Estado global reactivo: identidad, relays, feed, reproductor |
| `@entropy/web` | `tailwindcss` | `^4.x` | Utility-first CSS framework |
| `@entropy/web` | `@tailwindcss/vite` | `^4.x` | Integración Tailwind con Vite |
| `@entropy/web` | `lucide-react` | `^0.460+` | Iconografía consistente (upload, play, user, settings, etc.) |
| `@entropy/web` (devDep) | `@types/dom-mediacapture-transform` | `*` | Tipos para MediaSource/SourceBuffer si no cubiertos por lib.dom |
| `@entropy/web` (devDep) | `vitest` | `^2.x` | Unit tests para hooks y stores |
| `@entropy/web` (devDep) | `@testing-library/react` | `^16.x` | Testing de componentes React |

> **Nota:** `nostr-tools` ya es dependencia de `@entropy/core`. La web consume firma/verificación a través del core.

---

## Entregables y Bloques de Implementación

### Bloque 1: Scaffold UI + Routing + Estado Global

#### 1.1 Dependencias y configuración

- Instalar `react-router-dom`, `zustand`, `tailwindcss`, `@tailwindcss/vite`, `lucide-react`.
- Configurar Tailwind v4: agregar `@import "tailwindcss"` en CSS principal.
- Actualizar `vite.config.ts` para incluir `@tailwindcss/vite` plugin.
- Migrar `main.tsx` para envolver `<App />` con `<BrowserRouter>`.

#### 1.2 `stores/entropy-store.ts` — Estado global con Zustand

**Estado central de la aplicación:**

```typescript
interface EntropyState {
  // Identidad
  pubkey: string | null;
  privkey: string | null;
  profile: NostrProfile | null;
  
  // Relays
  relayPool: RelayPool | null;
  relayUrls: string[];
  
  // Feed
  feedEvents: FeedItem[];
  feedLoading: boolean;
  
  // Reproductor activo
  activePlayback: {
    rootHash: string;
    chunkMap: EntropyChunkMap;
    downloadedChunks: Map<number, ArrayBuffer>;
    totalChunks: number;
    bufferedUpTo: number;
  } | null;
  
  // Acciones
  initRelays: (urls: string[]) => Promise<void>;
  setIdentity: (pubkey: string, privkey?: string) => void;
  loadFeed: () => Promise<void>;
  startPlayback: (rootHash: string, chunkMap: EntropyChunkMap) => void;
}
```

#### 1.3 `App.tsx` — Layout + Routes

Reemplazar el `App.tsx` actual (chunk map generator plano) por un layout de red social con routing:

```
<BrowserRouter>
  <AppLayout>                      ← Sidebar + TopBar + main content area
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/upload" element={<UploadPage />} />
      <Route path="/watch/:rootHash" element={<WatchPage />} />
      <Route path="/profile/:pubkey" element={<ProfilePage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  </AppLayout>
</BrowserRouter>
```

**Nota:** La funcionalidad actual de `App.tsx` (file picker + chunk map) se migra a `UploadPage`.

#### 1.4 Componentes de layout

| Componente | Descripción |
|---|---|
| `components/layout/AppLayout.tsx` | Grid principal: sidebar (fija), top bar, area central, panel derecho (opcional) |
| `components/layout/Sidebar.tsx` | Navegación: Home, Upload, Profile, Settings. Badge de estado extensión. Icono de créditos. |
| `components/layout/TopBar.tsx` | Barra superior: identidad activa (avatar + npub truncado), botón conectar extensión, status relay. |

---

### Bloque 2: Identidad Nostr + Perfiles + Grafo Social

#### 2.1 `hooks/useNostrIdentity.ts` — Conexión de identidad

Conecta la pubkey de la extensión (vía `getExtensionPublicKey()`) con el perfil Nostr.

```typescript
function useNostrIdentity(): {
  pubkey: string | null;
  profile: NostrProfile | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}
```

- Al montar, intenta `getExtensionPublicKey()` del bridge.
- Si exitoso, suscribirse a `kind:0` para obtener metadata del perfil.
- Almacenar en Zustand store.

#### 2.2 Tipos de perfil Nostr

```typescript
// types/nostr.ts
interface NostrProfile {
  pubkey: string;
  name?: string;
  displayName?: string;
  about?: string;
  picture?: string;      // URL del avatar
  banner?: string;       // URL del banner
  nip05?: string;        // NIP-05 identifier
  lud16?: string;        // Lightning address
}

interface ContactList {
  pubkey: string;
  follows: string[];     // Lista de pubkeys seguidas
  relays: Record<string, { read: boolean; write: boolean }>;
}
```

#### 2.3 `hooks/useNostrProfile.ts` — Resolver perfil por pubkey

```typescript
function useNostrProfile(pubkey: string | null): {
  profile: NostrProfile | null;
  isLoading: boolean;
}
```

- Suscribirse a `kind:0` con `authors: [pubkey]` vía `RelayPool.subscribe()`.
- Parsear `JSON.parse(event.content)` → `NostrProfile`.
- Cache local en un `Map<pubkey, NostrProfile>` dentro del store para evitar re-fetches.

#### 2.4 `hooks/useContactList.ts` — Lista de follows

```typescript
function useContactList(pubkey: string | null): {
  follows: string[];
  isLoading: boolean;
}
```

- Suscribirse a `kind:3` con `authors: [pubkey]`.
- Extraer tags `["p", "<pubkey>"]` del evento.

#### 2.5 Componentes de perfil

| Componente | Descripción |
|---|---|
| `components/profile/ProfileHeader.tsx` | Banner, avatar, nombre, about, npub, follows count |
| `components/profile/ProfileCard.tsx` | Tarjeta compacta para sidebar/feed (avatar + nombre + npub) |
| `components/profile/AvatarBadge.tsx` | Avatar circular con fallback (iniciales o identicon por pubkey) |
| `pages/ProfilePage.tsx` | Página de perfil: header + posts del usuario (kind:1 + kind:7001 filtrados por pubkey) |

---

### Bloque 3: Feed de Publicaciones

#### 3.1 `hooks/useNostrFeed.ts` — Suscripción al feed

```typescript
interface FeedItem {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  created_at: number;
  tags: string[][];
  // Parsed fields
  profile?: NostrProfile;         // Resuelto del cache
  chunkMap?: EntropyChunkMap;     // Solo para kind:7001
}

function useNostrFeed(options: {
  follows?: string[];
  kinds?: number[];
  limit?: number;
}): {
  items: FeedItem[];
  isLoading: boolean;
  loadMore: () => void;
}
```

**Lógica:**

1. Conectar `RelayPool` a los relays configurados (default: `wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.nostr.band`).
2. Suscribirse a `kinds: [1, 7001]` con `authors: follows` (si disponibles) o sin filtro de autor.
3. Para eventos `kind:7001`: parsear chunk map con `parseEntropyChunkMapEvent()`.
4. Para eventos `kind:1`: renderizar contenido de texto.
5. Ordenar por `created_at` descendente.
6. Deduplicar por `event.id`.
7. Paginación: usar `until` para cargar más eventos anteriores.

#### 3.2 Componentes de feed

| Componente | Descripción |
|---|---|
| `components/feed/Feed.tsx` | Contenedor del feed: scroll infinito, skeleton loading, empty state |
| `components/feed/PostCard.tsx` | Tarjeta de publicación: avatar del autor, timestamp, contenido, acciones |
| `components/feed/TextPost.tsx` | Renderizado de `kind:1`: texto plano con parsing de menciones/URLs |
| `components/feed/MediaPost.tsx` | Renderizado de `kind:7001`: thumbnail placeholder, título, tamaño, botón Play, badge "X chunks · X MB" |
| `components/feed/PostActions.tsx` | Barra de acciones: Play/Download, Seed, Share (copiar rootHash) |
| `pages/HomePage.tsx` | Feed principal: `useNostrFeed` + `useContactList` del usuario conectado |

#### 3.3 Relays por defecto

```typescript
// lib/constants.ts
export const DEFAULT_RELAY_URLS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band"
];
```

Se inicializan al arrancar la app. Configurable desde `SettingsPage`.

---

### Bloque 4: Upload con Progreso en Tiempo Real

#### 4.1 `pages/UploadPage.tsx` — Reemplaza el flujo actual de `App.tsx`

Modal/página de "Crear Publicación" con pipeline visual por etapas:

```
┌────────────────────────────────────────────────────┐
│  Crear Publicación                                  │
│                                                      │
│  [📎 Seleccionar archivo]    drag & drop zone       │
│                                                      │
│  Título: [________________________]                  │
│  Descripción: [__________________]                   │
│                                                      │
│  ── Pipeline de Publicación ──                       │
│                                                      │
│  1. ☑ Fragmentación    [████████████] 30/30 chunks  │
│  2. ☑ Hashing          [████████████] SHA-256 done  │
│  3. ◐ Almacenando      [██████░░░░░░] 18/30 chunks │
│  4. ○ Delegando seed   pendiente...                  │
│  5. ○ Publicando       pendiente...                  │
│                                                      │
│  [Cancelar]                          [Publicar ▶]   │
└────────────────────────────────────────────────────┘
```

#### 4.2 `hooks/useUploadPipeline.ts` — Orquestador de upload

```typescript
type UploadStage =
  | "idle"
  | "chunking"
  | "hashing"
  | "storing"
  | "delegating"
  | "publishing"
  | "done"
  | "error";

interface UploadProgress {
  stage: UploadStage;
  chunkingProgress: number;   // 0..1
  storingProgress: number;    // 0..1
  storedChunks: number;
  totalChunks: number;
  rootHash: string | null;
  error: string | null;
}

function useUploadPipeline(): {
  progress: UploadProgress;
  start: (file: File, title: string, description: string) => Promise<void>;
  cancel: () => void;
}
```

**Pipeline interno:**

1. **Chunking:** `chunkFile(arrayBuffer)` — ya existe en core.
2. **Storing:** Iterar chunks, `storeChunk()` vía bridge (con progreso por chunk).
3. **Delegating:** `delegateSeeding(payload)` vía bridge.
4. **Publishing:** Firmar evento `kind:7001` con `signEvent()` de identity + publicar a `RelayPool`.
5. Cada etapa actualiza `UploadProgress` reactivamente.

#### 4.3 Componentes de upload

| Componente | Descripción |
|---|---|
| `components/upload/UploadModal.tsx` | Modal contenedor con drag & drop zone, campos de texto, pipeline |
| `components/upload/DragDropZone.tsx` | Zona de arrastre con preview del archivo seleccionado |
| `components/upload/UploadPipeline.tsx` | Visualización de las 5 etapas con barras de progreso animadas |
| `components/upload/StageIndicator.tsx` | Indicador individual de etapa: icono, label, barra, porcentaje |

---

### Bloque 5: Reproductor de Video con MediaSource Extensions

Este es el bloque técnico más complejo. El reproductor debe alimentar un `<video>` tag con chunks que llegan por WebRTC desde múltiples peers, en el orden correcto.

#### 5.1 `@entropy/core` — `transport/chunk-downloader.ts` (nuevo)

Orquestador de descarga paralela desde múltiples peers.

```typescript
interface ChunkDownloadOptions {
  chunkMap: EntropyChunkMap;
  peerManager: PeerManager;
  signalingChannel: SignalingChannel;
  myPubkey: string;
  myPrivkey: string;
  relayPool: RelayPool;
  maxConcurrent?: number;         // default: 3
  onChunkReceived?: (index: number, data: ArrayBuffer) => void;
  onProgress?: (downloaded: number, total: number) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

class ChunkDownloader {
  constructor(options: ChunkDownloadOptions);
  
  /** Iniciar descarga. Descubre peers vía gatekeepers del chunk map, establece WebRTC, solicita chunks. */
  start(): void;
  
  /** Pausar descarga (no cierra conexiones, solo deja de solicitar). */
  pause(): void;
  
  /** Reanudar descarga pausada. */
  resume(): void;
  
  /** Cancelar y limpiar todas las conexiones. */
  cancel(): void;
  
  /** Obtener un chunk ya descargado por índice (para el reproductor). */
  getChunk(index: number): ArrayBuffer | null;
  
  /** ¿Ya se descargó este chunk? */
  hasChunk(index: number): boolean;
  
  /** Número de chunks descargados. */
  get downloadedCount(): number;
}
```

**Estrategia de descarga paralela:**

1. Extraer `gatekeepers` del `EntropyChunkMap` (pubkeys de seeders conocidos).
2. Para cada gatekeeper, enviar señalización WebRTC (offer vía Nostr `kind:20001`).
3. Al establecer DataChannel, enviar `CHUNK_REQUEST` para chunks pendientes.
4. Repartir chunks entre peers disponibles (round-robin o least-loaded).
5. Verificar `SHA-256` de cada chunk recibido contra el hash del chunk map.
6. Emitir `onChunkReceived(index, data)` conforme llega cada chunk verificado.
7. Re-intentar chunks fallidos con otro peer.

#### 5.2 `hooks/useChunkDownload.ts` — Hook React para descarga

```typescript
function useChunkDownload(chunkMap: EntropyChunkMap | null): {
  status: "idle" | "connecting" | "downloading" | "complete" | "error";
  progress: number;               // 0..1
  downloadedChunks: number;
  totalChunks: number;
  getChunk: (index: number) => ArrayBuffer | null;
  hasChunk: (index: number) => boolean;
  start: () => void;
  pause: () => void;
  cancel: () => void;
}
```

Internamente instancia `ChunkDownloader` del core, conecta callbacks a setState.

#### 5.3 `hooks/useMediaSource.ts` — Hook para MSE playback

```typescript
function useMediaSource(options: {
  mimeType: string;                         // e.g. "video/mp4"
  videoRef: React.RefObject<HTMLVideoElement>;
}): {
  isReady: boolean;
  appendChunk: (index: number, data: ArrayBuffer) => void;
  bufferedRanges: TimeRanges | null;
  error: string | null;
}
```

**Lógica MSE:**

1. Crear `MediaSource`, attach `URL.createObjectURL(mediaSource)` al `<video>`.
2. Al `sourceopen`, crear `SourceBuffer` con el mimeType.
3. `appendChunk(index, data)`: encolar el `ArrayBuffer` en el SourceBuffer **en orden**.
4. Mantener cola interna: si llega chunk 3 antes que chunk 2, esperar.
5. Manejar `updateend` del SourceBuffer para encadenar appends.
6. Gestionar buffer limits: `SourceBuffer.remove()` para chunks ya reproducidos si la memoria es limitada.

**Requisito de formato:** Para que MSE funcione, los chunks deben estar alineados con los keyframes del video. En Phase 4, se asume que el uploader sube archivos MP4 fragmented (fMP4) o que el primer chunk contiene el `moov` atom. Formateo avanzado (transmuxing) se evalúa en Phase 5.

#### 5.4 Componentes del reproductor

| Componente | Descripción |
|---|---|
| `components/player/VideoPlayer.tsx` | Componente principal: `<video>` tag + overlay de controles custom + indicador de buffering |
| `components/player/PlayerControls.tsx` | Play/pause, seek bar, volumen, fullscreen, badge de peers conectados |
| `components/player/BufferIndicator.tsx` | Barra visual mostrando qué chunks están descargados (mapa de calor) |
| `components/player/PeerOverlay.tsx` | Mini-panel flotante: peers activos, velocidad de descarga, chunks en vuelo |
| `pages/WatchPage.tsx` | Página de reproducción: carga chunk map de relay por `rootHash`, inicia descarga + MSE playback |

#### 5.5 `pages/WatchPage.tsx` — Flujo de reproducción

```
URL: /watch/:rootHash
        │
        ▼
  1. Suscribirse a kind:7001 con tag ["x-hash", rootHash]
        │
        ▼
  2. Parsear EntropyChunkMap del evento
        │
        ▼
  3. Iniciar ChunkDownloader (descubre peers, establece WebRTC)
        │
        ▼
  4. Conforme llegan chunks verificados:
     ├─ appendChunk() al MediaSource (reproducción progresiva)
     ├─ Opcionalmente almacenar en IndexedDB local (re-seeding)
     └─ Actualizar barra de buffer visual
        │
        ▼
  5. <video> reproduce desde el primer chunk
     (streaming comienza con ~2-3 chunks buffered)
```

---

### Bloque 6: Settings, Quota Manager + Evicción LRU

#### 6.1 `pages/SettingsPage.tsx` — Panel de configuración

| Sección | Funcionalidad |
|---|---|
| **Identidad** | Pubkey conectada (de extensión), npub display, botón copiar |
| **Relays** | Lista de relay URLs, agregar/remover, indicador de estado por relay |
| **Almacenamiento** | Barra de uso vs cuota, botón "Limpiar caché", slider para ajustar cuota máxima |
| **Extensión** | Estado de conexión con extensión, seeding toggle, link al dashboard de extensión |

#### 6.2 `hooks/useQuotaManager.ts` — Cuota y evicción desde la web

```typescript
function useQuotaManager(): {
  usedBytes: number;
  quotaBytes: number;
  usagePercent: number;
  isOverQuota: boolean;
  evictLRU: () => Promise<number>;    // Retorna bytes liberados
  setQuota: (bytes: number) => void;
}
```

- Usa `navigator.storage.estimate()` para estimar espacio real.
- Delega evicción al `QuotaManagerIdb` de `@entropy/core` (ya existente).
- La web puede cachear chunks temporalmente en su propio IndexedDB (`createIndexedDbChunkStore()`) para re-seeding y reproducción offline.

#### 6.3 Notificaciones en la UI

| Notificación | Trigger | Componente |
|---|---|---|
| "Extensión no detectada" | `getExtensionPublicKey()` timeout | `TopBar` badge |
| "Almacenamiento al límite" | `usagePercent > 90%` | Toast flotante |
| "Sin créditos disponibles" | `balance <= 0` | Toast + badge en Sidebar |
| "Nuevo chunk descargado" | `onChunkReceived` callback | Indicador sutil en reproductor |

Componente reutilizable: `components/ui/Toast.tsx` (cola de notificaciones con auto-dismiss).

---

## Orden de implementación

```
┌─────────────────────────────────────────────────────────────────┐
│  Bloque 1: Scaffold UI + Routing + Estado                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ○ 1.1  Instalar deps (router, zustand, tailwind, lucide)      │
│  ○ 1.2  Configurar Tailwind v4 + vite plugin                   │
│  ○ 1.3  entropy-store.ts (Zustand)                              │
│  ○ 1.4  AppLayout + Sidebar + TopBar                            │
│  ○ 1.5  Routing: 5 rutas principales                            │
│  ○ 1.6  Migrar lógica actual de App.tsx → UploadPage            │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Bloque 2: Identidad + Perfiles Nostr                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ○ 2.1  types/nostr.ts (NostrProfile, ContactList)              │
│  ○ 2.2  useNostrIdentity hook (conectar con extensión)          │
│  ○ 2.3  useNostrProfile hook (kind:0 resolver)                  │
│  ○ 2.4  useContactList hook (kind:3 follows)                    │
│  ○ 2.5  ProfileHeader, ProfileCard, AvatarBadge                 │
│  ○ 2.6  ProfilePage                                             │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Bloque 3: Feed de publicaciones                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ○ 3.1  lib/constants.ts (default relays, kind constants)       │
│  ○ 3.2  useNostrFeed hook (kind:1 + kind:7001)                  │
│  ○ 3.3  Feed, PostCard, TextPost, MediaPost, PostActions        │
│  ○ 3.4  HomePage (feed principal)                               │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Bloque 4: Upload mejorado                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ○ 4.1  useUploadPipeline hook (5 etapas con progreso)          │
│  ○ 4.2  DragDropZone, UploadPipeline, StageIndicator            │
│  ○ 4.3  UploadModal / UploadPage completa                       │
│  ○ 4.4  Firma y publicación kind:7001 a relays                  │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Bloque 5: Reproductor + Descarga paralela                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ○ 5.1  core: chunk-downloader.ts (descarga multi-peer)         │
│  ○ 5.2  useChunkDownload hook                                   │
│  ○ 5.3  useMediaSource hook (MSE streaming)                     │
│  ○ 5.4  VideoPlayer, PlayerControls, BufferIndicator            │
│  ○ 5.5  WatchPage (/watch/:rootHash)                            │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Bloque 6: Settings + Quota + Polish                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ○ 6.1  SettingsPage (relays, identity, storage)                │
│  ○ 6.2  useQuotaManager hook (evicción LRU)                    │
│  ○ 6.3  Toast notifications (extensión, créditos, storage)      │
│  ○ 6.4  Responsive polish (mobile breakpoints)                  │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Bloque 7: Tests + Verificación                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ○ 7.1  Tests unitarios: useNostrFeed, useUploadPipeline,       │
│       useMediaSource, useChunkDownload, entropy-store           │
│  ○ 7.2  Tests unitarios: chunk-downloader.ts (core)             │
│  ○ 7.3  Typecheck + build de los 3 paquetes                     │
│  ○ 7.4  Test E2E manual: upload → feed → play vía multi-peer    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Archivos nuevos

| Paquete | Archivo | Descripción |
|---|---|---|
| core | `transport/chunk-downloader.ts` | Orquestador de descarga paralela multi-peer |
| core | `__tests__/chunk-downloader.test.ts` | Tests de descarga paralela |
| web | `src/stores/entropy-store.ts` | Estado global Zustand |
| web | `src/types/nostr.ts` | `NostrProfile`, `ContactList`, `FeedItem` |
| web | `src/lib/constants.ts` | Relays default, configuración de la app |
| web | `src/components/layout/AppLayout.tsx` | Layout grid principal |
| web | `src/components/layout/Sidebar.tsx` | Barra lateral de navegación |
| web | `src/components/layout/TopBar.tsx` | Barra superior: identidad, relays |
| web | `src/components/feed/Feed.tsx` | Contenedor de feed con scroll infinito |
| web | `src/components/feed/PostCard.tsx` | Tarjeta de publicación genérica |
| web | `src/components/feed/TextPost.tsx` | Renderizado de kind:1 |
| web | `src/components/feed/MediaPost.tsx` | Renderizado de kind:7001 |
| web | `src/components/feed/PostActions.tsx` | Botones de acción (play, seed, share) |
| web | `src/components/profile/ProfileHeader.tsx` | Cabecera de perfil con banner/avatar |
| web | `src/components/profile/ProfileCard.tsx` | Tarjeta compacta de perfil |
| web | `src/components/profile/AvatarBadge.tsx` | Avatar circular con fallback |
| web | `src/components/upload/UploadModal.tsx` | Modal de creación de post |
| web | `src/components/upload/DragDropZone.tsx` | Zona de drag & drop |
| web | `src/components/upload/UploadPipeline.tsx` | Visualización de pipeline |
| web | `src/components/upload/StageIndicator.tsx` | Indicador de etapa individual |
| web | `src/components/player/VideoPlayer.tsx` | Reproductor MSE principal |
| web | `src/components/player/PlayerControls.tsx` | Controles custom de video |
| web | `src/components/player/BufferIndicator.tsx` | Mapa de chunks descargados |
| web | `src/components/player/PeerOverlay.tsx` | Overlay de peers activos |
| web | `src/components/ui/Toast.tsx` | Sistema de notificaciones toast |
| web | `src/hooks/useNostrIdentity.ts` | Conexión identidad extensión ↔ Nostr |
| web | `src/hooks/useNostrProfile.ts` | Resolver kind:0 metadata |
| web | `src/hooks/useContactList.ts` | Resolver kind:3 follows |
| web | `src/hooks/useNostrFeed.ts` | Suscripción feed kind:1 + kind:7001 |
| web | `src/hooks/useUploadPipeline.ts` | Pipeline de upload con progreso |
| web | `src/hooks/useChunkDownload.ts` | Descarga paralela de chunks |
| web | `src/hooks/useMediaSource.ts` | MSE playback management |
| web | `src/hooks/useQuotaManager.ts` | Cuota y evicción LRU |
| web | `src/pages/HomePage.tsx` | Feed principal |
| web | `src/pages/UploadPage.tsx` | Página/modal de upload (migra lógica de App.tsx) |
| web | `src/pages/WatchPage.tsx` | Reproducción de contenido por rootHash |
| web | `src/pages/ProfilePage.tsx` | Perfil de usuario Nostr |
| web | `src/pages/SettingsPage.tsx` | Configuración (relays, storage, identity) |
| web | `src/__tests__/useNostrFeed.test.ts` | Tests del hook de feed |
| web | `src/__tests__/useUploadPipeline.test.ts` | Tests del pipeline de upload |
| web | `src/__tests__/useMediaSource.test.ts` | Tests del hook MSE |
| web | `src/__tests__/useChunkDownload.test.ts` | Tests del hook de descarga |

## Archivos modificados

| Paquete | Archivo | Cambio |
|---|---|---|
| core | `src/index.ts` | Exportar `ChunkDownloader` y tipos asociados |
| web | `package.json` | Nuevas dependencias (router, zustand, tailwind, lucide, vitest, testing-library) |
| web | `vite.config.ts` | Plugin Tailwind |
| web | `src/main.tsx` | Envolver con `BrowserRouter`, importar CSS Tailwind |
| web | `src/App.tsx` | Reemplazar por layout + routing (migrar lógica actual a UploadPage) |
| web | `src/styles.css` | Reemplazar por `@import "tailwindcss"` + custom utilities |
| web | `index.html` | Actualizar `<title>`, meta tags |
| web | `tsconfig.json` | Paths alias si necesario (`@/` → `src/`) |

---

## Verificación

### Automatizada

```bash
pnpm --filter @entropy/core test          # Tests core (existentes + chunk-downloader)
pnpm --filter @entropy/web test           # Tests nuevos (hooks + stores)
pnpm typecheck                             # 3/3 paquetes sin errores
pnpm --filter @entropy/web build          # Build exitoso
pnpm --filter @entropy/extension build    # Sin regresiones
```

### Manual

1. **Abrir Web App** → verificar layout de red social con sidebar, top bar, feed central.
2. **Feed**: ver eventos `kind:1` (texto) y `kind:7001` (multimedia) mezclados, ordenados cronológicamente.
3. **Perfiles**: hacer clic en un avatar → ver página de perfil con nombre, about, posts del usuario.
4. **Upload**: seleccionar video → ver pipeline de 5 etapas con progreso real → post aparece en feed.
5. **Watch**: hacer clic en un post multimedia → `/watch/:rootHash` → video comienza a reproducirse progresivamente antes de terminar la descarga.
6. **Multi-peer**: desde un segundo navegador, descargar el mismo contenido → verificar que chunks se piden a múltiples peers.
7. **Settings**: cambiar relays, ver cuota de storage, toggle seeding.
8. **Responsive**: verificar UI en viewport mobile (375px) y desktop (1440px).

### Test E2E completo (objetivo)

```
Browser A (web app)                    Browser B (extensión seeding)
      │                                        │
      ├─ Upload video.mp4                      │
      ├─ Pipeline: chunk → hash → store →      │
      │   delegate → publish kind:7001         │
      ├─ STORE_CHUNK × N  ───────────────────►├─ Chunks en IDB
      ├─ DELEGATE_SEEDING ───────────────────►├─ Escuchar señalización
      │                                        │
Browser C (web app, otro usuario)              │
      │                                        │
      ├─ Abrir feed → ver kind:7001 post       │
      ├─ Click "Play" → /watch/:rootHash       │
      ├─ ChunkDownloader descubre peers        │
      ├─ WebRTC offer vía kind:20001 ────────►├─ Recibir offer
      │                                        ├─ Generar answer
      ├◄─ ICE exchange ──────────────────────►├
      ├◄─ DataChannel established ───────────►├
      ├─ CHUNK_REQUEST ─────────────────────►├─ Verificar crédito
      ├◄─ CHUNK_DATA ◄──────────────────────├─ Enviar chunk
      ├─ Verificar SHA-256 ✓                   │
      ├─ appendChunk() → <video> reproduce     │
      ├─ (siguiente chunk en paralelo...)      │
      │                                        │
      ├─ Video se reproduce progresivamente    │
      │   sin esperar descarga completa        │
      ▼                                        ▼
```

---

## Riesgos y decisiones abiertas

> [!IMPORTANT]
> **MSE y codecs:** `MediaSource.isTypeSupported()` varía por navegador. MP4 con codecs H.264/AAC es el más soportado. Si el usuario sube un MKV o WebM con codecs no soportados, el SourceBuffer fallará. **Mitigación Phase 4:** Validar `isTypeSupported(mimeType)` antes de iniciar playback. **Phase 5:** Integrar transmuxing client-side (e.g., `mux.js` o `mp4box.js`) para reformatear en fMP4.

> [!IMPORTANT]
> **Chunk alignment con keyframes:** Para streaming fluido, los chunks deben alinearse con IDR frames (keyframes) del video. En Phase 4, se asume archivos fMP4 pre-fragmentados o que el tamaño de chunk (5MB) es suficiente para contener al menos un keyframe. **Phase 5:** Pre-procesar en upload: detectar keyframes y ajustar cortes de chunk.

> [!WARNING]
> **Descubrimiento de peers sin gatekeepers:** Si el chunk map no incluye `gatekeepers` (pubkeys de seeders), el downloader no sabe a quién pedir. **Mitigación:** Usar la pubkey del autor del evento kind:7001 como gatekeeper implícito. Alternativamente, publicar un evento efímero "seeder announcement" cuando un peer acepta seeding.

> [!WARNING]
> **Rendimiento de firma en la web:** Firmar el evento kind:7001 desde la web requiere la privkey. Si la privkey solo vive en la extensión, se necesita un nuevo mensaje bridge `SIGN_EVENT` para delegar la firma al SW. **Decisión:** Evaluar si agregar `SIGN_EVENT` al bridge o permitir que la web tenga una copia temporal de la privkey para firmar.

> [!NOTE]
> **React 18 vs 19:** El proyecto actualmente usa React 18.3.x. Los hooks y patterns de Phase 4 son compatibles con ambas versiones. Migrar a React 19 se evalúa en Phase 5 si se necesita React Server Components o `use()`.

> [!NOTE]
> **Tailwind v4:** Usa la nueva arquitectura basada en Rust (Lightning CSS). No requiere `tailwind.config.ts` ni `postcss.config.js` — la configuración se hace directamente en CSS con `@theme`. Esto simplifica el setup vs Tailwind v3.

---

## Criterios de Aceptación (DoD)

- [ ] El usuario puede abrir la Web App, ver perfiles Nostr resolviendo avatares y un feed de publicaciones con contenido texto y multimedia.
- [ ] El usuario puede subir un video y ver su progreso real de chunking/hashing/almacenamiento/publicación en un pipeline visual de 5 etapas.
- [ ] Al hacer clic en un video del feed, empieza a reproducirse progresivamente (streaming MSE) antes de que se descargue el 100% del archivo.
- [ ] Múltiples peers pueden servir los chunks del mismo video en paralelo al visualizador.
- [ ] Cuando la base de datos IndexedDB llega al límite de cuota configurado, elimina automáticamente los chunks menos usados (LRU) para hacer espacio.
- [ ] La UI es responsiva (mobile y desktop) con diseño moderno usando Tailwind CSS.
- [ ] Typecheck, build y tests pasan sin errores en los 3 paquetes.
