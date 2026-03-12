# Technical Architecture — Entropy Multimedia Layer

> Software structure, components, technologies, and data flows necessary to implement Entropy as a **web application** and a **browser extension** that cooperate to form a P2P multimedia content network over Nostr.

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER (Browser)                              │
│                                                                     │
│  ┌──────────────────────┐     ┌──────────────────────────────────┐  │
│  │   Entropy Extension  │◄───►│        Entropy Web App           │  │
│  │  (Manifest V3)       │     │     (SPA - React + Vite)         │  │
│  │                      │     │                                  │  │
│  │ • Service Worker     │     │ • Social Feed (Nostr)            │  │
│  │ • Background Seeding │     │ • Multimedia Player              │  │
│  │ • Node Dashboard     │     │ • Uploader / Chunker             │  │
│  │ • Credit Management  │     │ • Profile / Identity Viewer      │  │
│  └──────────┬───────────┘     └───────────────┬──────────────────┘  │
│             │                                 │                     │
│             └────────────┬────────────────────┘                     │
│                          ▼                                          │
│              ┌───────────────────────┐                              │
│              │    @entropy/core      │                              │
│              │   (Shared Library)    │                              │
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
     │ (Metadata) │ │ (Data P2P) │   │ (Signaling)  │
     └────────────┘ └────────────┘   └──────────────┘
