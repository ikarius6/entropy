import browser from "webextension-polyfill";
import {
  ENTROPY_SIGNALING_KIND_MAX,
  ENTROPY_SIGNALING_KIND_MIN,
  createIndexedDbChunkStore,
  isEntropySignalingKind,
  verifyEventSignature,
  wireReceiptVerifier,
  logger
} from "@entropy/core";

import {
  createEntropyRequestId,
  type CreditSummaryPayload,
  ENTROPY_EXTENSION_SOURCE,
  isEntropyRuntimePushMessage,
  isEntropyRuntimeMessage,
  type EntropyRuntimePushMessage,
  type EntropyRuntimeMessage,
  type EntropyRuntimeResponse,
  type NodeSettingsPayload,
  type NodeStatusPayload,
  type PublicKeyPayload,
  type SignedEventPayload,
  type ChunkDataPayload
} from "../shared/messaging";
import { hasDelegatedChunks, storeChunkPayload } from "./chunk-ingest";
import { getCreditSummary, recordUploadCredit, recordDownloadCredit } from "./credit-ledger";
import { getOrCreateKeypair, getPublicKey, importKeypair, signNostrEvent } from "./identity-store";
import { startP2PSeeding, fetchChunkP2P } from "./p2p-bridge";
import type { PeerChunkResult } from "./p2p-bridge";

const inflightP2PFetches = new Map<string, Promise<PeerChunkResult | null>>();
import {
  addRelay,
  ensureRelayConnections,
  getRelayPool,
  getRelayStatuses,
  getRelayUrls,
  getSeedingActive,
  initRelayManager,
  removeRelay,
  setSeedingActive
} from "./relay-manager";
import { enqueueDelegation, getDelegationCount, getDelegatedRootHashes, pruneDelegations } from "./seeder";
import { scheduleMaintenance } from "./scheduler";

const KEEP_ALIVE_ALARM_NAME = "entropy-keepalive";
const KEEP_ALIVE_ALARM_PERIOD_MINUTES = 1;

const chunkStore = createIndexedDbChunkStore();
const startedAt = Date.now();

let lastHeartbeatAt = startedAt;
let bootstrapPromise: Promise<void> | null = null;

wireReceiptVerifier((event) => verifyEventSignature(event));

async function buildNodeStatus(): Promise<NodeStatusPayload> {
  const [delegatedCount, delegatedRootHashes] = await Promise.all([
    getDelegationCount(),
    getDelegatedRootHashes()
  ]);

  return {
    delegatedCount,
    delegatedRootHashes,
    uptimeMs: Date.now() - startedAt,
    lastHeartbeatAt,
    signalingKindRange: `${ENTROPY_SIGNALING_KIND_MIN}-${ENTROPY_SIGNALING_KIND_MAX}`,
    signalingRangeHealthy:
      isEntropySignalingKind(ENTROPY_SIGNALING_KIND_MIN) &&
      isEntropySignalingKind(ENTROPY_SIGNALING_KIND_MAX)
  };
}

function signedEventResponse(
  requestId: string,
  payload: SignedEventPayload
): EntropyRuntimeResponse {
  return { ok: true, requestId, type: "SIGN_EVENT", payload };
}

function chunkDataResponse(
  requestId: string,
  payload: ChunkDataPayload | null
): EntropyRuntimeResponse {
  return { ok: true, requestId, type: "GET_CHUNK", payload };
}

function successResponse(
  requestId: string,
  type: "DELEGATE_SEEDING" | "GET_NODE_STATUS" | "HEARTBEAT" | "STORE_CHUNK",
  payload?: NodeStatusPayload
): EntropyRuntimeResponse {
  return { ok: true, requestId, type, payload };
}

function creditResponse(
  requestId: string,
  type: "GET_CREDIT_SUMMARY" | "SERVE_CHUNK",
  payload: CreditSummaryPayload
): EntropyRuntimeResponse {
  return { ok: true, requestId, type, payload };
}

function pubkeyResponse(
  requestId: string,
  type: "IMPORT_KEYPAIR" | "GET_PUBLIC_KEY",
  payload: PublicKeyPayload
): EntropyRuntimeResponse {
  return { ok: true, requestId, type, payload };
}

