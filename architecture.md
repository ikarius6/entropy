# Arquitectura Técnica — Entropy Multimedia Layer

> Documento derivado de `project.md`. Define la estructura de software, los componentes, las tecnologías y los flujos de datos necesarios para implementar Entropy como una **aplicación web** y una **extensión de navegador** que cooperan para formar una red P2P de contenido multimedia sobre Nostr.

---

## 1. Vista General del Sistema

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USUARIO (Navegador)                         │
│                                                                     │
│  ┌──────────────────────┐     ┌──────────────────────────────────┐  │
│  │   Extensión Entropy  │◄───►│        Web App Entropy           │  │
│  │  (Manifest V3)       │     │     (SPA - React + Vite)         │  │
│  │                      │     │                                  │  │
│  │ • Service Worker     │     │ • Feed Social (Nostr)            │  │
│  │ • Background Seeding │     │ • Reproductor Multimedia         │  │
│  │ • Dashboard de Nodo  │     │ • Uploader / Chunker             │  │
│  │ • Gestión de Crédito │     │ • Visor de Perfil / Identidad    │  │
│  └──────────┬───────────┘     └───────────────┬──────────────────┘  │
│             │                                 │                     │
│             └────────────┬────────────────────┘                     │
│                          ▼                                          │
│              ┌───────────────────────┐                              │
│              │    @entropy/core      │                              │
│              │   (Librería Shared)   │                              │
│              │                       │                              │
│              │ • Chunking Engine     │                              │
│              │ • Hash / Merkle Tree  │                              │
│              │ • WebRTC Manager      │                              │
│              │ • Nostr Protocol      │                              │
│              │ • Credit Ledger       │                              │
│              │ • Storage (IndexedDB) │                              │
│              └───────────┬───────────┘                              │
│                          │                                          │
└──────────────────────────┼──────────────────────────────────────────┘
                           │
            ┌──────────────┼──────────────────┐
            ▼              ▼                  ▼
     ┌────────────┐ ┌────────────┐   ┌──────────────┐
     │ Nostr      │ │ WebRTC     │   │ STUN / TURN  │
     │ Relays     │ │ Peers      │   │ Servers      │
     │ (Metadata) │ │ (Data P2P) │   │ (Señalización)│
     └────────────┘ └────────────┘   └──────────────┘
