# Entropy — System Flows & Communication Diagrams

> This document describes the **runtime flows** of the Entropy system: how content is uploaded, discovered, downloaded, streamed, and how the credit economy works. Each section includes an ASCII diagram and a step-by-step explanation referencing the actual modules involved.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Upload Flow](#2-upload-flow)
3. [Feed Discovery Flow](#3-feed-discovery-flow)
4. [Download & Playback Flow](#4-download--playback-flow)
5. [Web ↔ Extension Communication](#5-web--extension-communication)
6. [WebRTC Signaling Flow](#6-webrtc-signaling-flow)
7. [Chunk Transfer Protocol](#7-chunk-transfer-protocol)
8. [Credit Economy](#8-credit-economy)
9. [Storage & Quota Management](#9-storage--quota-management)
10. [Identity & Authentication](#10-identity--authentication)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            USER'S BROWSER                                   │
│                                                                             │
│  ┌─────────────────────────┐          ┌──────────────────────────────────┐  │
│  │   @entropy/extension    │◄────────►│          @entropy/web            │  │
│  │                         │ postMsg  │                                  │  │
│  │  Service Worker         │          │  Feed (kind:1 + kind:7001)      │  │
│  │  ├─ Relay Manager       │          │  Upload Pipeline                │  │
│  │  ├─ Signaling Listener  │          │  Inline Media Player (MSE)      │  │
│  │  ├─ Chunk Server        │          │  Nostr Profile (kind:0)         │  │
│  │  ├─ Chunk Ingest        │          │  Settings & Quota Manager       │  │
│  │  └─ Identity Store      │          │  Credit Panel                   │  │
│  │                         │          │                                  │  │
│  │  Dashboard / Popup      │          │                                  │  │
│  └────────────┬────────────┘          └───────────────┬──────────────────┘  │
│               │                                       │                     │
│               └───────────────┬───────────────────────┘                     │
│                               ▼                                             │
│                    ┌─────────────────────┐                                  │
│                    │    @entropy/core    │                                  │
│                    │                     │                                  │
│                    │  Chunker + Merkle   │                                  │
│                    │  RelayPool (Nostr)  │                                  │
│                    │  PeerManager (RTC)  │                                  │
│                    │  SignalingChannel   │                                  │
│                    │  ChunkDownloader    │                                  │
│                    │  ChunkTransfer      │                                  │
│                    │  Credit Ledger      │                                  │
│                    │  QuotaManager       │                                  │
│                    │  IndexedDB Store    │                                  │
│                    └─────────┬──────────┘                                  │
│                              │                                              │
└──────────────────────────────┼──────────────────────────────────────────────┘
                               │
              ┌────────────────┼──────────────────┐
              ▼                ▼                  ▼
       ┌────────────┐  ┌────────────┐   ┌──────────────┐
       │   Nostr     │  │  WebRTC    │   │  STUN/TURN   │
       │   Relays    │  │  Peers     │   │  Servers     │
       │ (Metadata)  │  │ (Data P2P) │   │ (ICE)        │
       └────────────┘  └────────────┘   └──────────────┘
```

**Three packages, one shared core:**

| Package | Runtime | Role |
|---|---|---|
| `@entropy/core` | Both | Shared logic: chunking, hashing, Nostr, WebRTC, credits, storage |
| `@entropy/web` | Browser tab | SPA — social feed, media player, uploader, profile, settings |
| `@entropy/extension` | Service Worker | Background seeding, signaling listener, chunk server, dashboard |

---

## 2. Upload Flow

When a user uploads a file, it goes through a **5-stage pipeline** before becoming available on the network.

```
 User selects file + title + description
                    │
                    ▼
 ┌──────────────────────────────────┐
 │  Stage 1: CHUNKING               │
 │                                  │
 │  chunkFile(blob, 5MB)            │  @entropy/core/chunking/chunker.ts
 │  File.slice() → Uint8Array[]     │
 │  SHA-256 hash per chunk          │
 └──────────┬───────────────────────┘
            │  ChunkRecord[] + chunkHashes[]
            ▼
 ┌──────────────────────────────────┐
 │  Stage 2: HASHING                │
 │                                  │
 │  computeMerkleRoot(chunkHashes)  │  @entropy/core/chunking/merkle.ts
 │  → rootHash (SHA-256)            │
 └──────────┬───────────────────────┘
            │  rootHash
            ▼
 ┌──────────────────────────────────┐
 │  Stage 3: STORING                │
 │                                  │
 │  For each chunk:                 │
 │    extension-bridge.storeChunk({ │  apps/web/src/lib/extension-bridge.ts
 │      hash, rootHash, index,      │
 │      data: Array.from(bytes)     │  → postMessage → content-script
 │    })                            │  → chrome.runtime → service-worker
 │                                  │  → IndexedDB (Dexie.js)
 └──────────┬───────────────────────┘
            │  All chunks persisted
            ▼
 ┌──────────────────────────────────┐
 │  Stage 4: DELEGATING             │
 │                                  │
 │  extension-bridge                │
 │    .delegateSeeding({            │
 │      rootHash, chunkHashes,      │
 │      mimeType, title             │
 │    })                            │
 │                                  │
 │  Extension SW activates:         │
 │  - Relay connections             │
 │  - Signaling listener            │
 │  - Chunk server (WebRTC)         │
 └──────────┬───────────────────────┘
            │  Extension is now seeding
            ▼
 ┌──────────────────────────────────┐
 │  Stage 5: PUBLISHING             │
 │                                  │
 │  buildEntropyChunkMapEvent({     │  @entropy/core/nostr/events.ts
 │    rootHash, chunks, size,       │
 │    mimeType, title, gatekeepers  │
 │  })                              │
 │       │                          │
 │       ▼                          │
 │  window.nostr.signEvent(draft)   │  NIP-07 (extension or provider)
 │       │                          │
 │       ▼                          │
 │  relayPool.publish(signedEvent)  │  @entropy/core/nostr/client.ts
 │                                  │
 │  → kind:7001 event on relays     │
 └──────────────────────────────────┘

 Result: Content is now discoverable on Nostr and
         served by the extension via WebRTC.
```

**Modules involved:**

| Stage | Web Hook/Component | Core Module |
|---|---|---|
| Chunking | `useUploadPipeline` | `chunker.ts`, `merkle.ts` |
| Storing | `useUploadPipeline` → `extension-bridge` | `IndexedDB` via extension |
| Delegating | `useUploadPipeline` → `extension-bridge` | Extension service-worker |
| Publishing | `useUploadPipeline` | `events.ts`, `client.ts` (RelayPool) |

---

## 3. Feed Discovery Flow

The home feed subscribes to Nostr relays and displays both text notes and multimedia chunk maps.

```
 ┌──────────────────────────────────────────────────────┐
 │  useNostrFeed hook                                   │
 │                                                      │
 │  relayPool.subscribe([                               │
 │    { kinds: [1, 7001], limit: 50 }                   │
 │  ])                                                  │
 └──────────┬───────────────────────────────────────────┘
            │  Events stream in from connected relays
            ▼
 ┌──────────────────────────────────────────────────────┐
 │  Event Router                                        │
 │                                                      │
 │  kind:1 (Text Note)                                  │
 │  → { id, pubkey, content, created_at }               │
 │  → Render as text post in feed                       │
 │                                                      │
 │  kind:7001 (Entropy Chunk Map)                       │
 │  → parseEntropyChunkMapTags(event.tags)              │
 │  → { rootHash, chunks[], size, mimeType, title,      │
 │      gatekeepers[] }                                 │
 │  → Cache in entropy-store.chunkMapCache              │
 │  → Render as media post with inline player           │
 └──────────┬───────────────────────────────────────────┘
            │
            ▼
 ┌──────────────────────────────────────────────────────┐
 │  PostCard Component                                  │
 │                                                      │
 │  ┌─ useNostrProfile(pubkey)                          │
 │  │  → relayPool.subscribe([kind:0, authors:[pk]])    │
 │  │  → Parse JSON content → name, picture, nip05      │
 │  │                                                   │
 │  ├─ useChunkBlob(chunkMap)                           │
 │  │  → extension-bridge.getChunk({ hash }) per chunk  │
 │  │  → assembleChunks(buffers, mimeType) → Blob       │
 │  │  → URL.createObjectURL(blob) → blobUrl            │
 │  │                                                   │
 │  └─ Render:                                          │
 │     Image  → <img src={blobUrl}>                     │
 │     Audio  → <audio controls src={blobUrl}>          │
 │     Video  → <video preload="metadata"> (preview)    │
 │              Click ▶ → video.play() inline            │
 └──────────────────────────────────────────────────────┘
```

**Nostr event kinds used:**

| Kind | Name | Purpose |
|---|---|---|
| `0` | Metadata | User profiles (name, picture, about, nip05) |
| `1` | Text Note | Short text posts |
| `3` | Contact List | Follow lists |
| `7001` | Entropy Chunk Map | Multimedia content descriptor |
| `20001` | Entropy Signaling | WebRTC ephemeral signaling (offers, answers, ICE) |

---

## 4. Download & Playback Flow

Two paths exist for loading media content:

### Path A: Local Playback (chunks in extension)

```
 PostCard renders kind:7001
         │
         ▼
 useChunkBlob(chunkMap)
         │
         │  For i = 0..N:
         │    extension-bridge.getChunk({ hash: chunks[i] })
         │    │
         │    ▼
         │  content-script → service-worker → IndexedDB
         │    │
         │    ▼
         │  { index, data: number[] } or null
         │
         ▼
 assembleChunks(buffers, mimeType)
         │
         ▼
 URL.createObjectURL(blob) → blobUrl
         │
         ├── Image: <img src={blobUrl}>
         ├── Audio: <audio src={blobUrl}>
         └── Video: <video src={blobUrl} preload="metadata">
                    First frame shown as preview
                    Click ▶ → play inline in feed
```

### Path B: P2P Download (chunks from remote peers)

```
 WatchPage or PostCard triggers download
         │
         ▼
 useChunkDownload(chunkMap)
         │
         ▼
 ┌──────────────────────────────────────────────────────┐
 │  ChunkDownloader                                     │
 │                                                      │
 │  1. Read gatekeepers from chunkMap                   │
 │  2. For each gatekeeper:                             │
 │     SignalingChannel.onSignal(myPubkey, callback)     │
 │     connectToPeer(peerPubkey):                       │
 │       a. new RTCPeerConnection(createRtcConfig())    │
 │       b. pc.createDataChannel("entropy")             │
 │       c. pc.createOffer() → setLocalDescription      │
 │       d. signalingChannel.sendOffer({                │
 │            targetPubkey, sdp, rootHash               │
 │          })                                          │
 │       e. Wait for answer + ICE via onSignal          │
 │       f. DataChannel opens → ready                   │
 │                                                      │
 │  3. scheduleNextRequests():                          │
 │     Round-robin assign pending chunks to peers        │
 │     dc.send(encodeChunkRequest({                     │
 │       chunkHash, rootHash, requesterPubkey            │
 │     }))                                              │
 │                                                      │
 │  4. dc.onmessage (via createChunkReceiver):           │
 │     Reassembles fragmented chunks (64KB fragments)    │
 │     → CHUNK_DATA: verify sha256 → store              │
 │     → CHUNK_ERROR: re-queue chunk                    │
 │                                                      │
 │  5. onProgress(downloaded, total) → React state      │
 │  6. onComplete() → all chunks received               │
 └──────────────────────────────────────────────────────┘
```

### Streaming with MediaSource Extensions (MSE)

```
 ChunkDownloader receives chunks out of order
         │
         ▼
 useMediaSource hook
         │
         ▼
 ┌──────────────────────────────────────────────────────┐
 │  1. new MediaSource()                                │
 │  2. video.src = URL.createObjectURL(mediaSource)     │
 │  3. sourceopen → sourceBuffer = ms.addSourceBuffer() │
 │                                                      │
 │  4. On each verified chunk (in order):               │
 │     appendChunk(index, data)                         │
 │       → sourceBuffer.appendBuffer(data)              │
 │       → If busy: queue and wait for 'updateend'      │
 │                                                      │
 │  5. Video plays progressively as chunks arrive       │
 │     (no need to wait for full download)              │
 └──────────────────────────────────────────────────────┘

 <video> ──── SourceBuffer ──── Chunks in order ──── ChunkDownloader
              (appended                               (received from
               sequentially)                           multiple peers)
```

---

## 5. Web ↔ Extension Communication

All communication between `@entropy/web` and `@entropy/extension` flows through a **message-passing bridge** using `window.postMessage` and `chrome.runtime.sendMessage`.

```
 @entropy/web (tab)              content-script.ts           service-worker.ts
 ────────────────               ─────────────────           ─────────────────
      │                              │                            │
      │  window.postMessage({        │                            │
      │    source: "entropy-web",    │                            │
      │    requestId: "req-abc",     │                            │
      │    type: "STORE_CHUNK",      │                            │
      │    payload: { hash, data }   │                            │
      │  })                          │                            │
      │ ─────────────────────────►   │                            │
      │                              │  chrome.runtime            │
      │                              │    .sendMessage({...})     │
      │                              │ ────────────────────────►  │
      │                              │                            │  Process request
      │                              │                            │  (store in IDB)
      │                              │  chrome.runtime response   │
      │                              │ ◄────────────────────────  │
      │  window.postMessage({        │                            │
      │    source: "entropy-ext",    │                            │
      │    requestId: "req-abc",     │                            │
      │    type: "STORE_CHUNK",      │                            │
      │    payload: { success }      │                            │
      │  })                          │                            │
      │ ◄─────────────────────────   │                            │
      │                              │                            │
      │                              │  PUSH (no requestId)       │
      │  NODE_STATUS_UPDATE          │ ◄────────────────────────  │
      │ ◄─────────────────────────   │                            │
      │                              │                            │
      │  CREDIT_UPDATE               │                            │
      │ ◄─────────────────────────   │                            │
```

### Message Types

| Direction | Type | Purpose |
|---|---|---|
| Web → Ext | `STORE_CHUNK` | Persist a chunk's binary data in IndexedDB |
| Web → Ext | `GET_CHUNK` | Retrieve a chunk by hash |
| Web → Ext | `DELEGATE_SEEDING` | Hand off content for background seeding |
| Web → Ext | `GET_NODE_STATUS` | Query node stats (peers, uptime, chunks) |
| Web → Ext | `GET_CREDIT_SUMMARY` | Query credit ledger summary |
| Web → Ext | `GET_PUBLIC_KEY` | Get the extension's Nostr pubkey |
| Web → Ext | `IMPORT_KEYPAIR` | Import a Nostr private key |
| Web → Ext | `ADD_RELAY` / `REMOVE_RELAY` | Manage relay list |
| Web → Ext | `SET_SEEDING_ACTIVE` | Enable/disable background seeding |
| Ext → Web | `NODE_STATUS_UPDATE` | Push: live node status changes |
| Ext → Web | `CREDIT_UPDATE` | Push: credit balance changes |

All request/response pairs are **correlated by `requestId`** for robustness.

---

## 6. WebRTC Signaling Flow

WebRTC connections are established using **Nostr ephemeral events** (kind:20001) as the signaling channel. No dedicated signaling server is needed.

```
 Downloader (Browser A)                 Nostr Relays                 Seeder (Browser B)
 ─────────────────────                 ────────────                 ───────────────────
         │                                  │                              │
         │  kind:20001 {                    │                              │
         │    type: "offer",                │                              │
         │    p: [seeder_pubkey],           │                              │
         │    x: [root_hash],              │                              │
         │    content: SDP_offer            │                              │
         │  }                               │                              │
         │ ─────────────────────────────►   │                              │
         │                                  │  ────────────────────────►   │
         │                                  │                              │  setRemoteDescription
         │                                  │                              │  createAnswer
         │                                  │                              │  setLocalDescription
         │                                  │  ◄────────────────────────   │
         │ ◄─────────────────────────────   │                              │
         │                                  │   kind:20001 {               │
         │  setRemoteDescription(answer)    │     type: "answer",          │
         │                                  │     p: [downloader_pubkey],  │
         │                                  │     content: SDP_answer      │
         │                                  │   }                          │
         │                                  │                              │
         │  ─── ICE candidates ──────────►  │  ──────────────────────────► │
         │  ◄── ICE candidates ───────────  │  ◄────────────────────────── │
         │                                  │                              │
         │ ◄══════════════ RTCDataChannel "entropy" opened ══════════════► │
         │                                  │                              │
         │  encodeChunkRequest(hash)        │                              │
         │ ════════════════════════════════════════════════════════════════►│
         │                                  │                              │ Lookup in IndexedDB
         │  CHUNK_DATA_HEADER + N×64KB      │                              │ sendChunkOverDataChannel
         │◄════════════════════════════════════════════════════════════════ │
         │                                  │                              │
         │  sha256Hex(data) === expected?   │                              │
         │  ✓ Store chunk                   │                              │
         │  ✗ Mark peer as malicious        │                              │
```

**Key implementation modules:**

| Component | Module | Role |
|---|---|---|
| `SignalingChannel` | `core/transport/signaling-channel.ts` | Send/receive SDP + ICE via Nostr kind:20001 |
| `ChunkDownloader` | `core/transport/chunk-downloader.ts` | Orchestrate multi-peer parallel download |
| `PeerManager` | `core/transport/peer-manager.ts` | Track RTCPeerConnection lifecycle |
| `NAT Traversal` | `core/transport/nat-traversal.ts` | ICE server configuration (STUN/TURN) |
| `SignalingListener` | `extension/background/signaling-listener.ts` | Answer incoming offers in SW |
| `ChunkServer` | `extension/background/chunk-server.ts` | Serve chunks over DataChannel |

---

## 7. Chunk Transfer Protocol

Chunks are exchanged over WebRTC DataChannels using a **compact binary protocol** defined in `chunk-transfer.ts`. Because SCTP (the underlying transport for DataChannels) has a practical message size limit of ~256KB, chunks larger than 64KB are **fragmented** before sending and reassembled on the receiver side.

### Message Format

```
 CHUNK_REQUEST (type=0x01)
 ┌──────┬──────────────┬──────────────┬──────────┬────────────────┐
 │ 0x01 │ chunk_hash   │ root_hash    │ pk_len   │ requester_pk   │
 │ 1B   │ 32B (SHA256) │ 32B (SHA256) │ 2B (u16) │ variable       │
 └──────┴──────────────┴──────────────┴──────────┴────────────────┘

 CHUNK_DATA (type=0x02) — used for small chunks (≤64KB)
 ┌──────┬──────────────┬───────────┬─────────────────┐
 │ 0x02 │ chunk_hash   │ data_len  │ chunk_data       │
 │ 1B   │ 32B (SHA256) │ 4B (u32)  │ ≤64KB            │
 └──────┴──────────────┴───────────┴─────────────────┘

 CHUNK_DATA_HEADER (type=0x04) — used for large chunks (>64KB), followed by N fragments
 ┌──────┬──────────────┬────────────┐
 │ 0x04 │ chunk_hash   │ total_len  │
 │ 1B   │ 32B (SHA256) │ 4B (u32)   │
 └──────┴──────────────┴────────────┘
   Followed by ceil(total_len / 64KB) raw binary fragments:
   ┌────────────────────┐
   │ fragment_data      │  Each ≤64KB, sent as separate dc.send() calls
   │ (raw bytes)        │
   └────────────────────┘

 CHUNK_ERROR (type=0x03)
 ┌──────┬──────────────┬─────────┐
 │ 0x03 │ chunk_hash   │ reason  │
 │ 1B   │ 32B (SHA256) │ 1B      │
 └──────┴──────────────┴─────────┘
   reason: 0=NOT_FOUND, 1=INSUFFICIENT_CREDIT, 2=BUSY
```

### Fragmentation & Reassembly

```
 Sender (sendChunkOverDataChannel):
   chunk ≤ 64KB → send as single CHUNK_DATA message
   chunk > 64KB → send CHUNK_DATA_HEADER + N raw 64KB fragments

 Receiver (createChunkReceiver):
   On CHUNK_DATA        → return complete chunk immediately
   On CHUNK_DATA_HEADER → buffer, then accumulate N fragment messages
                          until totalLen bytes received → return complete chunk
```

### Flow Control

```
 Sender checks channel.bufferedAmount before each fragment:
   bufferedAmount ≤ 4MB → send immediately
   bufferedAmount > 4MB → wait for 'bufferedamountlow' event (threshold: 256KB)
```

---

## 8. Credit Economy

Entropy uses a **bandwidth reciprocity system** to incentivize seeding and prevent free-riding.

### Credit Lifecycle

```
 ┌─────────────────────────────────────────────────────────────────┐
 │                      CREDIT LIFECYCLE                           │
 │                                                                 │
 │  ┌───────────┐     ┌─────────────┐     ┌────────────────────┐  │
 │  │  Upload    │     │ Proof of    │     │  Credit Ledger     │  │
 │  │  chunk to  │────►│ Upstream    │────►│                    │  │
 │  │  peer B    │     │ (kind:7772) │     │  direction: "up"   │  │
 │  └───────────┘     │             │     │  bytes: 5242880    │  │
 │                     │  Signed by  │     │  +5MB balance      │  │
 │                     │  receiver   │     └────────────────────┘  │
 │                     └─────────────┘                             │
 │                                                                 │
 │  ┌───────────┐     ┌─────────────┐     ┌────────────────────┐  │
 │  │  Download  │     │ Must have   │     │  Credit Ledger     │  │
 │  │  chunk    │◄────│ positive    │◄────│                    │  │
 │  │  from peer│     │ balance     │     │  direction: "down"  │  │
 │  └───────────┘     └─────────────┘     │  bytes: 5242880    │  │
 │                                         │  -5MB balance      │  │
 │                                         └────────────────────┘  │
 └─────────────────────────────────────────────────────────────────┘
```

### Proof of Upstream (kind:7772)

When peer A serves a chunk to peer B, peer B signs a **receipt** that proves A uploaded data:

```
 Peer A (seeder)                              Peer B (downloader)
 ───────────────                              ───────────────────
       │                                              │
       │  ══════ chunk data (5MB) ══════════════════► │
       │                                              │  Verify SHA-256
       │                                              │  Draft receipt:
       │                                              │    kind: 7772
       │                                              │    tags:
       │                                              │      ["p", seeder_pk]
       │                                              │      ["x", chunk_hash]
       │                                              │      ["bytes", "5242880"]
       │                                              │      ["receipt", timestamp]
       │                                              │  Sign with own key
       │  ◄════ signed receipt (via DataChannel) ════ │
       │                                              │
       │  Validate receipt:                           │
       │  - Check signature                           │
       │  - Check timestamp (±30min window)           │
       │  - Store in credit ledger                    │
       │    → direction: "up", +5MB                   │
       │                                              │
```

### Credit Gating

Before serving a chunk, the seeder checks the requester's credit balance:

```
 Incoming CHUNK_REQUEST
         │
         ▼
 ┌─────────────────────┐
 │ Check requester's   │
 │ credit balance      │
 │                     │
 │ balance > 0?        │
 │   YES → serve chunk │
 │   NO  → send error  │
 │         reason: 1    │   (INSUFFICIENT_CREDIT)
 └─────────────────────┘
```

### Cold Storage & Premium Credits

Users with high upload ratios are eligible for **cold storage custody** — storing unpopular chunks to earn premium credits:

```
 ┌────────────────────────────────────────────────────────┐
 │  Cold Storage Eligibility                              │
 │                                                        │
 │  ratio ≥ 2.0 AND entryCount > 0 AND uploaded > 0     │
 │     → isEligibleForColdStorage() = true               │
 │                                                        │
 │  Assigned cold chunks:                                │
 │  - ColdChunkAssignment {                              │
 │      chunkHash, rootHash,                             │
 │      assignedAt, expiresAt,                           │
 │      premiumCredits                                   │
 │    }                                                  │
 │                                                        │
 │  premiumCredits = days × replicationFactor             │
 │                   × premiumMultiplier                  │
 │                                                        │
 │  Benefits:                                            │
 │  - Priority bandwidth for popular content             │
 │  - Higher download speed tier                         │
 └────────────────────────────────────────────────────────┘
```

### Credit Summary (displayed in web CreditPanel + extension popup)

```
 {
   totalUploaded:  10,485,760    (10 MB)
   totalDownloaded: 5,242,880    ( 5 MB)
   ratio:           2.0
   balance:         5,242,880    ( 5 MB available)
   entryCount:      4
   coldStorageEligible: true
 }
```

---

## 9. Storage & Quota Management

### IndexedDB Schema (Dexie.js)

```
 ┌─────────────────────────────────────────────────────────┐
 │  IndexedDB: "entropy-chunks"                            │
 │                                                         │
 │  chunks table:                                         │
 │  ┌─────────┬────────────┬──────────┬───────┬─────────┐ │
 │  │ hash    │ data       │ rootHash │ index │ pinned  │ │
 │  │ (PK)   │ Uint8Array │ string   │ num   │ boolean │ │
 │  │ SHA-256 │ ≤5MB       │          │       │         │ │
 │  ├─────────┼────────────┼──────────┼───────┼─────────┤ │
 │  │ lastAccessed: number (timestamp for LRU)           │ │
 │  └────────────────────────────────────────────────────┘ │
 └─────────────────────────────────────────────────────────┘
```

### Quota Manager Flow

```
 ┌──────────────────────────────────────────────────────┐
 │  QuotaManager                                        │
 │                                                      │
 │  getQuotaInfo():                                     │
 │    navigator.storage.estimate()                      │
 │    OR store.getStoreSize() (fallback)                │
 │    → { used, available, limit }                      │
 │                                                      │
 │  isWithinQuota(additionalBytes):                     │
 │    used + additionalBytes ≤ limit?                   │
 │                                                      │
 │  evictLRU(bytesToFree):                              │
 │    1. List all non-pinned chunks                     │
 │    2. Sort by lastAccessed (oldest first)            │
 │    3. Delete chunks until freed ≥ bytesToFree        │
 │    → Returns actual bytes freed                      │
 │                                                      │
 │  Never evict:                                        │
 │  ✗ pinned chunks (user-flagged)                      │
 │  ✗ chunks with active cold storage custody           │
 └──────────────────────────────────────────────────────┘

 Default limit: 2 GB (configurable in Settings)
```

---

## 10. Identity & Authentication

### NIP-07 Flow (Web App)

```
 User clicks "Connect Wallet"
         │
         ▼
 ┌──────────────────────────────────┐
 │ useNostrIdentity hook            │
 │                                  │
 │ 1. Try extension bridge:        │
 │    getExtensionPublicKey()       │
 │    → postMessage GET_PUBLIC_KEY  │
 │    → returns pubkey or null      │
 │                                  │
 │ 2. Fallback to NIP-07:          │
 │    window.nostr.getPublicKey()   │
 │    → returns pubkey              │
 │                                  │
 │ 3. Store in entropy-store:       │
 │    setIdentity(pubkey)           │
 │    → initRelays(DEFAULT_URLS)    │
 │                                  │
 │ 4. Load profile:                 │
 │    useNostrProfile(pubkey)       │
 │    → subscribe kind:0            │
 │    → parse { name, picture, ... }│
 └──────────────────────────────────┘
```

### Extension Identity

```
 Extension Service Worker
         │
         ▼
 ┌──────────────────────────────────┐
 │  identity-store.ts               │
 │                                  │
 │  Keypair persisted in            │
 │  chrome.storage.local            │
 │                                  │
 │  GET_PUBLIC_KEY → return pubkey  │
 │  IMPORT_KEYPAIR → store privkey  │
 │    → derive pubkey               │
 │    → persist to chrome.storage   │
 └──────────────────────────────────┘
```

---

## Summary: Complete Upload → View Lifecycle

```
 ┌─────────┐   chunk    ┌───────────┐  kind:7001  ┌─────────┐
 │  User A │──────────►│ Extension │────────────►│  Nostr  │
 │  (Web)  │  + store   │   (SW)    │  publish     │  Relays │
 └─────────┘  + seed    └─────┬─────┘              └────┬────┘
                              │                         │
                              │ WebRTC seeding          │ kind:7001
                              │                         │ event
                              ▼                         ▼
                        ┌───────────┐          ┌─────────────┐
                        │  WebRTC   │          │   User B    │
                        │  P2P      │◄─────────│   (Web)     │
                        │  Channel  │ request  │   Feed sees │
                        │           │ chunks   │   post      │
                        │           │─────────►│             │
                        └───────────┘ verified │  ▶ Play     │
                                      chunks   │  inline     │
                                               └─────────────┘
```