function nodeSettingsResponse(
  requestId: string,
  type: "GET_NODE_SETTINGS" | "ADD_RELAY" | "REMOVE_RELAY" | "SET_SEEDING_ACTIVE",
  payload: NodeSettingsPayload
): EntropyRuntimeResponse {
  return { ok: true, requestId, type, payload };
}

function errorResponse(
  requestId: string,
  type: EntropyRuntimeMessage["type"],
  error: string
): EntropyRuntimeResponse {
  return {
    ok: false,
    requestId,
    type,
    error
  };
}

function emitNodeStatusUpdate(status: NodeStatusPayload): void {
  const update: EntropyRuntimePushMessage = {
    source: ENTROPY_EXTENSION_SOURCE,
    type: "NODE_STATUS_UPDATE",
    payload: status
  };

  void browser.runtime.sendMessage(update).catch(() => {
    // Ignore when there are no listeners yet.
  });
}

function emitCreditUpdate(summary: CreditSummaryPayload): void {
  const update: EntropyRuntimePushMessage = {
    source: ENTROPY_EXTENSION_SOURCE,
    type: "CREDIT_UPDATE",
    payload: summary
  };

  void browser.runtime.sendMessage(update).catch(() => {
    // Ignore when there are no listeners yet.
  });
}

async function bootstrapBackground(): Promise<void> {
  const identity = await getOrCreateKeypair();

  await initRelayManager();

  const relayUrls = await getRelayUrls();

  await startP2PSeeding({
    relayPool: getRelayPool(),
    relayUrls,
    myPubkey: identity.pubkey,
    privkeyHex: identity.privkey,
    chunkStore,
    signEvent: signNostrEvent,
    onChunkServed: async (chunkHash, peerPubkey, bytes) => {
      const updatedSummary = await recordUploadCredit({
        peerPubkey,
        bytes,
        chunkHash,
        receiptSignature: `rtc-upload:${chunkHash}:${Date.now()}`,
        timestamp: Math.floor(Date.now() / 1000)
      });

      emitCreditUpdate(updatedSummary);
    }
  });

  browser.alarms.create(KEEP_ALIVE_ALARM_NAME, {
    periodInMinutes: KEEP_ALIVE_ALARM_PERIOD_MINUTES
  });
}

async function ensureBootstrap(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapBackground().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }

  await bootstrapPromise;
}

function scheduleBootstrap(): void {
  void ensureBootstrap().catch(() => {
    // Best-effort bootstrap. The next incoming message/alarm will retry.
  });
}

browser.runtime.onInstalled.addListener(() => {
  scheduleMaintenance();
  scheduleBootstrap();
});

browser.runtime.onStartup.addListener(() => {
  scheduleBootstrap();
});

browser.alarms.onAlarm.addListener((alarm: { name: string }) => {
  if (alarm.name !== KEEP_ALIVE_ALARM_NAME) {
    return;
  }

  void (async () => {
    await ensureBootstrap();
    await ensureRelayConnections();
  })();
});