```

The system consists of **three packages** within a **monorepo**:

| Package | Role |
|---|---|
| `@entropy/core` | Shared business logic: chunking, hashing, WebRTC, Nostr, credits, storage. |
| `@entropy/web` | SPA web application — social network interface, feed, player, upload. |
| `@entropy/extension` | Manifest V3 browser extension — persistent seeding, node dashboard. |

---

## 2. Monorepo Structure

```
entropy/
├── package.json              # Workspace root (pnpm workspaces)
├── pnpm-workspace.yaml
├── turbo.json                # Turborepo for parallel builds
├── tsconfig.base.json        # Shared TS config
│
├── packages/
│   └── core/                 # @entropy/core
│       ├── src/
│       │   ├── chunking/
│       │   │   ├── chunker.ts          # File fragmentation into 5MB chunks (target)
│       │   │   ├── keyframe-aligner.ts # Chunking with keyframe alignment (mp4box, video/mp4)
│       │   │   ├── assembler.ts        # Reassembly of chunks to original file
│       │   │   └── merkle.ts           # Merkle tree for root hash + verification
│       │   ├── transport/
│       │   │   ├── peer-manager.ts     # Active WebRTC connection pool
│       │   │   ├── signaling.ts        # Signaling via Nostr ephemeral events
│       │   │   ├── chunk-transfer.ts   # Binary protocol: CHUNK_REQUEST/DATA/ERROR + CUSTODY_CHALLENGE/PROOF
│       │   │   ├── chunk-downloader.ts # Multi-peer download + reputation + seeder discovery
│       │   │   ├── transmuxer.ts       # On-the-fly transmuxing to fMP4 for MSE (mp4box)
│       │   │   └── nat-traversal.ts    # STUN/TURN configuration
│       │   ├── credits/
│       │   │   ├── ledger.ts           # Local credit ledger (upload/download ratio)
│       │   │   ├── proof-of-upstream.ts # Generation and verification of signed proofs
│       │   │   ├── cold-storage.ts     # Cold chunk custody assignment logic
│       │   │   ├── peer-reputation.ts  # PeerReputationStore interface + banning policy
│       │   │   └── credit-gating.ts    # Gate: verify credit before serving chunks
│       │   ├── storage/
│       │   │   ├── chunk-store.ts      # Chunk CRUD in IndexedDB
│       │   │   ├── db.ts              # Dexie.js Schema and migrations (peers table)
│       │   │   ├── quota-manager.ts    # User disk quota control
│       │   │   ├── indexeddb-chunk-store.ts  # IDB implementation of ChunkStore
│       │   │   ├── quota-manager-idb.ts      # IDB implementation of QuotaManager
│       │   │   ├── quota-aware-store.ts      # ChunkStore with quota control
│       │   │   └── peer-reputation-idb.ts    # IDB implementation of PeerReputationStore
│       │   ├── nostr/
│       │   │   ├── client.ts           # Connection and subscription to relays
│       │   │   ├── events.ts           # Event creation/parsing (kind:7001 and standard)
│       │   │   ├── identity.ts         # Keypair management (nsec/npub)
│       │   │   ├── nip-entropy.ts      # Custom NIP definition for Chunk Maps
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
│   │   │   │   ├── feed/               # Post feed (notes, multimedia)
│   │   │   │   ├── player/             # Video/audio player (MediaSource API)
│   │   │   │   ├── uploader/           # Upload UI + chunking progress
│   │   │   │   ├── profile/            # User's Nostr profile
│   │   │   │   ├── NodeStatusPanel.tsx # Delegated node status
│   │   │   │   ├── CreditPanel.tsx     # Credits panel
│   │   │   │   ├── ColdStoragePanel.tsx # Cold storage assignments panel
│   │   │   │   ├── NodeMetricsPanel.tsx # Node metrics panel
│   │   │   │   └── ui/                 # Base components (shadcn/ui)
│   │   │   ├── hooks/
│   │   │   │   ├── useNostr.ts         # Nostr events subscription
│   │   │   │   ├── usePeerSwarm.ts     # Active WebRTC swarm state
│   │   │   │   ├── useChunkDownload.ts # Chunk download orchestration
│   │   │   │   ├── useExtensionNodeStatus.ts # Delegate node live status
│   │   │   │   ├── useCredits.ts       # User credits state
│   │   │   │   ├── useColdStorage.ts   # Cold storage assignments from extension
│   │   │   │   └── useNodeMetrics.ts   # Node metrics with 30s auto-refresh
│   │   │   ├── stores/
│   │   │   │   └── entropy-store.ts    # Global state (Zustand)
│   │   │   ├── lib/
│   │   │   │   └── extension-bridge.ts # Communication with extension via postMessage
│   │   │   ├── pages/
│   │   │   │   ├── Home.tsx
│   │   │   │   ├── Watch.tsx           # Playback of specific content
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
│       │   │   ├── service-worker.ts   # Main Service Worker (Manifest V3)
│       │   │   ├── seeder.ts           # Persistent background seeding logic
│       │   │   ├── credit-ledger.ts    # Credit ledger persisted in chrome.storage
│       │   │   ├── scheduler.ts        # Scheduler: prune + cold storage + integrity + health checks
│       │   │   ├── cold-storage-manager.ts  # Real cold storage cycles
│       │   │   ├── metrics.ts          # MetricsCollector + health checks
│       │   │   ├── chunk-server.ts     # Serves chunks + reputation + rate limiting + custody
│       │   │   ├── peer-fetch.ts       # Chunk fetch + reputation + SHA-256
│       │   │   ├── relay-manager.ts    # Relay connection management
│       │   │   ├── signaling-listener.ts  # Listens for offers + publishes seeder announcements
│       │   │   ├── chunk-ingest.ts     # Persistence of binary chunks
│       │   │   └── identity-store.ts   # Persisted keypair in chrome.storage
│       │   ├── popup/
│       │   │   ├── Popup.tsx           # Compact node dashboard
│       │   │   └── main.tsx
│       │   ├── dashboard/
│       │   │   ├── index.html          # Full dashboard (new tab) with peers/cold/metrics sections
│       │   │   ├── main.ts             # Logic: status, credits, inventory, peers, cold storage, metrics
│       │   │   └── styles.css          # Dashboard styles
│       │   ├── content/
│       │   │   └── content-script.ts   # Communication bridge with @entropy/web
│       │   └── shared/
│       │       ├── messaging.ts         # Types and helpers for chrome.runtime messaging
│       │       └── status-client.ts     # Client: status + credits + cold storage + metrics
│       ├── manifest.json               # Manifest V3
│       ├── vite.config.ts              # Multi-entry build (background, popup, dashboard, content)
│       ├── package.json
│       └── tsconfig.json
│
└── architecture.md
```

---

## 3. Technology Stack

| Layer | Technology | Justification |
|---|---|---|
| **Language** | TypeScript 5.x | Strict typing across the codebase; shared between web and extension. |
| **Monorepo** | pnpm workspaces + Turborepo | Fast and incremental builds; deduplicated dependencies. |
| **Web Framework** | React 19 + Vite | Lightweight SPA, fast HMR, efficient tree-shaking. |
| **Styles** | TailwindCSS 4 + shadcn/ui | Modern, accessible UI with reusable components. |
| **State** | Zustand | Minimal, no boilerplate; ideal for reactive P2P state. |
| **Routing** | React Router 7 | Standard SPA navigation. |
| **Nostr** | nostr-tools | Reference library: event creation, signing, subscriptions. |
| **WebRTC** | simple-peer | Clean abstraction over native RTCPeerConnection. |
| **Hashing** | Web Crypto API (SHA-256) | Browser native, fast, no dependencies. |
| **Storage** | Dexie.js (IndexedDB) | Ergonomic API over IndexedDB with migration support. |
| **Media Playback** | MediaSource Extensions (MSE) | Progressive streaming: feed the player chunk by chunk. |
| **Transmuxing** | mp4box 2.3.0 | Keyframe detection (stss), fMP4 init segments generation, remuxing for MSE compatibility. |
| **Extension** | Manifest V3 + Chrome APIs | Current standard; Service Worker for background. Firefox compatible via polyfill. |
| **Extension Build** | Vite + CRXJS or vite-plugin-web-extension | Optimized multi-entry build for extensions. |
| **Testing** | Vitest + Playwright | Unit tests for core; E2E for web flows. |
| **Linting** | ESLint + Prettier | Code consistency. |

---

## 4. Main Data Flows

### 4.1 Content Upload

```
User selects file
        │
        ▼
