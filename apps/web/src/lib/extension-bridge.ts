import {
  createEntropyRequestId,
  ENTROPY_WEB_SOURCE,
  isCreditSummaryPayload,
  isEntropyExtensionResponseEvent,
  isNodeStatusPayload,
  isEntropyRuntimePushMessage,
  type CreditSummaryPayload,
  type DelegateSeedingPayload,
  type EntropyRuntimeMessage,
  type NodeStatusPayload,
  type ServeChunkPayload
} from "@entropy/core";

export type ExtensionRequestType = EntropyRuntimeMessage["type"];
export type { CreditSummaryPayload, DelegateSeedingPayload, NodeStatusPayload, ServeChunkPayload };

function buildMessage(
  requestId: string,
  type: ExtensionRequestType,
  payload?: DelegateSeedingPayload | ServeChunkPayload
): EntropyRuntimeMessage {
  if (type === "DELEGATE_SEEDING") {
    if (!payload) {
      throw new Error("DELEGATE_SEEDING requires a payload.");
    }

    return {
      source: ENTROPY_WEB_SOURCE,
      requestId,
      type,
      payload: payload as DelegateSeedingPayload
    };
  }

  if (type === "SERVE_CHUNK") {
    if (!payload) {
      throw new Error("SERVE_CHUNK requires a payload.");
    }

    return {
      source: ENTROPY_WEB_SOURCE,
      requestId,
      type,
      payload: payload as ServeChunkPayload
    };
  }

  return {
    source: ENTROPY_WEB_SOURCE,
    requestId,
    type
  };
}

export function sendExtensionRequest(
  type: "DELEGATE_SEEDING",
  payload: DelegateSeedingPayload,
  timeoutMs?: number
): Promise<NodeStatusPayload | undefined>;
export function sendExtensionRequest(
  type: "GET_NODE_STATUS" | "HEARTBEAT",
  payload?: undefined,
  timeoutMs?: number
): Promise<NodeStatusPayload | undefined>;
export function sendExtensionRequest(
  type: "GET_CREDIT_SUMMARY",
  payload?: undefined,
  timeoutMs?: number
): Promise<CreditSummaryPayload>;
export function sendExtensionRequest(
  type: "SERVE_CHUNK",
  payload: ServeChunkPayload,
  timeoutMs?: number
): Promise<CreditSummaryPayload>;
export function sendExtensionRequest(
  type: ExtensionRequestType,
  payload?: DelegateSeedingPayload | ServeChunkPayload,
  timeoutMs = 1600
): Promise<NodeStatusPayload | CreditSummaryPayload | undefined> {
  return new Promise((resolve, reject) => {
    const requestId = createEntropyRequestId("web");

    const timeoutHandle = window.setTimeout(() => {
      cleanup();
      reject(new Error("Entropy extension bridge timeout. Is the extension installed and enabled?"));
    }, timeoutMs);

    function cleanup(): void {
      window.clearTimeout(timeoutHandle);
      window.removeEventListener("message", handleBridgeResponse);
    }

    function handleBridgeResponse(event: MessageEvent): void {
      if (event.source !== window || !event.data || event.data.type !== "EXTENSION_RESPONSE") {
        return;
      }

      if (!isEntropyExtensionResponseEvent(event.data)) {
        return;
      }

      if (event.data.requestId !== requestId) {
        return;
      }

      if (event.data.requestType !== type) {
        return;
      }

      cleanup();

      if (typeof event.data.error === "string" && event.data.error.length > 0) {
        reject(new Error(event.data.error));
        return;
      }

      if (type === "GET_CREDIT_SUMMARY" || type === "SERVE_CHUNK") {
        if (!isCreditSummaryPayload(event.data.payload)) {
          reject(new Error("Entropy extension bridge returned an invalid credit summary payload."));
          return;
        }

        resolve(event.data.payload);
        return;
      }

      if (event.data.payload !== undefined && !isNodeStatusPayload(event.data.payload)) {
        reject(new Error("Entropy extension bridge returned an invalid node status payload."));
        return;
      }

      resolve(event.data.payload);
    }

    window.addEventListener("message", handleBridgeResponse);
    window.postMessage(buildMessage(requestId, type, payload), "*");
  });
}

export function delegateSeeding(payload: DelegateSeedingPayload): Promise<NodeStatusPayload | undefined> {
  return sendExtensionRequest("DELEGATE_SEEDING", payload);
}

export function getNodeStatus(): Promise<NodeStatusPayload | undefined> {
  return sendExtensionRequest("GET_NODE_STATUS");
}

export function sendHeartbeat(): Promise<NodeStatusPayload | undefined> {
  return sendExtensionRequest("HEARTBEAT");
}

export function getCreditSummary(): Promise<CreditSummaryPayload> {
  return sendExtensionRequest("GET_CREDIT_SUMMARY");
}

export function serveChunk(payload: ServeChunkPayload): Promise<CreditSummaryPayload> {
  return sendExtensionRequest("SERVE_CHUNK", payload);
}

export function subscribeToNodeStatusUpdates(
  onUpdate: (status: NodeStatusPayload) => void
): () => void {
  function handleRuntimePush(event: MessageEvent): void {
    if (event.source !== window || !isEntropyRuntimePushMessage(event.data)) {
      return;
    }

    if (event.data.type !== "NODE_STATUS_UPDATE") {
      return;
    }

    onUpdate(event.data.payload);
  }

  window.addEventListener("message", handleRuntimePush);

  return () => {
    window.removeEventListener("message", handleRuntimePush);
  };
}

export function subscribeToCreditUpdates(
  onUpdate: (summary: CreditSummaryPayload) => void
): () => void {
  function handleRuntimePush(event: MessageEvent): void {
    if (event.source !== window || !isEntropyRuntimePushMessage(event.data)) {
      return;
    }

    if (event.data.type !== "CREDIT_UPDATE") {
      return;
    }

    onUpdate(event.data.payload);
  }

  window.addEventListener("message", handleRuntimePush);

  return () => {
    window.removeEventListener("message", handleRuntimePush);
  };
}
