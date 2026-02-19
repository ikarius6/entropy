import {
  ENTROPY_SIGNALING_KIND_MAX,
  ENTROPY_SIGNALING_KIND_MIN,
  isEntropySignalingKind
} from "@entropy/core";

import {
  createEntropyRequestId,
  ENTROPY_EXTENSION_SOURCE,
  isEntropyRuntimePushMessage,
  isEntropyRuntimeMessage,
  type EntropyRuntimePushMessage,
  type EntropyRuntimeMessage,
  type EntropyRuntimeResponse,
  type NodeStatusPayload
} from "../shared/messaging";
import { enqueueDelegation, getDelegationCount, getDelegatedRootHashes, pruneDelegations } from "./seeder";
import { scheduleMaintenance } from "./scheduler";

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
  payload?: NodeStatusPayload
): EntropyRuntimeResponse {
  return {
    ok: true,
    requestId,
    type,
    payload
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
    (async () => {
      switch (message.type) {
        case "DELEGATE_SEEDING":
          await enqueueDelegation(message.payload);
          {
            const status = await buildNodeStatus();
            sendResponse(successResponse(message.requestId, message.type, status));
            emitNodeStatusUpdate(status);
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
      }
    })();

    // Return true to indicate we will call sendResponse asynchronously
    return true;
  }
);
