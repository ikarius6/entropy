import {
  ENTROPY_SIGNALING_KIND_MAX,
  ENTROPY_SIGNALING_KIND_MIN,
  createIndexedDbChunkStore,
  isEntropySignalingKind,
  verifyEventSignature,
  wireReceiptVerifier
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
  type NodeStatusPayload,
  type PublicKeyPayload
} from "../shared/messaging";
import { handleDataChannel } from "./chunk-server";
import { hasDelegatedChunks, storeChunkPayload } from "./chunk-ingest";
import { getCreditSummary, recordUploadCredit, recordDownloadCredit } from "./credit-ledger";
import { getOrCreateKeypair, getPublicKey, importKeypair } from "./identity-store";
import { ensureRelayConnections, getRelayPool, initRelayManager } from "./relay-manager";
import { enqueueDelegation, getDelegationCount, getDelegatedRootHashes, pruneDelegations } from "./seeder";
import { scheduleMaintenance } from "./scheduler";
import { startSignalingListener } from "./signaling-listener";

const KEEP_ALIVE_ALARM_NAME = "entropy-keepalive";
const KEEP_ALIVE_ALARM_PERIOD_MINUTES = 1;

const chunkStore = createIndexedDbChunkStore();
const startedAt = Date.now();

let lastHeartbeatAt = startedAt;
let bootstrapPromise: Promise<void> | null = null;
let stopSignaling: (() => void) | null = null;

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

function successResponse(
  requestId: string,
  type: EntropyRuntimeMessage["type"],
  payload?: NodeStatusPayload | CreditSummaryPayload | PublicKeyPayload
): EntropyRuntimeResponse {
  if (type === "GET_CREDIT_SUMMARY" || type === "SERVE_CHUNK") {
    return {
      ok: true,
      requestId,
      type,
      payload: payload as CreditSummaryPayload
    };
  }

  if (type === "IMPORT_KEYPAIR" || type === "GET_PUBLIC_KEY") {
    return {
      ok: true,
      requestId,
      type,
      payload: payload as PublicKeyPayload
    };
  }

  return {
    ok: true,
    requestId,
    type,
    payload: payload as NodeStatusPayload | undefined
  };
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

  void chrome.runtime.sendMessage(update).catch(() => {
    // Ignore when there are no listeners yet.
  });
}

function emitCreditUpdate(summary: CreditSummaryPayload): void {
  const update: EntropyRuntimePushMessage = {
    source: ENTROPY_EXTENSION_SOURCE,
    type: "CREDIT_UPDATE",
    payload: summary
  };

  void chrome.runtime.sendMessage(update).catch(() => {
    // Ignore when there are no listeners yet.
  });
}

async function canServeRoot(rootHash: string): Promise<boolean> {
  const delegatedRootHashes = await getDelegatedRootHashes();
  return delegatedRootHashes.includes(rootHash);
}

async function bootstrapBackground(): Promise<void> {
  const identity = await getOrCreateKeypair();

  await initRelayManager();

  stopSignaling?.();
  stopSignaling = startSignalingListener(
    getRelayPool(),
    identity.pubkey,
    (peerPubkey, channel) => {
      handleDataChannel(
        channel,
        peerPubkey,
        chunkStore,
        async (chunkHash, bytes) => {
          const updatedSummary = await recordUploadCredit({
            peerPubkey,
            bytes,
            chunkHash,
            receiptSignature: `rtc-upload:${chunkHash}:${Date.now()}`,
            timestamp: Math.floor(Date.now() / 1000)
          });

          emitCreditUpdate(updatedSummary);
        },
        {
          authorizeRequest: async ({ requestedBytes }) => {
            const summary = await getCreditSummary();
            return summary.balance >= requestedBytes;
          }
        }
      );
    },
    { canServeRoot }
  );

  chrome.alarms.create(KEEP_ALIVE_ALARM_NAME, {
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

chrome.runtime.onInstalled.addListener(() => {
  scheduleMaintenance();
  scheduleBootstrap();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleBootstrap();
});

chrome.alarms.onAlarm.addListener((alarm: { name: string }) => {
  if (alarm.name !== KEEP_ALIVE_ALARM_NAME) {
    return;
  }

  void (async () => {
    await ensureBootstrap();
    await ensureRelayConnections();
  })();
});

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender: unknown, sendResponse: (response: EntropyRuntimeResponse) => void) => {
    if (isEntropyRuntimePushMessage(message)) {
      return false;
    }

    if (!isEntropyRuntimeMessage(message)) {
      sendResponse(
        errorResponse(createEntropyRequestId("invalid"), "HEARTBEAT", "Invalid Entropy runtime message.")
      );
      return false;
    }

    void (async () => {
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
            sendResponse(successResponse(message.requestId, message.type, status));
            emitNodeStatusUpdate(status);
            emitCreditUpdate(creditSummary);
            break;
          }

          case "STORE_CHUNK": {
            await storeChunkPayload(chunkStore, message.payload);
            const status = await buildNodeStatus();
            sendResponse(successResponse(message.requestId, message.type, status));
            emitNodeStatusUpdate(status);
            break;
          }

          case "IMPORT_KEYPAIR": {
            const payload = await importKeypair(message.payload.privkey);
            bootstrapPromise = null;
            await ensureBootstrap();
            sendResponse(successResponse(message.requestId, message.type, payload));
            break;
          }

          case "GET_PUBLIC_KEY": {
            const pubkey = await getPublicKey();
            sendResponse(successResponse(message.requestId, message.type, { pubkey }));
            break;
          }

          case "GET_CREDIT_SUMMARY": {
            const summary = await getCreditSummary();
            sendResponse(successResponse(message.requestId, message.type, summary));
            emitCreditUpdate(summary);
            break;
          }

          case "GET_NODE_STATUS": {
            const status = await buildNodeStatus();
            sendResponse(successResponse(message.requestId, message.type, status));
            emitNodeStatusUpdate(status);
            break;
          }

          case "HEARTBEAT": {
            lastHeartbeatAt = Date.now();
            await pruneDelegations();
            await ensureRelayConnections();

            const status = await buildNodeStatus();
            sendResponse(successResponse(message.requestId, message.type, status));
            emitNodeStatusUpdate(status);
            break;
          }

          case "SERVE_CHUNK": {
            const summary = await getCreditSummary();
            const currentBalance = summary.balance;

            if (currentBalance < message.payload.requestedBytes) {
              sendResponse(errorResponse(message.requestId, message.type, "INSUFFICIENT_CREDIT"));
              break;
            }

            const updatedSummary = await recordDownloadCredit({
              peerPubkey: message.payload.peerPubkey,
              bytes: message.payload.requestedBytes,
              chunkHash: message.payload.chunkHash,
              receiptSignature: `serve:${message.requestId}`,
              timestamp: Math.floor(Date.now() / 1000)
            });

            sendResponse(successResponse(message.requestId, message.type, updatedSummary));
            emitCreditUpdate(updatedSummary);
            break;
          }
        }
      } catch (caughtError) {
        const messageText =
          caughtError instanceof Error ? caughtError.message : "Unknown extension runtime failure.";
        sendResponse(errorResponse(message.requestId, message.type, messageText));
      }
    })();

    return true;
  }
);

scheduleBootstrap();
