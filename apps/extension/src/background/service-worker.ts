import browser from "webextension-polyfill";
import {
  buildSeederAnnouncementEvent,
  discoverSeeders,
  ENTROPY_SIGNALING_KIND_MAX,
  ENTROPY_SIGNALING_KIND_MIN,
  createIndexedDbChunkStore,
  createIndexedDbPeerReputationStore,
  createTagStore,
  isEntropySignalingKind,
  verifyEventSignature,
  wireReceiptVerifier,
  logger
} from "@entropy/core";

import {
  type ColdStorageStatusPayload,
  createEntropyRequestId,
  type CreditSummaryPayload,
  ENTROPY_EXTENSION_SOURCE,
  isEntropyRuntimePushMessage,
  isEntropyRuntimeMessage,
  type EntropyRuntimePushMessage,
  type EntropyRuntimeMessage,
  type EntropyRuntimeResponse,
  type NodeMetricsPayload,
  type NodeSettingsPayload,
  type NodeStatusPayload,
  type PublicKeyPayload,
  type ExportIdentityPayload,
  type SignedEventPayload,
  type ChunkDataPayload,
  type TagContentResultPayload
} from "../shared/messaging";
import { hasDelegatedChunks, storeChunkPayload, addContentTagFromUser } from "./chunk-ingest";
import { getCreditSummary, recordUploadCredit, recordDownloadCredit } from "./credit-ledger";
import { exportIdentity, getOrCreateKeypair, getPublicKey, importKeypair, signNostrEvent } from "./identity-store";
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
import {
  enqueueDelegation,
  getDelegationCount,
  getDelegatedRootHashes,
  listDelegations,
  pruneDelegations
} from "./seeder";
import { createColdStorageManager } from "./cold-storage-manager";
import { createMetricsCollector } from "./metrics";
import { scheduleMaintenance } from "./scheduler";

const KEEP_ALIVE_ALARM_NAME = "entropy-keepalive";
const KEEP_ALIVE_ALARM_PERIOD_MINUTES = 1;
const SEEDER_ANNOUNCEMENT_INTERVAL_MS = 15 * 60 * 1000;

const chunkStore = createIndexedDbChunkStore();
const peerReputationStore = createIndexedDbPeerReputationStore();
const tagStore = createTagStore();
const startedAt = Date.now();
const coldStorageManager = createColdStorageManager({
  chunkStore,
  getCreditSummary,
  listDelegations
});
const metricsCollector = createMetricsCollector({ startedAt });

let lastHeartbeatAt = startedAt;
let bootstrapPromise: Promise<void> | null = null;
let seederAnnouncementInterval: ReturnType<typeof setInterval> | null = null;
let maintenanceScheduled = false;

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

