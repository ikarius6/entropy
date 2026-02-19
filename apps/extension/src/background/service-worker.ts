import {
  ENTROPY_SIGNALING_KIND_MAX,
  ENTROPY_SIGNALING_KIND_MIN,
  isEntropySignalingKind,
  wireReceiptVerifier,
  createCreditLedger
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
  type NodeStatusPayload
} from "../shared/messaging";
import { getCreditSummary, recordUploadCredit, recordDownloadCredit } from "./credit-ledger";
import { enqueueDelegation, getDelegationCount, getDelegatedRootHashes, pruneDelegations } from "./seeder";
import { scheduleMaintenance } from "./scheduler";

// ---------------------------------------------------------------------------
// Bootstrap: wire signature verifier
// In production, pass `verifyEvent` from `nostr-tools` here.
// For now, accept all signatures until the dependency is integrated.
// ---------------------------------------------------------------------------

wireReceiptVerifier(() => true);

const startedAt = Date.now();
let lastHeartbeatAt = startedAt;

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
  payload?: NodeStatusPayload | CreditSummaryPayload
): EntropyRuntimeResponse {
  if (type === "GET_CREDIT_SUMMARY" || type === "SERVE_CHUNK") {
    return {
      ok: true,
      requestId,
      type,
      payload: payload as CreditSummaryPayload
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

chrome.runtime.onInstalled.addListener(() => {
  scheduleMaintenance();
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

    // Handle all message types asynchronously since seeder now uses chrome.storage
    void (async () => {
      try {
        switch (message.type) {
          case "DELEGATE_SEEDING":
            await enqueueDelegation(message.payload);
            {
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
            }
            break;

          case "GET_CREDIT_SUMMARY":
            {
              const summary = await getCreditSummary();
              sendResponse(successResponse(message.requestId, message.type, summary));
              emitCreditUpdate(summary);
            }
            break;

          case "GET_NODE_STATUS":
            {
              const status = await buildNodeStatus();
              sendResponse(successResponse(message.requestId, message.type, status));
              emitNodeStatusUpdate(status);
            }
            break;

          case "HEARTBEAT":
            lastHeartbeatAt = Date.now();
            await pruneDelegations();
            {
              const status = await buildNodeStatus();
              sendResponse(successResponse(message.requestId, message.type, status));
              emitNodeStatusUpdate(status);
            }
            break;

          case "SERVE_CHUNK":
            {
              // --- Credit gating: verify the requester has enough credit ---
              const summary = await getCreditSummary();
              const ledger = createCreditLedger();
              // Reconstruct balance from the persistent summary
              const currentBalance = summary.balance;

              if (currentBalance < message.payload.requestedBytes) {
                sendResponse(
                  errorResponse(
                    message.requestId,
                    message.type,
                    "INSUFFICIENT_CREDIT"
                  )
                );
                break;
              }

              // --- Download accounting: debit the served bytes ---
              const updatedSummary = await recordDownloadCredit({
                peerPubkey: message.payload.peerPubkey,
                bytes: message.payload.requestedBytes,
                chunkHash: message.payload.chunkHash,
                receiptSignature: `serve:${message.requestId}`,
                timestamp: Math.floor(Date.now() / 1000)
              });

              sendResponse(successResponse(message.requestId, message.type, updatedSummary));
              emitCreditUpdate(updatedSummary);
            }
            break;
        }
      } catch (caughtError) {
        const messageText =
          caughtError instanceof Error ? caughtError.message : "Unknown extension runtime failure.";
        sendResponse(errorResponse(message.requestId, message.type, messageText));
      }
    })();

    // Return true to indicate we will call sendResponse asynchronously
    return true;
  }
);