┌─────────────────────┐
│  Chunking Engine     │  Splits into 5MB chunks
│  (Web Worker)        │  using File.slice()
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Merkle Tree Hash   │  SHA-256 per chunk → Merkle root
└─────────┬───────────┘
          │
          ├──────────────────────────┐
          ▼                          ▼
┌──────────────────┐     ┌────────────────────────┐
│  IndexedDB       │     │  Nostr Event (kind:7001)│
│  Stores chunks   │     │                        │
│  locally         │     │  {                     │
└──────────────────┘     │    "kind": 7001,       │
                         │    "content": "",      │
                         │    "tags": [           │
                         │      ["x-hash", "<root_hash>"],
                         │      ["chunk", "<hash_0>", "0"],
                         │      ["chunk", "<hash_1>", "1"],
                         │      ...                │
                         │      ["size", "524288000"],
                         │      ["mime", "video/mp4"],
                         │      ["title", "My Video"]
                         │    ]                   │
                         │  }                     │
                         └────────────┬───────────┘
                                      │
                                      ▼
                              Published to Nostr Relays
                                      │
                                      ▼
                         User starts SEEDING
                         (WebRTC accepts connections)
```

### 4.2 Download and Playback (Streaming)

```
Feed shows post with kind:7001
        │
        ▼
┌─────────────────────────┐
│  Parse Chunk Map        │  Extract hash list, size, mime
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  Peer Discovery         │  Find active "gatekeepers"
│  (Nostr + Data local)   │  in the event or via signaling
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  WebRTC Handshake       │  Signaling via Nostr ephemeral
│  (multiple peers)       │  events (kind:20000-29999)
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  Parallel Chunk         │  Request different chunks
│  Download               │  from different peers simultaneously
└─────────┬───────────────┘
          │
          ├─── Verify SHA-256 of each received chunk
          │    ✗ Invalid hash → mark peer as malicious
          │    ✓ Valid hash  → store in IndexedDB
          │
          ▼
┌─────────────────────────┐
│  MediaSource Extensions │  Feed SourceBuffer with
│  (Progressive Streaming)│  verified chunks in order
└─────────┬───────────────┘
          │
          ▼
   <video> plays content
   while downloading more chunks
```

### 4.3 Web App ↔ Extension Communication

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

Key messages:
─────────────────
WEB → EXT:  "DELEGATE_SEEDING"            → Pass active chunks to background
WEB → EXT:  "GET_NODE_STATUS"             → Request node stats
WEB → EXT:  "GET_CREDIT_SUMMARY"          → Request credit summary
WEB → EXT:  "GET_NODE_SETTINGS"           → Request config (relays, seeding toggle)
WEB → EXT:  "ADD_RELAY" / "REMOVE_RELAY" → Manage relays
WEB → EXT:  "SET_SEEDING_ACTIVE"          → Enable/disable seeding
WEB → EXT:  "GET_COLD_STORAGE_ASSIGNMENTS" → List cold storage assignments
WEB → EXT:  "RELEASE_COLD_ASSIGNMENT"     → Release individual assignment
WEB → EXT:  "GET_NODE_METRICS"            → Request operational metrics
WEB → EXT:  "HEARTBEAT"                   → Keep connection alive
EXT → WEB:  "NODE_STATUS_UPDATE"          → Push live node status
EXT → WEB:  "CREDIT_UPDATE"               → Push live credit summary

All requests and responses use `requestId` for robust correlation.
```

---

## 5. Data Model (IndexedDB — Dexie.js)