async function buildColdStorageStatusPayload(): Promise<ColdStorageStatusPayload> {
  const assignments = await coldStorageManager.getAssignments();
  const totalPremiumCredits = assignments.reduce(
    (total, assignment) => total + assignment.premiumCredits,
    0
  );

  return {
    assignments,
    totalPremiumCredits
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

function exportIdentityResponse(
  requestId: string,
  payload: ExportIdentityPayload
): EntropyRuntimeResponse {
  return { ok: true, requestId, type: "EXPORT_IDENTITY", payload };
}

function nodeSettingsResponse(
  requestId: string,
  type: "GET_NODE_SETTINGS" | "ADD_RELAY" | "REMOVE_RELAY" | "SET_SEEDING_ACTIVE",
  payload: NodeSettingsPayload
): EntropyRuntimeResponse {
  return { ok: true, requestId, type, payload };
}

function coldStorageStatusResponse(
  requestId: string,
  type: "GET_COLD_STORAGE_ASSIGNMENTS" | "RELEASE_COLD_ASSIGNMENT",
  payload: ColdStorageStatusPayload
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

async function publishSeederAnnouncement(
  rootHash: string,
  chunkCount: number
): Promise<void> {
  try {
    const signed = await signNostrEvent(
      buildSeederAnnouncementEvent({
        rootHash,
        chunkCount
      })
    );

    getRelayPool().publish(signed);
  } catch (err) {
    logger.warn(
      "[seeder-announcement] failed to publish announcement for",
      rootHash.slice(0, 12) + "…",
      err
    );
  }
}

async function publishDelegationSeederAnnouncements(): Promise<void> {
  const delegations = await listDelegations();

  for (const delegation of delegations) {
    await publishSeederAnnouncement(
      delegation.rootHash,
      delegation.chunkHashes.length
    );
  }
}

/**
 * Announce ALL roots currently in the chunk store, not just active delegations.
 * This covers chunks acquired via cold storage, P2P download, or any path
 * that predates the STORE_CHUNK announcement fix.
 */
async function publishInventorySeederAnnouncements(): Promise<void> {
  try {
    const allChunks = await chunkStore.listAllChunks();
    // Group chunk counts by rootHash
    const rootCounts = new Map<string, number>();
    for (const chunk of allChunks) {
      rootCounts.set(chunk.rootHash, (rootCounts.get(chunk.rootHash) ?? 0) + 1);
    }
    for (const [rootHash, count] of rootCounts) {
      await publishSeederAnnouncement(rootHash, count);
    }
    if (rootCounts.size > 0) {
      logger.log(`[inventory-announce] published announcements for ${rootCounts.size} root(s)`);
    }
  } catch (err) {
    logger.warn("[inventory-announce] failed:", err);
  }
}

function scheduleSeederAnnouncements(): void {
  if (seederAnnouncementInterval) {
    clearInterval(seederAnnouncementInterval);
  }

  seederAnnouncementInterval = setInterval(() => {
    void publishDelegationSeederAnnouncements();
    void publishInventorySeederAnnouncements();
  }, SEEDER_ANNOUNCEMENT_INTERVAL_MS);
}

function ensureMaintenanceScheduled(): void {
  if (maintenanceScheduled) {
    return;
  }

  maintenanceScheduled = true;
  scheduleMaintenance(coldStorageManager, metricsCollector);
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
      try {
        await peerReputationStore.recordSuccess(peerPubkey, bytes);
      } catch (err) {
        logger.warn("[peer-reputation] failed to record upload peer success:", err);
      }

      const updatedSummary = await recordUploadCredit({
        peerPubkey,
        bytes,
        chunkHash,
        receiptSignature: `rtc-upload:${chunkHash}:${Date.now()}`,
        timestamp: Math.floor(Date.now() / 1000)
      });

      emitCreditUpdate(updatedSummary);
    },
    authorizeChunkRequest: async ({ peerPubkey }) => {
      const banned = await peerReputationStore.isBanned(peerPubkey);
      if (banned) {
        logger.warn("[chunk-server] blocking banned peer", peerPubkey.slice(0, 8) + "…");
        return false;
      }

      return true;
    }
  });

  await publishDelegationSeederAnnouncements();
  await publishInventorySeederAnnouncements();
  scheduleSeederAnnouncements();

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
  ensureMaintenanceScheduled();
  scheduleBootstrap();
});

