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
import { enqueueDelegation, getDelegationCount, listDelegations, pruneDelegations } from "./seeder";
import { scheduleMaintenance } from "./scheduler";

const startedAt = Date.now();
let lastHeartbeatAt = startedAt;

function buildNodeStatus(): NodeStatusPayload {
  const delegations = listDelegations();

  return {
    delegatedCount: getDelegationCount(),
    delegatedRootHashes: delegations.map((entry) => entry.rootHash),
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

    switch (message.type) {
      case "DELEGATE_SEEDING":
        enqueueDelegation(message.payload);
        {
          const status = buildNodeStatus();
          sendResponse(successResponse(message.requestId, message.type, status));
          emitNodeStatusUpdate(status);
        }
        return false;
      case "GET_NODE_STATUS":
        {
          const status = buildNodeStatus();
          sendResponse(successResponse(message.requestId, message.type, status));
          emitNodeStatusUpdate(status);
        }
        return false;
      case "HEARTBEAT":
        lastHeartbeatAt = Date.now();
        pruneDelegations();
        {
          const status = buildNodeStatus();
          sendResponse(successResponse(message.requestId, message.type, status));
          emitNodeStatusUpdate(status);
        }
        return false;
    }

    return false;
  }
);
