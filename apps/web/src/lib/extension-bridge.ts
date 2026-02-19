import {
  createEntropyRequestId,
  ENTROPY_WEB_SOURCE,
  isEntropyExtensionResponseEvent,
  isNodeStatusPayload,
  isEntropyRuntimePushMessage,
  type DelegateSeedingPayload,
  type EntropyRuntimeMessage,
  type NodeStatusPayload
} from "@entropy/core";

export type ExtensionRequestType = EntropyRuntimeMessage["type"];
export type { DelegateSeedingPayload, NodeStatusPayload };

const DEBUG_PREFIX = "[entropy-bridge]";

function debugLog(...args: unknown[]): void {
  console.log(DEBUG_PREFIX, ...args);
}

function debugWarn(...args: unknown[]): void {
  console.warn(DEBUG_PREFIX, ...args);
}

function debugError(...args: unknown[]): void {
  console.error(DEBUG_PREFIX, ...args);
}

function buildMessage(
  requestId: string,
  type: ExtensionRequestType,
  payload?: DelegateSeedingPayload
): EntropyRuntimeMessage {
  debugLog("buildMessage()", { requestId, type, hasPayload: !!payload });

  if (type === "DELEGATE_SEEDING") {
    if (!payload) {
      throw new Error("DELEGATE_SEEDING requires a payload.");
    }

    return {
      source: ENTROPY_WEB_SOURCE,
      requestId,
      type,
      payload
    };
  }

  return {
    source: ENTROPY_WEB_SOURCE,
    requestId,
    type
  };
}

export function sendExtensionRequest(
  type: ExtensionRequestType,
  payload?: DelegateSeedingPayload,
  timeoutMs = 1600
): Promise<NodeStatusPayload | undefined> {
  return new Promise((resolve, reject) => {
    const requestId = createEntropyRequestId("web");

    debugLog(`sendExtensionRequest() START`, { type, requestId, timeoutMs });

    const timeoutHandle = window.setTimeout(() => {
      cleanup();
      debugError(`TIMEOUT after ${timeoutMs}ms`, { type, requestId });
      debugError("No response was received from the content script. Possible causes:");
      debugError("  1. Extension not installed or disabled");
      debugError("  2. Content script not injected on this page");
      debugError("  3. Content script failed to load (check chrome://extensions for errors)");
      debugError("  4. Page URL does not match content_scripts.matches pattern in manifest");
      reject(new Error("Entropy extension bridge timeout. Is the extension installed and enabled?"));
    }, timeoutMs);

    function cleanup(): void {
      window.clearTimeout(timeoutHandle);
      window.removeEventListener("message", handleBridgeResponse);
      debugLog("cleanup() — removed message listener and cleared timeout");
    }

    function handleBridgeResponse(event: MessageEvent): void {
      if (event.source !== window) {
        return; // Not from our window, skip silently
      }

      // Log ALL messages from our window to see what's coming through
      if (typeof event.data === "object" && event.data !== null && event.data.source) {
        debugLog("Received window message:", {
          source: event.data.source,
          type: event.data.type,
          requestId: event.data.requestId,
          requestType: event.data.requestType,
          hasPayload: !!event.data.payload,
          hasError: !!event.data.error,
          fullData: event.data
        });
      }

      if (!isEntropyExtensionResponseEvent(event.data)) {
        if (typeof event.data === "object" && event.data !== null && event.data.source) {
          debugWarn("Message rejected by isEntropyExtensionResponseEvent()", event.data);
        }
        return;
      }

      if (event.data.requestId !== requestId) {
        debugWarn("requestId mismatch", {
          expected: requestId,
          received: event.data.requestId
        });
        return;
      }

      if (event.data.requestType !== type) {
        debugWarn("requestType mismatch", {
          expected: type,
          received: event.data.requestType
        });
        return;
      }

      debugLog("Valid response received!", event.data);
      cleanup();

      if (typeof event.data.error === "string" && event.data.error.length > 0) {
        debugError("Extension returned error:", event.data.error);
        reject(new Error(event.data.error));
        return;
      }

      if (event.data.payload !== undefined && !isNodeStatusPayload(event.data.payload)) {
        debugError("Invalid node status payload shape:", event.data.payload);
        reject(new Error("Entropy extension bridge returned an invalid node status payload."));
        return;
      }

      debugLog("Resolving with payload:", event.data.payload);
      resolve(event.data.payload);
    }

    debugLog("Adding message event listener...");
    window.addEventListener("message", handleBridgeResponse);

    const message = buildMessage(requestId, type, payload);
    debugLog("Posting message to window:", message);
    window.postMessage(message, "*");
    debugLog("Message posted. Waiting for response...");
  });
}

export function delegateSeeding(payload: DelegateSeedingPayload): Promise<NodeStatusPayload | undefined> {
  debugLog("delegateSeeding() called");
  return sendExtensionRequest("DELEGATE_SEEDING", payload);
}

export function getNodeStatus(): Promise<NodeStatusPayload | undefined> {
  debugLog("getNodeStatus() called");
  return sendExtensionRequest("GET_NODE_STATUS");
}

export function sendHeartbeat(): Promise<NodeStatusPayload | undefined> {
  debugLog("sendHeartbeat() called");
  return sendExtensionRequest("HEARTBEAT");
}

export function subscribeToNodeStatusUpdates(
  onUpdate: (status: NodeStatusPayload) => void
): () => void {
  debugLog("subscribeToNodeStatusUpdates() — registering push listener");

  function handleRuntimePush(event: MessageEvent): void {
    if (event.source !== window || !isEntropyRuntimePushMessage(event.data)) {
      return;
    }

    debugLog("Received push status update:", event.data.payload);
    onUpdate(event.data.payload);
  }

  window.addEventListener("message", handleRuntimePush);

  return () => {
    debugLog("subscribeToNodeStatusUpdates() — unsubscribing push listener");
    window.removeEventListener("message", handleRuntimePush);
  };
}