```

El sistema se compone de **tres paquetes** dentro de un **monorepo**:

| Paquete | Rol |
|---|---|
| `@entropy/core` | Lógica de negocio compartida: chunking, hashing, WebRTC, Nostr, créditos, almacenamiento. |
| `@entropy/web` | Aplicación web SPA — interfaz de red social, feed, reproductor, upload. |
| `@entropy/extension` | Extensión de navegador Manifest V3 — seeding persistente, dashboard de nodo. |

---

## 2. Estructura del Monorepo

```
entropy/
├── package.json              # Workspace root (pnpm workspaces)
├── pnpm-workspace.yaml
├── turbo.json                # Turborepo para builds paralelos
├── tsconfig.base.json        # Config TS compartida
│
├── packages/
│   └── core/                 # @entropy/core
│       ├── src/
│       │   ├── chunking/
│       │   │   ├── chunker.ts          # Fragmentación de archivos en chunks de 5MB (target)
│       │   │   ├── keyframe-aligner.ts # Chunking con alineación a keyframes (mp4box, video/mp4)
│       │   │   ├── assembler.ts        # Reensamblaje de chunks a archivo original
│       │   │   └── merkle.ts           # Árbol Merkle para hash raíz + verificación
│       │   ├── transport/
│       │   │   ├── peer-manager.ts     # Pool de conexiones WebRTC activas
│       │   │   ├── signaling.ts        # Señalización vía Nostr ephemeral events
│       │   │   ├── chunk-transfer.ts   # Protocolo binario: CHUNK_REQUEST/DATA/ERROR + CUSTODY_CHALLENGE/PROOF
│       │   │   ├── chunk-downloader.ts # Descarga multi-peer + reputación + seeder discovery
│       │   │   ├── transmuxer.ts       # Transmuxing on-the-fly a fMP4 para MSE (mp4box)
│       │   │   └── nat-traversal.ts    # Configuración STUN/TURN
│       │   ├── credits/
│       │   │   ├── ledger.ts           # Registro local de créditos (ratio upload/download)
│       │   │   ├── proof-of-upstream.ts # Generación y verificación de pruebas firmadas
│       │   │   ├── cold-storage.ts     # Lógica de asignación de custodia de chunks fríos
│       │   │   ├── peer-reputation.ts  # PeerReputationStore interface + banning policy
│       │   │   └── credit-gating.ts    # Gate: verificar crédito antes de servir chunks
│       │   ├── storage/
│       │   │   ├── chunk-store.ts      # CRUD de chunks en IndexedDB
│       │   │   ├── db.ts              # Schema y migraciones de Dexie.js (tabla peers)
│       │   │   ├── quota-manager.ts    # Control de cuota de disco del usuario
│       │   │   ├── indexeddb-chunk-store.ts  # Implementación IDB de ChunkStore
│       │   │   ├── quota-manager-idb.ts      # Implementación IDB de QuotaManager
│       │   │   ├── quota-aware-store.ts      # ChunkStore con control de cuota
│       │   │   └── peer-reputation-idb.ts    # Implementación IDB de PeerReputationStore
│       │   ├── nostr/
│       │   │   ├── client.ts           # Conexión y suscripción a relays
│       │   │   ├── events.ts           # Creación/parseo de eventos (kind:7001 y estándar)
│       │   │   ├── identity.ts         # Gestión de keypairs (nsec/npub)
│       │   │   ├── nip-entropy.ts      # Definición del NIP custom para Chunk Maps
│       │   │   └── seeder-announcement.ts    # Build/parse kind:20002
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── apps/
│   ├── web/                  # @entropy/web
│   │   ├── public/
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── feed/               # Feed de publicaciones (notas, multimedia)
│   │   │   │   ├── player/             # Reproductor de video/audio (MediaSource API)
│   │   │   │   ├── uploader/           # UI de carga + progreso de chunking
│   │   │   │   ├── profile/            # Perfil Nostr del usuario
│   │   │   │   ├── NodeStatusPanel.tsx # Estado de nodo delegado
│   │   │   │   ├── CreditPanel.tsx     # Panel de créditos
│   │   │   │   ├── ColdStoragePanel.tsx # Panel de cold storage assignments
│   │   │   │   ├── NodeMetricsPanel.tsx # Panel de métricas del nodo
│   │   │   │   └── ui/                 # Componentes base (shadcn/ui)
│   │   │   ├── hooks/
│   │   │   │   ├── useNostr.ts         # Suscripción a eventos Nostr
│   │   │   │   ├── usePeerSwarm.ts     # Estado del swarm WebRTC activo
│   │   │   │   ├── useChunkDownload.ts # Orquestación de descarga de chunks
│   │   │   │   ├── useExtensionNodeStatus.ts # Estado live del nodo delegado
│   │   │   │   ├── useCredits.ts       # Estado de créditos del usuario
│   │   │   │   ├── useColdStorage.ts   # Cold storage assignments desde extensión
│   │   │   │   └── useNodeMetrics.ts   # Métricas del nodo con auto-refresh 30s
│   │   │   ├── stores/
│   │   │   │   └── entropy-store.ts    # Estado global (Zustand)
│   │   │   ├── lib/
│   │   │   │   └── extension-bridge.ts # Comunicación con la extensión vía postMessage
│   │   │   ├── pages/
│   │   │   │   ├── Home.tsx
│   │   │   │   ├── Watch.tsx           # Reproducción de contenido específico
│   │   │   │   ├── Upload.tsx
│   │   │   │   └── Settings.tsx
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── postcss.config.js
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── extension/            # @entropy/extension
│       ├── src/
│       │   ├── background/
│       │   │   ├── service-worker.ts   # Service Worker principal (Manifest V3)
│       │   │   ├── seeder.ts           # Lógica de seeding persistente en background
│       │   │   ├── credit-ledger.ts    # Ledger de créditos persistido en chrome.storage
│       │   │   ├── scheduler.ts        # Planificador: prune + cold storage + integrity + health checks
│       │   │   ├── cold-storage-manager.ts  # Ciclos de cold storage real
│       │   │   ├── metrics.ts          # MetricsCollector + health checks
│       │   │   ├── chunk-server.ts     # Sirve chunks + reputación + rate limiting + custody
│       │   │   ├── peer-fetch.ts       # Fetch de chunks + reputación + SHA-256
│       │   │   ├── relay-manager.ts    # Gestión de conexiones a relays
│       │   │   ├── signaling-listener.ts  # Escucha offers + publica seeder announcements
│       │   │   ├── chunk-ingest.ts     # Persistencia de chunks binarios
│       │   │   └── identity-store.ts   # Keypair persistido en chrome.storage
│       │   ├── popup/
│       │   │   ├── Popup.tsx           # Dashboard compacto de nodo
│       │   │   └── main.tsx
│       │   ├── dashboard/
│       │   │   ├── index.html          # Dashboard completo (nueva pestaña) con secciones peers/cold/metrics
│       │   │   ├── main.ts             # Lógica: status, créditos, inventario, peers, cold storage, métricas
│       │   │   └── styles.css          # Estilos del dashboard
│       │   ├── content/
│       │   │   └── content-script.ts   # Puente de comunicación con @entropy/web
│       │   └── shared/
│       │       ├── messaging.ts         # Tipos y helpers para chrome.runtime messaging
│       │       └── status-client.ts     # Cliente: status + créditos + cold storage + métricas
│       ├── manifest.json               # Manifest V3
│       ├── vite.config.ts              # Build multi-entry (background, popup, dashboard, content)
│       ├── package.json
│       └── tsconfig.json
│
├── project.md
└── architecture.md
```

---

## 3. Stack Tecnológico

| Capa | Tecnología | Justificación |
|---|---|---|
| **Lenguaje** | TypeScript 5.x | Tipado estricto en toda la base de código; compartido entre web y extensión. |
| **Monorepo** | pnpm workspaces + Turborepo | Builds rápidos e incrementales; dependencias deduplicadas. |
| **Web Framework** | React 19 + Vite | SPA ligera, HMR rápido, tree-shaking eficiente. |
| **Estilos** | TailwindCSS 4 + shadcn/ui | UI moderna y accesible con componentes reutilizables. |
| **Estado** | Zustand | Minimal, sin boilerplate; ideal para estado P2P reactivo. |
| **Routing** | React Router 7 | Navegación SPA estándar. |
| **Nostr** | nostr-tools | Librería de referencia: creación de eventos, firma, suscripciones. |
| **WebRTC** | simple-peer | Abstracción limpia sobre RTCPeerConnection nativa. |
| **Hashing** | Web Crypto API (SHA-256) | Nativo del navegador, rápido, sin dependencias. |
| **Almacenamiento** | Dexie.js (IndexedDB) | API ergonómica sobre IndexedDB con soporte de migraciones. |
| **Media Playback** | MediaSource Extensions (MSE) | Streaming progresivo: alimentar el reproductor chunk por chunk. |
| **Transmuxing** | mp4box 2.3.0 | Detección de keyframes (stss), generación de fMP4 init segments, remuxing para compatibilidad MSE. |
| **Extensión** | Manifest V3 + Chrome APIs | Estándar actual; Service Worker para background. Compatible con Firefox vía polyfill. |
| **Build Extensión** | Vite + CRXJS o vite-plugin-web-extension | Build multi-entry optimizado para extensiones. |
| **Testing** | Vitest + Playwright | Unit tests para core; E2E para flujos web. |
| **Linting** | ESLint + Prettier | Consistencia de código. |

---

## 4. Flujos de Datos Principales

### 4.1 Subida de Contenido (Upload)

```
Usuario selecciona archivo
        │
        ▼