```typescript
// packages/core/src/storage/db.ts

interface ChunkRecord {
  hash: string;           // SHA-256 of the chunk (PK)
  data: ArrayBuffer;      // Binary content (≤5MB, fragmented into 64KB for WebRTC transport)
  rootHash: string;       // Root hash of the file it belongs to
  index: number;          // Position in sequence
  createdAt: number;      // Timestamp
  lastAccessed: number;   // For LRU eviction policy
  pinned: boolean;        // If user chose to retain manually
}

interface ContentRecord {
  rootHash: string;       // PK — Root hash of the complete file
  title: string;
  mimeType: string;
  totalSize: number;
  totalChunks: number;
  chunkHashes: string[];  // Ordered list of hashes
  nostrEventId: string;   // ID of the kind:7001 event
  authorPubkey: string;
  createdAt: number;
  isComplete: boolean;    // All chunks downloaded
}

interface CreditRecord {
  id: string;             // Auto-increment
  peerPubkey: string;     // Pubkey of involved peer
  direction: 'up' | 'down';
  bytes: number;
  chunkHash: string;
  signature: string;      // Receiver signature (Proof of Upstream)
  timestamp: number;
}

interface PeerReputation {
  pubkey: string;         // PK
  successfulTransfers: number;
  failedVerifications: number;  // Chunks with invalid hash
  totalBytesExchanged: number;
  lastSeen: number;
  banned: boolean;
}
```

---

## 6. Nostr Protocol — NIP-Entropy (kind: 7001)

### 6.1 Chunk Map Event

```json
{
  "kind": 7001,
  "pubkey": "<author_pubkey>",
  "created_at": 1700000000,
  "content": "Optional content description",
  "tags": [
    ["x-hash", "<root_hash_sha256>"],
    ["mime", "video/mp4"],
    ["size", "157286400"],
    ["chunk-size", "5242880"],
    ["chunk", "<hash_chunk_0>", "0"],
    ["chunk", "<hash_chunk_1>", "1"],
    ["chunk", "<hash_chunk_2>", "2"],
    ["title", "Beach sunset 4K"],
    ["thumb", "<thumbnail_nostr_event_id>"],
    ["alt", "Video of a sunset shot in 4K"]
  ],
  "id": "<event_id>",
  "sig": "<signature>"
}
```

### 6.2 WebRTC Signaling via Nostr

Uses **ephemeral events** (kind range 20000-29999) for the WebRTC handshake without leaving a permanent trace on the relays:

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

The SDP content is encrypted with **NIP-44 (mandatory)** using the recipient's pubkey, ensuring only the target peer can read the signaling.

### 6.3 Proof of Upstream (Signed Receipt)

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

This event **is not published** to relays; it is exchanged directly between peers via the WebRTC channel as local proof. Optionally, a subset can be published for community auditing.

---

## 7. Security Layers

### 7.1 Integrity Verification

```
Original File
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
              │ Merkle Root │  ← Published in kind:7001 tag ["x-hash"]
              └─────────────┘
```

- Each received chunk is verified against its individual hash from the Chunk Map.
- The Merkle Root allows verifying overall integrity without having all chunks.
- **A single flipped bit** invalidates verification → peer marked as malicious.

### 7.2 Privacy

| Mechanism | Implementation |
|---|---|
| **Plausible Deniability** | Chunks are unformatted binary fragments; a node never holds recognizable content. |
| **Encryption in transit** | WebRTC uses DTLS by default; all P2P traffic is encrypted. |
| **Encrypted signaling** | SDP offers/answers encrypted with NIP-44 (mandatory). |
| **No central servers** | Neither relays nor STUN servers see the content; only metadata and signaling. |
| **Tor proxy (optional)** | Connections to Nostr relays can be routed via SOCKS5 (Tor) to hide relay operator's IP. Support `.onion` relay URLs. Firefox: `browser.proxy.onRequest`; Chrome: PAC script via `chrome.proxy.settings`. |
| **ICE candidate filtering** | Option to remove host/srflx candidates with local IPs from signaling messages, preventing internal IP leak. |
| **TURN relay-only mode** | Option to force `iceTransportPolicy: "relay"` with user-configured TURN servers, hiding public IP from direct peers. |

---

## 8. Storage and Quota Strategy

```
┌──────────────────────────────────────────┐
│           Quota Manager                   │
│                                          │
│  Default limit: 2 GB                    │
│  User configurable                       │
│                                          │
│  Eviction Policy (LRU):                  │
│  1. Oldest non-pinned chunks             │
│  2. Fully downloaded content             │
│     and already played                   │
│  3. Cold chunks with lower credit        │
│                                          │
│  Never evict:                            │
│  • Own content chunks                    │
│  • Manually pinned chunks                │
│  • Intact custody chunks (credit)        │
└──────────────────────────────────────────┘
```

Uses `navigator.storage.estimate()` to query available space and `navigator.storage.persist()` to request persistent storage.

