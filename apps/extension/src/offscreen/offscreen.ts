// Offscreen document — Chrome only. Uses chrome.* APIs directly (no polyfill).
import {
  RelayPool,
  createIndexedDbChunkStore,
  signEvent,
  type NostrEventDraft,
  type NostrKeypair,
  type ChunkStore
} from "@entropy/core";
import { startSignalingListener } from "../background/signaling-listener";
import { handleDataChannel } from "../background/chunk-server";
import { fetchChunkFromPeer } from "../background/peer-fetch";
import { logger } from "@entropy/core";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let identity: NostrKeypair | null = null;
let relayPool: RelayPool | null = null;
let chunkStore: ChunkStore | null = null;
let stopSignaling: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

interface P2PInitMessage {
  type: "P2P_INIT";
  relayUrls: string[];
  pubkey: string;
  privkey: string;
}

interface P2PFetchChunkMessage {
  type: "P2P_FETCH_CHUNK";
  requestId: string;
  chunkHash: string;
  rootHash: string;
  gatekeeperPubkey: string;
}

type P2PMessage = P2PInitMessage | P2PFetchChunkMessage;

function isP2PMessage(msg: unknown): msg is P2PMessage {
  return !!msg && typeof msg === "object" && "type" in msg &&
    typeof (msg as { type: unknown }).type === "string" &&
    (msg as { type: string }).type.startsWith("P2P_");
}

// ---------------------------------------------------------------------------
// Signing helper
// ---------------------------------------------------------------------------

function signNostrEvent(draft: NostrEventDraft) {
  if (!identity) throw new Error("[offscreen] Identity not initialized");
  return signEvent(draft, identity.privkey);
}

// ---------------------------------------------------------------------------
// Delegated root hashes (for canServeRoot) — asks service worker via messaging
// ---------------------------------------------------------------------------

async function canServeRoot(rootHash: string): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "CHECK_CAN_SERVE_ROOT",
      rootHash
    }) as { canServe?: boolean };
    return response?.canServe === true;
  } catch {
    return false;
  }
}

async function authorizeChunkRequest(request: {
  peerPubkey: string;
  chunkHash: string;
  rootHash: string;
  requestedBytes: number;
}): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "CHECK_CHUNK_AUTH",
      ...request
    }) as { authorized?: boolean };

    return response?.authorized === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Init — start seeding
// ---------------------------------------------------------------------------

async function handleInit(msg: P2PInitMessage): Promise<void> {
  logger.log("[offscreen] P2P_INIT with relays:", msg.relayUrls);

  // If already initialized with the same identity, skip re-init to avoid
  // tearing down active PeerConnections mid-handshake.
  if (identity && identity.pubkey === msg.pubkey && relayPool && stopSignaling) {
    logger.log("[offscreen] already seeding with same identity, skipping re-init");
    return;
  }

  identity = { pubkey: msg.pubkey, privkey: msg.privkey };
  logger.log("[offscreen] identity received:", identity.pubkey.slice(0, 8) + "…");

  chunkStore = createIndexedDbChunkStore();

  relayPool = new RelayPool();
  relayPool.connect(msg.relayUrls);

  stopSignaling?.();
  stopSignaling = startSignalingListener(
    relayPool,
    identity.pubkey,
    (peerPubkey, channel) => {
      logger.log("[offscreen] peer connected for seeding:", peerPubkey.slice(0, 8) + "…");
      handleDataChannel(
        channel,
        peerPubkey,
        chunkStore!,
        async (chunkHash, bytes, receiptSig) => {
          logger.log("[offscreen] served chunk", chunkHash.slice(0, 12) + "…", bytes, "bytes to", peerPubkey.slice(0, 8) + "…");
          chrome.runtime.sendMessage({
            type: "P2P_CHUNK_SERVED",
            chunkHash,
            peerPubkey,
            bytes,
            receiptSig
          }).catch(() => { /* ignore */ });
        },
        {
          authorizeRequest: authorizeChunkRequest,
          signEvent: signNostrEvent,
          myPubkey: identity!.pubkey
        }
      );
    },
    { canServeRoot, signEvent: signNostrEvent }
  );

  logger.log("[offscreen] seeding started");
}

// ---------------------------------------------------------------------------
// Fetch chunk from peer
// ---------------------------------------------------------------------------

async function handleFetchChunk(msg: P2PFetchChunkMessage): Promise<{ data: number[] } | null> {
  if (!identity || !relayPool) {
    logger.warn("[offscreen] not initialized, cannot fetch chunk");
    return null;
  }

  logger.log("[offscreen] fetching chunk", msg.chunkHash.slice(0, 12) + "…", "from", msg.gatekeeperPubkey.slice(0, 8) + "…");

  const result = await fetchChunkFromPeer({
    chunkHash: msg.chunkHash,
    rootHash: msg.rootHash,
    gatekeeperPubkey: msg.gatekeeperPubkey,
    myPubkey: identity.pubkey,
    relayPool,
    signEvent: signNostrEvent,
    onPeerFailedVerification: async (peerPubkey) => {
      chrome.runtime.sendMessage({
        type: "P2P_PEER_FAILED_VERIFICATION",
        peerPubkey
      }).catch(() => {
        // ignore if SW is not ready
      });
    }
  });

  if (!result) {
    logger.warn("[offscreen] fetch returned null");
    return null;
  }

  logger.log("[offscreen] fetched chunk", msg.chunkHash.slice(0, 12) + "…", result.data.byteLength, "bytes");

  // Cache in IndexedDB
  if (chunkStore) {
    await chunkStore.storeChunk({
      hash: result.hash,
      rootHash: result.rootHash,
      index: 0,
      data: result.data,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      pinned: false
    });
  }

  return { data: Array.from(new Uint8Array(result.data)) };
}

// ---------------------------------------------------------------------------
// Message listener — uses chrome.runtime directly
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void): boolean | undefined => {
    if (!isP2PMessage(message)) return;

    if (message.type === "P2P_INIT") {
      handleInit(message)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          logger.error("[offscreen] P2P_INIT error:", err);
          sendResponse({ ok: false, error: String(err) });
        });
      return true; // keep channel open for async response
    }

    if (message.type === "P2P_FETCH_CHUNK") {
      handleFetchChunk(message)
        .then((result) => sendResponse({
          ok: true,
          requestId: message.requestId,
          data: result?.data ?? null
        }))
        .catch((err) => {
          logger.error("[offscreen] P2P_FETCH_CHUNK error:", err);
          sendResponse({ ok: false, requestId: message.requestId, data: null });
        });
      return true; // keep channel open for async response
    }

    return undefined;
  }
);

logger.log("[offscreen] offscreen document loaded");