┌─────────────────────┐
│  Chunking Engine     │  Divide en fragmentos de 5MB
│  (Web Worker)        │  usando File.slice()
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Merkle Tree Hash   │  SHA-256 por chunk → Merkle root
└─────────┬───────────┘
          │
          ├──────────────────────────┐
          ▼                          ▼
┌──────────────────┐     ┌────────────────────────┐
│  IndexedDB       │     │  Nostr Event (kind:7001)│
│  Almacena chunks │     │                        │
│  localmente      │     │  {                     │
└──────────────────┘     │    "kind": 7001,       │
                         │    "content": "",      │
                         │    "tags": [           │
                         │      ["x-hash", "<root_hash>"],
                         │      ["chunk", "<hash_0>", "0"],
                         │      ["chunk", "<hash_1>", "1"],
                         │      ...                │
                         │      ["size", "524288000"],
                         │      ["mime", "video/mp4"],
                         │      ["title", "Mi Video"]
                         │    ]                   │
                         │  }                     │
                         └────────────┬───────────┘
                                      │
                                      ▼
                              Publicado a Nostr Relays
                                      │
                                      ▼
                         Usuario comienza a hacer SEED
                         (WebRTC acepta conexiones)
```

### 4.2 Descarga y Reproducción (Download + Streaming)

```
Feed muestra publicación con kind:7001
        │
        ▼