browser.runtime.onMessage.addListener(
  (message: unknown): undefined | Promise<EntropyRuntimeResponse> => {
    // Handle canServeRoot check from offscreen document
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      (message as { type: string }).type === "CHECK_CAN_SERVE_ROOT"
    ) {
      const rootHash = (message as unknown as { rootHash: string }).rootHash;
      return getDelegatedRootHashes().then((hashes) => ({
        canServe: hashes.includes(rootHash)
      })) as Promise<unknown> as Promise<EntropyRuntimeResponse>;
    }

    // Handle P2P messages from offscreen document (credit tracking)
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      (message as { type: string }).type === "P2P_CHUNK_SERVED"
    ) {
      const msg = message as unknown as { chunkHash: string; peerPubkey: string; bytes: number };
      void recordUploadCredit({
        peerPubkey: msg.peerPubkey,
        bytes: msg.bytes,
        chunkHash: msg.chunkHash,
        receiptSignature: `rtc-upload:${msg.chunkHash}:${Date.now()}`,
        timestamp: Math.floor(Date.now() / 1000)
      }).then(emitCreditUpdate);
      return;
    }

    if (isEntropyRuntimePushMessage(message)) {
      return;
    }

    if (!isEntropyRuntimeMessage(message)) {
      return Promise.resolve(
        errorResponse(createEntropyRequestId("invalid"), "HEARTBEAT", "Invalid Entropy runtime message.")
      );
    }

    return (async (): Promise<EntropyRuntimeResponse> => {
      try {
        await ensureBootstrap();

        switch (message.type) {
          case "DELEGATE_SEEDING": {
            const availability = await hasDelegatedChunks(chunkStore, message.payload.chunkHashes);

            if (!availability.ok) {
              throw new Error(
                `Missing delegated chunks in IndexedDB: ${availability.missing.join(", ") || "unknown"}.`
              );
            }

            await enqueueDelegation(message.payload);

            const creditSummary = await recordUploadCredit({
              peerPubkey: "self",
              bytes: message.payload.size,
              chunkHash: message.payload.rootHash,
              receiptSignature: `delegate:${message.requestId}`,
              timestamp: Math.floor(Date.now() / 1000)
            });

            const status = await buildNodeStatus();
            emitNodeStatusUpdate(status);
            emitCreditUpdate(creditSummary);
            return successResponse(message.requestId, message.type, status);
          }

          case "GET_CHUNK": {
            logger.log("[GET_CHUNK] received payload:", JSON.stringify(message.payload).slice(0, 300));
            const stored = await chunkStore.getChunk(message.payload.hash);
            logger.log("[GET_CHUNK] local store result:", stored ? `found (${stored.data.byteLength} bytes)` : "NOT FOUND");
            if (stored) {
              return chunkDataResponse(message.requestId, {
                hash: stored.hash,
                rootHash: stored.rootHash,
                index: stored.index,
                data: Array.from(new Uint8Array(stored.data))
              });
            }

            // Fallback: try to fetch from a gatekeeper peer via WebRTC
            const { rootHash: reqRootHash, gatekeepers } = message.payload;
            logger.log("[GET_CHUNK] P2P fallback check — rootHash:", reqRootHash?.slice(0, 12), "gatekeepers:", gatekeepers);
            if (!reqRootHash || !gatekeepers || gatekeepers.length === 0) {
              logger.log("[GET_CHUNK] no gatekeepers, returning null");
              return chunkDataResponse(message.requestId, null);
            }

            const identity = await getOrCreateKeypair();
            const pool = getRelayPool();
            logger.log("[GET_CHUNK] my pubkey:", identity.pubkey.slice(0, 8) + "…", "gatekeepers to try:", gatekeepers.length);

            const dedupeKey = message.payload.hash;
            let p2pPromise = inflightP2PFetches.get(dedupeKey);
            if (p2pPromise) {
              logger.log("[GET_CHUNK] reusing in-flight P2P fetch for", dedupeKey.slice(0, 12) + "…");
            } else {
              p2pPromise = (async (): Promise<PeerChunkResult | null> => {
                for (const gk of gatekeepers) {
                  if (gk === identity.pubkey) {
                    logger.log("[GET_CHUNK] skipping self as gatekeeper");
                    continue;
                  }
                  try {
                    logger.log(`[GET_CHUNK] fetching ${message.payload.hash.slice(0, 12)}… from peer ${gk.slice(0, 8)}…`);
                    const peerResult = await fetchChunkP2P({
                      chunkHash: message.payload.hash,
                      rootHash: reqRootHash,
                      gatekeeperPubkey: gk,
                      myPubkey: identity.pubkey,
                      relayPool: pool,
                      signEvent: signNostrEvent
                    });
                    if (peerResult) return peerResult;
                  } catch (err) {
                    logger.warn(`[GET_CHUNK] peer fetch from ${gk.slice(0, 8)}… failed:`, err);
                  }
                }
                return null;
              })();
              inflightP2PFetches.set(dedupeKey, p2pPromise);
            }

            try {
              const peerResult = await p2pPromise;
              if (peerResult) {
                await chunkStore.storeChunk({
                  hash: peerResult.hash,
                  rootHash: peerResult.rootHash,
                  index: 0,
                  data: peerResult.data,
                  createdAt: Date.now(),
                  lastAccessed: Date.now(),
                  pinned: false
                });

                return chunkDataResponse(message.requestId, {
                  hash: peerResult.hash,
                  rootHash: peerResult.rootHash,
                  index: 0,
                  data: Array.from(new Uint8Array(peerResult.data))
                });
              }
            } finally {
              inflightP2PFetches.delete(dedupeKey);
            }

            return chunkDataResponse(message.requestId, null);
          }

          case "SIGN_EVENT": {
            const signed = await signNostrEvent(message.payload);
            return signedEventResponse(message.requestId, signed);
          }

          case "STORE_CHUNK": {
            await storeChunkPayload(chunkStore, message.payload);
            const status = await buildNodeStatus();
            emitNodeStatusUpdate(status);
            return successResponse(message.requestId, message.type, status);
          }

          case "IMPORT_KEYPAIR": {
            const payload = await importKeypair(message.payload.privkey);
            bootstrapPromise = null;
            await ensureBootstrap();
            return pubkeyResponse(message.requestId, message.type, payload);
          }

          case "GET_PUBLIC_KEY": {
            const pubkey = await getPublicKey();
            return pubkeyResponse(message.requestId, message.type, { pubkey });
          }

          case "GET_CREDIT_SUMMARY": {
            const summary = await getCreditSummary();
            emitCreditUpdate(summary);
            return creditResponse(message.requestId, message.type, summary);
          }

          case "GET_NODE_STATUS": {
            const status = await buildNodeStatus();
            emitNodeStatusUpdate(status);
            return successResponse(message.requestId, message.type, status);
          }

          case "HEARTBEAT": {
            lastHeartbeatAt = Date.now();
            await pruneDelegations();
            await ensureRelayConnections();

            const status = await buildNodeStatus();
            emitNodeStatusUpdate(status);
            return successResponse(message.requestId, message.type, status);
          }

          case "SERVE_CHUNK": {
            const summary = await getCreditSummary();
            const currentBalance = summary.balance;

            if (currentBalance < message.payload.requestedBytes) {
              return errorResponse(message.requestId, message.type, "INSUFFICIENT_CREDIT");
            }

            const updatedSummary = await recordDownloadCredit({
              peerPubkey: message.payload.peerPubkey,
              bytes: message.payload.requestedBytes,
              chunkHash: message.payload.chunkHash,
              receiptSignature: `serve:${message.requestId}`,
              timestamp: Math.floor(Date.now() / 1000)
            });

            emitCreditUpdate(updatedSummary);
            return creditResponse(message.requestId, message.type, updatedSummary);
          }

          case "GET_NODE_SETTINGS": {
            const [relayUrls, seedingActive] = await Promise.all([
              getRelayUrls(),
              getSeedingActive()
            ]);
            const relayStatuses = getRelayStatuses().map((info) => ({
              url: info.url,
              status: info.status
            }));
            return nodeSettingsResponse(message.requestId, message.type, {
              relayUrls,
              relayStatuses,
              seedingActive
            });
          }

          case "ADD_RELAY": {
            await addRelay(message.payload.url);
            const [relayUrls, seedingActive] = await Promise.all([
              getRelayUrls(),
              getSeedingActive()
            ]);
            const relayStatuses = getRelayStatuses().map((info) => ({
              url: info.url,
              status: info.status
            }));
            return nodeSettingsResponse(message.requestId, message.type, {
              relayUrls,
              relayStatuses,
              seedingActive
            });
          }

          case "REMOVE_RELAY": {
            await removeRelay(message.payload.url);
            const [relayUrls, seedingActive] = await Promise.all([
              getRelayUrls(),
              getSeedingActive()
            ]);
            const relayStatuses = getRelayStatuses().map((info) => ({
              url: info.url,
              status: info.status
            }));
            return nodeSettingsResponse(message.requestId, message.type, {
              relayUrls,
              relayStatuses,
              seedingActive
            });
          }

          case "SET_SEEDING_ACTIVE": {
            await setSeedingActive(message.payload.active);
            const [relayUrls, seedingActiveNow] = await Promise.all([
              getRelayUrls(),
              getSeedingActive()
            ]);
            const relayStatuses = getRelayStatuses().map((info) => ({
              url: info.url,
              status: info.status
            }));
            return nodeSettingsResponse(message.requestId, message.type, {
              relayUrls,
              relayStatuses,
              seedingActive: seedingActiveNow
            });
          }

        }
      } catch (caughtError) {
        const messageText =
          caughtError instanceof Error ? caughtError.message : "Unknown extension runtime failure.";
        return errorResponse(message.requestId, message.type, messageText);
      }
    })();
  }
);

scheduleBootstrap();