browser.runtime.onStartup.addListener(() => {
  ensureMaintenanceScheduled();
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
      return getDelegatedRootHashes().then(async (hashes) => {
        if (hashes.includes(rootHash)) {
          return { canServe: true };
        }
        // Fallback: check if chunks for this rootHash exist in IndexedDB
        // (delegations may have been pruned but chunks are still stored)
        const chunks = await chunkStore.listChunksByRoot(rootHash);
        return { canServe: chunks.length > 0 };
      }) as Promise<unknown> as Promise<EntropyRuntimeResponse>;
    }

    // Handle authorization checks from offscreen document before serving chunk requests
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      (message as { type: string }).type === "CHECK_CHUNK_AUTH"
    ) {
      const peerPubkey = (message as unknown as { peerPubkey: string }).peerPubkey;
      return Promise.resolve()
        .then(async () => {
          const banned = await peerReputationStore.isBanned(peerPubkey);
          return { authorized: !banned };
        }) as Promise<unknown> as Promise<EntropyRuntimeResponse>;
    }

    // Handle P2P messages from offscreen document (credit tracking)
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      (message as { type: string }).type === "P2P_CHUNK_SERVED"
    ) {
      const msg = message as unknown as { chunkHash: string; peerPubkey: string; bytes: number };

      void peerReputationStore.recordSuccess(msg.peerPubkey, msg.bytes).catch((err) => {
        logger.warn("[peer-reputation] failed to record offscreen upload peer success:", err);
      });

      void recordUploadCredit({
        peerPubkey: msg.peerPubkey,
        bytes: msg.bytes,
        chunkHash: msg.chunkHash,
        receiptSignature: `rtc-upload:${msg.chunkHash}:${Date.now()}`,
        timestamp: Math.floor(Date.now() / 1000)
      }).then(emitCreditUpdate);
      return;
    }

    // Handle peer verification failures reported by offscreen fetch path
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      (message as { type: string }).type === "P2P_PEER_FAILED_VERIFICATION"
    ) {
      const msg = message as unknown as { peerPubkey: string };
      void peerReputationStore.recordFailedVerification(msg.peerPubkey)
        .then((updated) => {
          if (updated.banned) {
            logger.warn("[peer-reputation] auto-banned peer", msg.peerPubkey.slice(0, 8) + "…");
          }
        })
        .catch((err) => {
          logger.warn("[peer-reputation] failed to record offscreen verification failure:", err);
        });
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
            await publishSeederAnnouncement(
              message.payload.rootHash,
              message.payload.chunkHashes.length
            );

            const status = await buildNodeStatus();
            emitNodeStatusUpdate(status);
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

            // Fallback: try to fetch from a gatekeeper/seeder peer via WebRTC
            const { rootHash: reqRootHash, gatekeepers } = message.payload;
            logger.log("[GET_CHUNK] P2P fallback check — rootHash:", reqRootHash?.slice(0, 12), "gatekeepers:", gatekeepers);
            if (!reqRootHash) {
              logger.log("[GET_CHUNK] no gatekeepers, returning null");
              return chunkDataResponse(message.requestId, null);
            }

            const identity = await getOrCreateKeypair();
            const pool = getRelayPool();

            let dynamicGatekeepers: string[] = [];
            try {
              dynamicGatekeepers = await discoverSeeders(pool, reqRootHash, {
                timeoutMs: 1_500,
                minChunkCount: 1
              });
            } catch (discoveryErr) {
              logger.warn("[GET_CHUNK] seeder discovery failed:", discoveryErr);
            }

            const candidateGatekeepers = [
              ...new Set([...(gatekeepers ?? []), ...dynamicGatekeepers])
            ];

            logger.log(
              "[GET_CHUNK] my pubkey:",
              identity.pubkey.slice(0, 8) + "…",
              "gatekeepers to try:",
              candidateGatekeepers.length
            );

            if (candidateGatekeepers.length === 0) {
              logger.log("[GET_CHUNK] no candidate gatekeepers after discovery, returning null");
              return chunkDataResponse(message.requestId, null);
            }

            const dedupeKey = message.payload.hash;
            let p2pPromise = inflightP2PFetches.get(dedupeKey);
            if (p2pPromise) {
              logger.log("[GET_CHUNK] reusing in-flight P2P fetch for", dedupeKey.slice(0, 12) + "…");
            } else {
              p2pPromise = (async (): Promise<PeerChunkResult | null> => {
                for (const gk of candidateGatekeepers) {
                  if (gk === identity.pubkey) {
                    logger.log("[GET_CHUNK] skipping self as gatekeeper");
                    continue;
                  }

                  const banned = await peerReputationStore.isBanned(gk);
                  if (banned) {
                    logger.log("[GET_CHUNK] skipping banned gatekeeper", gk.slice(0, 8) + "…");
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
                      signEvent: signNostrEvent,
                      isPeerBanned: (peerPubkey) => peerReputationStore.isBanned(peerPubkey),
                      onPeerTransferSuccess: async (peerPubkey, bytes) => {
                        await peerReputationStore.recordSuccess(peerPubkey, bytes);
                      },
                      onPeerFailedVerification: async (peerPubkey) => {
                        const updated = await peerReputationStore.recordFailedVerification(peerPubkey);
                        if (updated.banned) {
                          logger.warn("[peer-reputation] auto-banned peer", peerPubkey.slice(0, 8) + "…");
                        }
                      }
                    });
                    if (peerResult) {
                      // Store chunk and record credit ONCE inside the deduplicated promise
                      // (prevents double-charge when multiple callers await the same fetch)
                      await chunkStore.storeChunk({
                        hash: peerResult.hash,
                        rootHash: peerResult.rootHash,
                        index: 0,
                        data: peerResult.data,
                        createdAt: Date.now(),
                        lastAccessed: Date.now(),
                        pinned: false
                      });

                      try {
                        await recordDownloadCredit({
                          peerPubkey: peerResult.peerPubkey,
                          bytes: peerResult.data.byteLength,
                          chunkHash: peerResult.hash,
                          rootHash: peerResult.rootHash,
                          receiptSignature: peerResult.receiptSignature ?? "p2p-fetch",
                          timestamp: Math.floor(Date.now() / 1000),
                        });
                      } catch (creditErr) {
                        logger.warn("[GET_CHUNK] failed to record download credit:", creditErr);
                      }

                      return peerResult;
                    }
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
            // Announce we now serve this root — without this, nodes that acquire
            // chunks via cold storage are invisible to seeder discovery.
            void publishSeederAnnouncement(message.payload.rootHash, 1).catch((err) => {
              logger.warn("[STORE_CHUNK] failed to publish seeder announcement:", err);
            });
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

          case "EXPORT_IDENTITY": {
            const identity = await exportIdentity();
            return exportIdentityResponse(message.requestId, identity);
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

          case "GET_COLD_STORAGE_ASSIGNMENTS": {
            const payload = await buildColdStorageStatusPayload();
            return coldStorageStatusResponse(message.requestId, message.type, payload);
          }

          case "RELEASE_COLD_ASSIGNMENT": {
            await coldStorageManager.release(message.payload.chunkHash);
            const payload = await buildColdStorageStatusPayload();
            return coldStorageStatusResponse(message.requestId, message.type, payload);
          }

          case "GET_NODE_METRICS": {
            const metrics = await metricsCollector.getMetrics();
            const metricsPayload: NodeMetricsPayload = metrics;
            const metricsResponse: EntropyRuntimeResponse = {
              ok: true,
              requestId: message.requestId,
              type: "GET_NODE_METRICS",
              payload: metricsPayload
            };
            return metricsResponse;
          }

          case "CHECK_LOCAL_CHUNKS": {
            const { hashes } = message.payload;
            let localCount = 0;
            let localBytes = 0;

            for (const hash of hashes) {
              const chunk = await chunkStore.getChunk(hash);
              if (chunk) {
                localCount++;
                localBytes += chunk.data.byteLength;
              }
            }

            const checkResult: EntropyRuntimeResponse = {
              ok: true,
              requestId: message.requestId,
              type: "CHECK_LOCAL_CHUNKS",
              payload: { total: hashes.length, local: localCount, localBytes }
            };
            return checkResult;
          }

          case "TAG_CONTENT": {
            const tagResult = await addContentTagFromUser(
              tagStore,
              message.payload.rootHash,
              message.payload.tag
            );

            const tagResponse: EntropyRuntimeResponse = {
              ok: true,
              requestId: message.requestId,
              type: "TAG_CONTENT",
              payload: {
                added: tagResult.added,
                tags: tagResult.tags.map((t) => ({
                  name: t.name,
                  counter: t.counter,
                  updatedAt: t.updatedAt
                }))
              }
            };
            return tagResponse;
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