┌─────────────────────────┐
│  Parseo del Chunk Map   │  Extraer lista de hashes, tamaño, mime
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  Descubrimiento de Peers│  Buscar "gatekeepers" activos
│  (Nostr + DHT local)    │  en el evento o vía señalización
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  WebRTC Handshake       │  Señalización vía Nostr ephemeral
│  (múltiples peers)      │  events (kind:20000-29999)
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  Descarga Paralela      │  Solicitar diferentes chunks
│  de Chunks              │  a diferentes peers simultáneamente
└─────────┬───────────────┘
          │
          ├─── Verificar SHA-256 de cada chunk recibido
          │    ✗ Hash inválido → marcar peer como malicioso
          │    ✓ Hash válido  → almacenar en IndexedDB
          │
          ▼
┌─────────────────────────┐
│  MediaSource Extensions │  Alimentar SourceBuffer con
│  (Streaming Progresivo) │  chunks verificados en orden
└─────────┬───────────────┘
          │
          ▼
   <video> reproduce contenido
   mientras se descargan más chunks
```

### 4.3 Comunicación Web App ↔ Extensión

```
┌──────────────────┐                    ┌──────────────────────┐
│   @entropy/web   │                    │  @entropy/extension  │
│                  │                    │                      │
│  extension-      │   window.          │   content-script.ts  │
│  bridge.ts  ─────┼──►postMessage()───►│         │            │
│                  │                    │         ▼            │
│                  │   chrome.runtime.  │   chrome.runtime     │
│                  │   ◄─sendMessage()──│   .sendMessage()     │
│                  │                    │         │            │
│                  │                    │         ▼            │
│                  │                    │   service-worker.ts  │
│                  │                    │   (Background)       │
└──────────────────┘                    └──────────────────────┘

Mensajes clave:
─────────────────
WEB → EXT:  "DELEGATE_SEEDING"            → Pasar chunks activos al background
WEB → EXT:  "GET_NODE_STATUS"             → Solicitar estadísticas del nodo
WEB → EXT:  "GET_CREDIT_SUMMARY"          → Solicitar resumen de créditos
WEB → EXT:  "GET_NODE_SETTINGS"           → Solicitar configuración (relays, seeding toggle)
WEB → EXT:  "ADD_RELAY" / "REMOVE_RELAY" → Gestionar relays
WEB → EXT:  "SET_SEEDING_ACTIVE"          → Activar/desactivar seeding
WEB → EXT:  "GET_COLD_STORAGE_ASSIGNMENTS" → Listar asignaciones de cold storage
WEB → EXT:  "RELEASE_COLD_ASSIGNMENT"     → Liberar asignación individual
WEB → EXT:  "GET_NODE_METRICS"            → Solicitar métricas operacionales
WEB → EXT:  "HEARTBEAT"                   → Mantener viva la conexión
EXT → WEB:  "NODE_STATUS_UPDATE"          → Push de estado de nodo en tiempo real
EXT → WEB:  "CREDIT_UPDATE"               → Push de resumen de créditos en tiempo real

Todas las solicitudes y respuestas usan `requestId` para correlación robusta.
```

---

## 5. Modelo de Datos (IndexedDB — Dexie.js)

```typescript
// packages/core/src/storage/db.ts

interface ChunkRecord {
  hash: string;           // SHA-256 del chunk (PK)
  data: ArrayBuffer;      // Contenido binario (≤5MB, fragmentado en 64KB para transporte WebRTC)
  rootHash: string;       // Hash raíz del archivo al que pertenece
  index: number;          // Posición en la secuencia
  createdAt: number;      // Timestamp
  lastAccessed: number;   // Para política de evicción LRU
  pinned: boolean;        // Si el usuario eligió retener manualmente
}

interface ContentRecord {
  rootHash: string;       // PK — Hash raíz del archivo completo
  title: string;
  mimeType: string;
  totalSize: number;
  totalChunks: number;
  chunkHashes: string[];  // Lista ordenada de hashes
  nostrEventId: string;   // ID del evento kind:7001
  authorPubkey: string;
  createdAt: number;
  isComplete: boolean;    // Todos los chunks descargados
}

interface CreditRecord {
  id: string;             // Auto-increment
  peerPubkey: string;     // Pubkey del peer involucrado
  direction: 'up' | 'down';
  bytes: number;
  chunkHash: string;
  signature: string;      // Firma del receptor (Proof of Upstream)
  timestamp: number;
}

