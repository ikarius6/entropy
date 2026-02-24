import browser from "webextension-polyfill";
import type { ChunkStore } from "@entropy/core";
import { logger } from "@entropy/core";
import type { SignEventFn, RelayPool } from "@entropy/core";
import { startSignalingListener } from "./signaling-listener";
import { handleDataChannel } from "./chunk-server";
import { fetchChunkFromPeer, type PeerChunkResult } from "./peer-fetch";
export type { PeerChunkResult } from "./peer-fetch";

// ---------------------------------------------------------------------------
// Detect WebRTC availability (Chrome service workers lack RTCPeerConnection)
// ---------------------------------------------------------------------------

const hasWebRTC = typeof globalThis.RTCPeerConnection === "function";

// ---------------------------------------------------------------------------
// Offscreen document management (Chrome only)
// ---------------------------------------------------------------------------

const OFFSCREEN_URL = "offscreen.html";

let offscreenCreated = false;

async function ensureOffscreenDocument(): Promise<void> {
  if (offscreenCreated) return;

  // chrome.offscreen is not in webextension-polyfill; use the raw API
  const chromeGlobal = globalThis as unknown as {
    chrome?: {
      offscreen?: {
        createDocument(params: {
          url: string;
          reasons: string[];
          justification: string;
        }): Promise<void>;
        hasDocument(): Promise<boolean>;
      };
    };
  };

  const offscreen = chromeGlobal.chrome?.offscreen;
  if (!offscreen) {
    logger.warn("[p2p-bridge] chrome.offscreen API not available");
    return;
  }

  const exists = await offscreen.hasDocument();
  if (exists) {
    offscreenCreated = true;
    return;
  }

  await offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["WEB_RTC"],
    justification: "WebRTC peer connections for P2P chunk transfer"
  });

  offscreenCreated = true;
  logger.log("[p2p-bridge] offscreen document created");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface P2PBridgeOptions {
  relayPool: RelayPool;
  relayUrls: string[];
  myPubkey: string;
  privkeyHex: string;
  chunkStore: ChunkStore;
  signEvent: SignEventFn;
  onChunkServed?: (chunkHash: string, peerPubkey: string, bytes: number) => void;
  authorizeChunkRequest?: (request: {
    peerPubkey: string;
    chunkHash: string;
    rootHash: string;
    requestedBytes: number;
  }) => boolean | Promise<boolean>;
}

let stopDirectSignaling: (() => void) | null = null;

/**
 * Start the P2P seeding layer.
 * On Firefox (has WebRTC): runs signaling listener directly.
 * On Chrome (no WebRTC in SW): delegates to offscreen document.
 */
export async function startP2PSeeding(options: P2PBridgeOptions): Promise<void> {
  logger.log("[p2p-bridge] hasWebRTC:", hasWebRTC, "typeof RTCPeerConnection:", typeof globalThis.RTCPeerConnection);
  if (hasWebRTC) {
    // Firefox: run directly in background script
    logger.log("[p2p-bridge] starting seeding directly (WebRTC available)");
    stopDirectSignaling?.();
    stopDirectSignaling = startSignalingListener(
      options.relayPool,
      options.myPubkey,
      (peerPubkey, channel) => {
        handleDataChannel(
          channel,
          peerPubkey,
          options.chunkStore,
          async (chunkHash, bytes) => {
            options.onChunkServed?.(chunkHash, peerPubkey, bytes);
          },
          {
            authorizeRequest: options.authorizeChunkRequest
          }
        );
      },
      {
        canServeRoot: async (rootHash: string) => {
          // Check delegatedContent store first (active delegations)
          const result = await browser.storage.local.get("delegatedContent");
          const store = result["delegatedContent"];
          if (store && typeof store === "object" && rootHash in (store as Record<string, unknown>)) {
            return true;
          }
          // Fallback: check if chunks for this rootHash exist in IndexedDB
          // (delegations may have been pruned but chunks are still stored)
          const chunks = await options.chunkStore.listChunksByRoot(rootHash);
          return chunks.length > 0;
        },
        signEvent: options.signEvent
      }
    );
  } else {
    // Chrome: delegate to offscreen document
    logger.log("[p2p-bridge] starting seeding via offscreen document");
    await ensureOffscreenDocument();
    await browser.runtime.sendMessage({
      type: "P2P_INIT",
      relayUrls: options.relayUrls,
      pubkey: options.myPubkey,
      privkey: options.privkeyHex
    });
  }
}

/**
 * Fetch a single chunk from a gatekeeper peer.
 * On Firefox: runs WebRTC directly.
 * On Chrome: delegates to offscreen document.
 */
export async function fetchChunkP2P(params: {
  chunkHash: string;
  rootHash: string;
  gatekeeperPubkey: string;
  myPubkey: string;
  relayPool: RelayPool;
  signEvent: SignEventFn;
  isPeerBanned?: (peerPubkey: string) => boolean | Promise<boolean>;
  onPeerTransferSuccess?: (peerPubkey: string, bytes: number) => void | Promise<void>;
  onPeerFailedVerification?: (peerPubkey: string) => void | Promise<void>;
}): Promise<PeerChunkResult | null> {
  logger.log("[p2p-bridge] fetchChunkP2P called, hasWebRTC:", hasWebRTC, "chunk:", params.chunkHash.slice(0, 12) + "…", "gatekeeper:", params.gatekeeperPubkey.slice(0, 8) + "…");

  const banned = await Promise.resolve(params.isPeerBanned?.(params.gatekeeperPubkey) ?? false);
  if (banned) {
    logger.log("[p2p-bridge] skipping banned gatekeeper", params.gatekeeperPubkey.slice(0, 8) + "…");
    return null;
  }

  if (hasWebRTC) {
    // Firefox: run directly
    logger.log("[p2p-bridge] calling fetchChunkFromPeer directly (Firefox path)");
    const result = await fetchChunkFromPeer(params);
    logger.log("[p2p-bridge] fetchChunkFromPeer result:", result ? `ok ${result.data.byteLength} bytes` : "null");
    return result;
  }

  // Chrome: delegate to offscreen document
  logger.log("[p2p-bridge] delegating to offscreen document (Chrome path)");
  await ensureOffscreenDocument();

  const requestId = `fetch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  logger.log("[p2p-bridge] sending P2P_FETCH_CHUNK to offscreen, requestId:", requestId);
  const response = await browser.runtime.sendMessage({
    type: "P2P_FETCH_CHUNK",
    requestId,
    chunkHash: params.chunkHash,
    rootHash: params.rootHash,
    gatekeeperPubkey: params.gatekeeperPubkey
  }) as { ok?: boolean; data?: number[] | null } | undefined;

  logger.log("[p2p-bridge] offscreen response:", response ? JSON.stringify(response).slice(0, 200) : "undefined");

  if (!response || !response.ok || !response.data) {
    return null;
  }

  const buffer = new Uint8Array(response.data).buffer;
  await Promise.resolve(params.onPeerTransferSuccess?.(params.gatekeeperPubkey, buffer.byteLength)).catch(
    (err) => {
      logger.warn("[p2p-bridge] failed to record peer success:", err);
    }
  );

  return {
    hash: params.chunkHash,
    rootHash: params.rootHash,
    data: buffer,
    peerPubkey: params.gatekeeperPubkey
  };
}

/**
 * Stop P2P seeding.
 */
export function stopP2PSeeding(): void {
  stopDirectSignaling?.();
  stopDirectSignaling = null;
}