---

## 9. Performance: Web Workers

Heavy operations **never** block the main thread:

| Operation | Worker |
|---|---|
| File fragmentation (5MB chunks) | `chunker.ts` |
| SHA-256 hashing of chunks | `hash.ts` |
| Merkle Tree Construction | `merkle.ts` |
| File Re-assembly | `assembler.ts` |
| NIP-44 Encryption/Decryption | `nip44.ts` |

The `Transferable` API is used to pass `ArrayBuffer` between workers without memory copies.

---

## 10. Testing Strategy

| Level | Tool | Scope |
|---|---|---|
| **Unit** | Vitest | Chunking, hashing, Merkle tree, Nostr event serialization, credit ledger. |
| **Integration** | Vitest + fake-indexeddb | Storage, full chunk store flow → retrieval → verification. |
| **E2E Web** | Playwright | Upload flow, feed rendering, simulated video playback. |
| **E2E P2P** | Playwright (2 contexts) | Two browser instances exchanging a chunk via local WebRTC. |
| **Extension** | Puppeteer with loaded extension | Verify that the Service Worker maintains background seeding. |

---

## 12. Key Architectural Decisions (ADRs)

### ADR-001: Monorepo with shared core library
**Context:** Web app and extension share ~70% of logic (chunking, WebRTC, Nostr, storage).  
**Decision:** Extract all logic to `@entropy/core` as an internal monorepo package.  
**Consequence:** Single place for bugs and features; both consumers always use same version.

### ADR-002: Signaling via Nostr (no proprietary signaling server)
**Context:** WebRTC requires a signaling mechanism to establish connections.  
**Decision:** Use Nostr ephemeral events (kind 20000-29999) as signaling channel.  
**Consequence:** Zero proprietary infrastructure for signaling; we depend on Nostr relay availability (acceptable risk as they are distributed).

### ADR-003: Keyframe-aligned chunks for video
**Context:** For smooth progressive streaming, each chunk must start at a keyframe (IDR frame) so MSE can begin playback from any point.
**Decision:** For `video/mp4` files, use `keyframe-aligner.ts` (mp4box + stss) during upload to adjust cut points to nearest keyframe (target ~5MB ±20%). For other formats, use standard `chunkFile()`.
**Consequence:** Variable-sized video chunks (~4–6MB). The MSE player can jump directly to any chunk without depending on previous chunks. For formats without stss table (WebM, MKV), standard chunking is used with automatic fallback.

### ADR-004: IndexedDB as primary storage
**Context:** We need to persist gigabytes of binary data in the browser.  
**Decision:** IndexedDB via Dexie.js, with configurable quota and LRU eviction.  
**Consequence:** Works without extension; the extension extends persistence with Service Worker. Limited by browser quota (~10-50% of available disk).

### ADR-005: Chunk fragmentation over WebRTC DataChannel (64KB)
**Context:** WebRTC DataChannels use SCTP as transport, which has a maximum message limit (~256KB in practice). Sending 5MB chunks as a single `dc.send()` causes `OperationError: Failure to send data`.  
**Decision:** Fragment chunks in 64KB blocks for sending over DataChannel. First send `CHUNK_DATA_HEADER` message (type 0x04) with hash and total size, followed by N pure binary fragments. Receiver uses `createChunkReceiver()` to reassemble.  
**Consequence:** Chunks of any size transfer reliably over WebRTC. Minimal overhead (1 header per chunk). Compatible with backpressure via `bufferedAmount`.

### ADR-006: MediaSource Extensions + Transmuxing for progressive streaming
**Context:** MSE (`MediaSource.isTypeSupported()`) only accepts specific codecs per browser. Video in WebM, MKV or other non-MP4 formats break the `SourceBuffer`.
**Decision:** Use MSE to feed `<video>` tag chunk by chunk. On first chunk, `transmuxer.ts` detects native MIME support: if yes, transparent pass-through; if not, remuxing to fMP4 via mp4box. The `SourceBuffer` is created lazily (at first chunk) using the real `outputMimeType` from transmuxer.
**Consequence:** Universal codec compatibility without overhead for already supported formats. Keyframe-aligned chunks (ADR-003) guarantee MSE can start from any segment.

---

## 13. Package Dependency Diagram

```
  @entropy/core
       ▲     ▲
       │     │
       │     └──────────────┐
       │                    │
  @entropy/web      @entropy/extension
```

- `core` depends on no internal package — it is pure and portable.
- `web` and `extension` depend on `core` but **never** on each other.
- Communication between `web` and `extension` is exclusively via **message passing** (postMessage / chrome.runtime).