interface PeerReputation {
  pubkey: string;         // PK
  successfulTransfers: number;
  failedVerifications: number;  // Chunks con hash inválido
  totalBytesExchanged: number;
  lastSeen: number;
  banned: boolean;
}
```

---

## 6. Protocolo Nostr — NIP-Entropy (kind: 7001)

### 6.1 Evento de Chunk Map

```json
{
  "kind": 7001,
  "pubkey": "<author_pubkey>",
  "created_at": 1700000000,
  "content": "Descripción opcional del contenido",
  "tags": [
    ["x-hash", "<root_hash_sha256>"],
    ["mime", "video/mp4"],
    ["size", "157286400"],
    ["chunk-size", "5242880"],
    ["chunk", "<hash_chunk_0>", "0"],
    ["chunk", "<hash_chunk_1>", "1"],
    ["chunk", "<hash_chunk_2>", "2"],
    ["title", "Atardecer en la playa 4K"],
    ["thumb", "<nostr_event_id_de_thumbnail>"],
    ["alt", "Video de un atardecer filmado en 4K"]
  ],
  "id": "<event_id>",
  "sig": "<signature>"
}
```

### 6.2 Señalización WebRTC vía Nostr

Se usan **eventos efímeros** (kind rango 20000-29999) para el handshake WebRTC sin dejar rastro permanente en los relays:

```json
{
  "kind": 20001,
  "pubkey": "<requester_pubkey>",
  "content": "<encrypted_sdp_offer_or_answer>",
  "tags": [
    ["p", "<target_peer_pubkey>"],
    ["x", "<root_hash>"],
    ["type", "offer | answer | ice-candidate"]
  ]
}
```

El contenido SDP se encripta con **NIP-04** (o NIP-44 para mayor seguridad) usando la pubkey del destinatario, garantizando que solo el peer objetivo pueda leer la señalización.

### 6.3 Proof of Upstream (Recibo Firmado)

```json
{
  "kind": 7772,
  "pubkey": "<receiver_pubkey>",
  "content": "",
  "tags": [
    ["p", "<seeder_pubkey>"],
    ["x", "<chunk_hash>"],
    ["bytes", "5242880"],
    ["receipt", "<timestamp>"]
  ],
  "id": "<event_id>",
  "sig": "<signature>"
}
```

Este evento **no se publica** a relays; se intercambia directamente entre peers vía el canal WebRTC como prueba local. Opcionalmente, un subset puede publicarse para auditoría comunitaria.

---

## 7. Capas de Seguridad

### 7.1 Verificación de Integridad

```
Archivo Original
      │
      ▼
 ┌─────────┐   ┌─────────┐   ┌─────────┐
 │ Chunk 0 │   │ Chunk 1 │   │ Chunk 2 │   ...
 │ SHA-256  │   │ SHA-256  │   │ SHA-256  │
 └────┬────┘   └────┬────┘   └────┬────┘
      │              │              │
      └──────────────┼──────────────┘
                     ▼
              ┌─────────────┐
              │ Merkle Root │  ← Publicado en kind:7001 tag ["x-hash"]
              └─────────────┘
```

- Cada chunk recibido se verifica contra su hash individual del Chunk Map.
- El Merkle Root permite verificar la integridad global sin tener todos los chunks.
- **Un solo bit alterado** invalida la verificación → peer marcado como malicioso.

### 7.2 Privacidad

| Mecanismo | Implementación |
|---|---|
| **Negación plausible** | Chunks son fragmentos binarios sin formato; un nodo nunca posee contenido reconocible. |
| **Cifrado en tránsito** | WebRTC usa DTLS por defecto; todo el tráfico P2P está cifrado. |
| **Señalización cifrada** | SDP offers/answers encriptados con NIP-04/NIP-44. |
| **Sin servidores centrales** | Ni los relays ni los STUN servers ven el contenido; solo metadatos y señalización. |

---

## 8. Estrategia de Almacenamiento y Cuotas

```
┌──────────────────────────────────────────┐
│           Quota Manager                   │
│                                          │
│  Límite por defecto: 2 GB               │
│  Configurable por el usuario             │
│                                          │
│  Política de evicción (LRU):             │
│  1. Chunks no-pinned más antiguos        │
│  2. Contenido completamente descargado   │
│     y ya reproducido                     │
│  3. Chunks fríos con menor crédito       │
│                                          │
│  Nunca evictar:                          │
│  • Chunks del contenido propio           │
│  • Chunks pinned manualmente             │
│  • Chunks con custodia activa (crédito)  │
└──────────────────────────────────────────┘
```

Se usa `navigator.storage.estimate()` para consultar espacio disponible y `navigator.storage.persist()` para solicitar almacenamiento persistente.

---

## 9. Rendimiento: Web Workers

Las operaciones pesadas **nunca** bloquean el hilo principal:

| Operación | Worker |
|---|---|
| Fragmentación de archivo (5MB chunks) | `chunker.ts` |
| Hashing SHA-256 de chunks | `hash.ts` |
| Construcción de Merkle Tree | `merkle.ts` |
| Re-ensamblaje de archivo | `assembler.ts` |
| Cifrado/descifrado NIP-04 | `crypto-worker.ts` |

Se usa la API `Transferable` para pasar `ArrayBuffer` entre workers sin copias de memoria.

---

## 10. Estrategia de Testing

| Nivel | Herramienta | Alcance |
|---|---|---|
| **Unit** | Vitest | Chunking, hashing, Merkle tree, serialización de eventos Nostr, ledger de créditos. |
| **Integración** | Vitest + fake-indexeddb | Almacenamiento, flujo completo de chunk store → retrieval → verificación. |
| **E2E Web** | Playwright | Flujo de upload, feed rendering, reproducción de video simulada. |
| **E2E P2P** | Playwright (2 contextos) | Dos instancias de navegador intercambiando un chunk vía WebRTC local. |
| **Extension** | Puppeteer con extensión cargada | Verificar que el Service Worker mantiene seeding en background. |

---

## 11. Roadmap de Implementación por Fases

### Fase 1 — Prototipo P2P (PoC) ✅

**Objetivo:** Dos navegadores intercambian un archivo de 5MB usando identidad Nostr.

- [x] Configurar monorepo (pnpm + Turborepo + TypeScript)
- [x] Implementar `@entropy/core`: chunker, hasher, Merkle tree
- [x] Implementar cliente Nostr básico (conectar a relay, publicar/suscribir)
- [x] Definir evento `kind:7001` y parser
- [x] Implementar señalización WebRTC vía eventos efímeros Nostr
- [x] Crear página web mínima: subir archivo → generar chunk map → seed → descargar desde otro navegador
- [x] Tests unitarios para chunking y hashing

### Fase 2 — Motor de Créditos ✅

**Objetivo:** Sistema funcional de Proof of Upstream y ratio de ancho de banda.

- [x] Implementar `proof-of-upstream.ts` (draft/parse/validación de recibos con verificador de firma configurable)
- [x] Implementar `ledger.ts` (registro local, ratio, balance, historial)
- [x] Implementar base de `cold-storage.ts` (elegibilidad, asignación y pruning)
- [x] Extender bridge web↔ext con `GET_CREDIT_SUMMARY` y push `CREDIT_UPDATE`
- [x] Integrar resumen de créditos en web (`CreditPanel`) y extensión (popup/dashboard)
- [x] Agregar tests unitarios para créditos + storage base (`proof-of-upstream`, `ledger`, `cold-storage`, `chunk-store`, `quota-manager`)
- [x] Lógica de gate activa: verificar crédito antes de servir chunks
- [x] Onboarding Seeder: asignar chunks fríos a nuevos usuarios en red real
- [x] Tests de integración del flujo de créditos end-to-end

### Fase 3 — Extensión de Navegador: Background Seeding Real

> Plan detallado en [`phase3.md`](./phase3.md)

**Objetivo:** El Service Worker mantiene conexiones WebRTC activas y sirve chunks a peers en background.

- [x] Scaffold extensión Manifest V3 con Vite
- [x] `@entropy/core`: Identity management (`nostr/identity.ts`) — keypair, firma, verificación con `nostr-tools`
- [x] `@entropy/core`: Protocolo de transferencia (`transport/chunk-transfer.ts`) — binario sobre DataChannel
- [x] `@entropy/core`: NAT traversal (`transport/nat-traversal.ts`) — configuración STUN
- [x] `@entropy/core`: IndexedDB ChunkStore (`storage/indexeddb-chunk-store.ts`) — persistencia real con Dexie.js
- [x] `@entropy/extension`: Relay manager (`background/relay-manager.ts`) — conexión a relays desde SW
- [x] `@entropy/extension`: Signaling listener (`background/signaling-listener.ts`) — escuchar offers WebRTC
- [x] `@entropy/extension`: Chunk server (`background/chunk-server.ts`) — servir chunks vía DataChannel
- [x] `@entropy/extension`: Chunk ingest (`background/chunk-ingest.ts`) — persistir chunks binarios
- [x] `@entropy/extension`: Identity store (`background/identity-store.ts`) — keypair persistido
- [x] `@entropy/extension`: Service Worker bootstrap completo (relays + signaling + chunk server)
- [x] `@entropy/extension`: Dashboard mejorado (inventario de chunks real, configuración de nodo, relay settings, seeding toggle)
- [x] Content script: puente de comunicación con la web app
- [x] Popup: mini-dashboard (ratio, peers, estado)
- [x] Dashboard completo: estadísticas, inventario de chunks, configuración
- [x] Mensaje `DELEGATE_SEEDING` desde web app a extensión

### Fase 4 — Web App Completa ✅

> Plan detallado en [`phase4.md`](./phase4.md)

**Objetivo:** Red social funcional con feed, perfiles y reproducción multimedia.

- [x] Scaffold UI: React Router, Zustand store, Tailwind v4, AppLayout + Sidebar + TopBar
- [x] Identidad Nostr: `useNostrIdentity`, `useNostrProfile` (kind:0), `useContactList` (kind:3)
- [x] Feed de publicaciones: `useNostrFeed` (kind:1 + kind:7001), `PostCard`, `Feed`, `HomePage`
- [x] UI de upload con progreso de chunking en tiempo real: `useUploadPipeline`, `DragDropZone`, `UploadPipeline`, `UploadPage`
- [x] Reproductor de video con MediaSource Extensions: `useMediaSource`, `VideoPlayer`, `WatchPage`
- [x] Descarga paralela desde múltiples peers: `ChunkDownloader` (core), `useChunkDownload`
- [x] Perfiles Nostr: `ProfileHeader`, `ProfileCard`, `ProfilePage`
- [x] Quota Manager y política de evicción LRU: `useQuotaManager`, `SettingsPage`
- [x] UI responsiva y accesible con Tailwind CSS
- [x] Comunicación P2P WebRTC verificada end-to-end (Firefox ↔ Chrome): fragmentación 64KB, deduplicación de GET_CHUNK, señalización anti-stale

### Fase 5 — Resiliencia y Escala *(en progreso)*

> Plan detallado en [`phase5.md`](./phase5.md)

**Objetivo:** Red robusta con redundancia, reputación de peers y protección avanzada.

- [x] Reputación de peers: `peer-reputation.ts` + `peer-reputation-idb.ts`; banning automático tras 3 fallos en 24h; integrado en `chunk-server.ts`, `chunk-downloader.ts`, `peer-fetch.ts`; dashboard UI con tabla y ban/unban manual
- [x] Cold storage real: `cold-storage-manager.ts` (runCycle / pruneExpired / verifyIntegrity); scheduler con ciclos 30min/1h/2h; panel en dashboard extensión y web app
- [x] Prueba de Custodia: CUSTODY_CHALLENGE (0x05) + CUSTODY_PROOF (0x06) en `chunk-transfer.ts`; handler en `chunk-server.ts`; self-verification en `cold-storage-manager.ts`
- [x] Seeder Announcements: `seeder-announcement.ts` (kind:20002); publicación en `signaling-listener.ts`; descubrimiento dinámico en `chunk-downloader.ts`
- [x] Métricas de red y health checks: `metrics.ts` (MetricsCollector); `GET_NODE_METRICS` bridge message; panel en dashboard extensión + `NodeMetricsPanel` en web; health check cada 10min en scheduler
- [x] Auditoría de seguridad parcial: rate limiting 10 req/s por peer; validación 4 MB max por mensaje; timeout 60s DataChannels inactivos; CSP en `index.html`; SHA-256 en `peer-fetch.ts`
- [x] Transmuxing client-side: `transmuxer.ts` (mp4box 2.3.0) integrado en `useMediaSource.ts`; pass-through si el browser soporta el MIME, remuxing a fMP4 si no
- [x] Chunk alignment con keyframes: `keyframe-aligner.ts` usando stss (sync sample table); integrado en `useUploadPipeline.ts` para archivos `video/*`; fallback a `chunkFile()` para formatos no-MP4
- [ ] Reconexión automática de WebRTC (ICE restart) *(Bloque 6)*
- [ ] NetworkHealth widget en TopBar *(Bloque 7 restante)*
- [ ] Soporte Tor opcional en la extensión *(Bloque 8)*
- [ ] RTCPeerConnection cleanup audit + full security checklist *(Bloque 9 restante)*

---

## 12. Decisiones Arquitectónicas Clave (ADRs)

### ADR-001: Monorepo con librería core compartida
**Contexto:** Web app y extensión comparten ~70% de la lógica (chunking, WebRTC, Nostr, storage).  
**Decisión:** Extraer toda la lógica a `@entropy/core` como paquete interno del monorepo.  
**Consecuencia:** Un solo lugar para bugs y mejoras; ambos consumidores siempre usan la misma versión.

### ADR-002: Señalización vía Nostr (sin servidor de señalización propio)
**Contexto:** WebRTC requiere un mecanismo de señalización para establecer conexiones.  
**Decisión:** Usar eventos efímeros de Nostr (kind 20000-29999) como canal de señalización.  
**Consecuencia:** Cero infraestructura propia para señalización; dependemos de la disponibilidad de relays Nostr (riesgo aceptable dado que son distribuidos).

### ADR-003: Chunks con alineación a keyframes para video
**Contexto:** Para streaming progresivo fluido, cada chunk debe comenzar en un keyframe (IDR frame) para que MSE pueda iniciar la reproducción desde cualquier punto.
**Decisión:** Para archivos `video/mp4`, usar `keyframe-aligner.ts` (mp4box + stss) en upload para ajustar los puntos de corte al keyframe más cercano (target ~5MB ±20%). Para otros formatos, se usa `chunkFile()` estándar.
**Consecuencia:** Chunks de video de tamaño variable (~4–6MB). El MSE player puede saltar directamente a cualquier chunk sin depender de chunks anteriores. Para formatos sin tabla stss (WebM, MKV), se usa chunking estándar con fallback automático.

### ADR-004: IndexedDB como almacenamiento principal
**Contexto:** Necesitamos persistir gigabytes de datos binarios en el navegador.  
**Decisión:** IndexedDB vía Dexie.js, con cuota configurable y evicción LRU.  
**Consecuencia:** Funciona sin extensión; la extensión extiende la persistencia con Service Worker. Limitado por la cuota del navegador (~10-50% del disco disponible).

### ADR-005: Fragmentación de chunks sobre WebRTC DataChannel (64KB)
**Contexto:** Los DataChannels de WebRTC usan SCTP como transporte, que tiene un límite de mensaje máximo (~256KB en la práctica). Enviar chunks de 5MB como un solo `dc.send()` causa `OperationError: Failure to send data`.  
**Decisión:** Fragmentar los chunks en bloques de 64KB para el envío sobre DataChannel. Se envía primero un mensaje `CHUNK_DATA_HEADER` (type 0x04) con el hash y tamaño total, seguido de N fragmentos binarios puros. El receptor usa `createChunkReceiver()` para reensamblar.  
**Consecuencia:** Chunks de cualquier tamaño se transfieren de forma confiable sobre WebRTC. El overhead es mínimo (1 header por chunk). Compatible con backpressure via `bufferedAmount`.

### ADR-006: MediaSource Extensions + Transmuxing para streaming progresivo
**Contexto:** MSE (`MediaSource.isTypeSupported()`) solo acepta codecs específicos por navegador. Videos en WebM, MKV u otros formatos no-MP4 rompen el `SourceBuffer`.
**Decisión:** Usar MSE para alimentar el `<video>` tag chunk por chunk. Al primer chunk, `transmuxer.ts` detecta si el MIME es soportado nativamente: si sí, pass-through transparente; si no, remuxing a fMP4 via mp4box. El `SourceBuffer` se crea en diferido (al primer chunk) usando el `outputMimeType` real del transmuxer.
**Consecuencia:** Compatibilidad universal de codecs sin overhead para formatos ya soportados. Los chunks alineados a keyframes (ADR-003) garantizan que MSE puede iniciar desde cualquier segmento.

---

## 13. Diagrama de Dependencias entre Paquetes

```
  @entropy/core
       ▲     ▲
       │     │
       │     └──────────────┐
       │                    │
  @entropy/web      @entropy/extension
```

- `core` no depende de ningún paquete interno — es puro y portable.
- `web` y `extension` dependen de `core` pero **nunca** entre sí.
- La comunicación entre `web` y `extension` es exclusivamente vía **message passing** (postMessage / chrome.runtime).
