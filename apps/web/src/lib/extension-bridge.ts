import {
  createEntropyRequestId,
  ENTROPY_WEB_SOURCE,
  isCreditSummaryPayload,
  isEntropyExtensionResponseEvent,
  isNodeSettingsPayload,
  isPublicKeyPayload,
  isNodeStatusPayload,
  isEntropyRuntimePushMessage,
  type CreditSummaryPayload,
  type DelegateSeedingPayload,
  type ImportKeypairPayload,
  type EntropyRuntimeMessage,
  type NodeSettingsPayload,
  type NodeStatusPayload,
  type PublicKeyPayload,
  type RelayUrlPayload,
  type SetSeedingActivePayload,
  type StoreChunkPayload,
  type ServeChunkPayload
} from "@entropy/core";

export type ExtensionRequestType = EntropyRuntimeMessage["type"];
export type {
  CreditSummaryPayload,
  DelegateSeedingPayload,
  ImportKeypairPayload,
  NodeSettingsPayload,
  NodeStatusPayload,
  PublicKeyPayload,
  RelayUrlPayload,
  SetSeedingActivePayload,
  StoreChunkPayload,
  ServeChunkPayload
};

function buildNoPayloadMessage(
  requestId: string,
  type:
    | "GET_NODE_STATUS"
    | "HEARTBEAT"
    | "GET_CREDIT_SUMMARY"
    | "GET_PUBLIC_KEY"
    | "GET_NODE_SETTINGS"
): EntropyRuntimeMessage {
  return { source: ENTROPY_WEB_SOURCE, requestId, type };
}

function buildDelegateSeedingMessage(
  requestId: string,
  payload: DelegateSeedingPayload
): EntropyRuntimeMessage {
  return { source: ENTROPY_WEB_SOURCE, requestId, type: "DELEGATE_SEEDING", payload };
}

function buildServeChunkMessage(
  requestId: string,
  payload: ServeChunkPayload
): EntropyRuntimeMessage {
  return { source: ENTROPY_WEB_SOURCE, requestId, type: "SERVE_CHUNK", payload };
}

function buildStoreChunkMessage(
  requestId: string,
  payload: StoreChunkPayload
): EntropyRuntimeMessage {
  return { source: ENTROPY_WEB_SOURCE, requestId, type: "STORE_CHUNK", payload };
}

function buildImportKeypairMessage(
  requestId: string,
  payload: ImportKeypairPayload
): EntropyRuntimeMessage {
  return { source: ENTROPY_WEB_SOURCE, requestId, type: "IMPORT_KEYPAIR", payload };
}

function buildAddRelayMessage(
  requestId: string,
  payload: RelayUrlPayload
): EntropyRuntimeMessage {
  return { source: ENTROPY_WEB_SOURCE, requestId, type: "ADD_RELAY", payload };
}

function buildRemoveRelayMessage(
  requestId: string,
  payload: RelayUrlPayload
): EntropyRuntimeMessage {
  return { source: ENTROPY_WEB_SOURCE, requestId, type: "REMOVE_RELAY", payload };
}

function buildSetSeedingActiveMessage(
  requestId: string,
  payload: SetSeedingActivePayload
): EntropyRuntimeMessage {
  return { source: ENTROPY_WEB_SOURCE, requestId, type: "SET_SEEDING_ACTIVE", payload };
}

function sendBridgeMessage<T>(
  message: EntropyRuntimeMessage,
  validate: (payload: unknown) => T | null,
  timeoutMs: number
): Promise<T> {
  return new Promise((resolve, reject) => {
    const { requestId, type } = message;

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

      if (event.data.requestId !== requestId || event.data.requestType !== type) {
        return;
      }

      cleanup();

      if (typeof event.data.error === "string" && event.data.error.length > 0) {
        reject(new Error(event.data.error));
        return;
      }

      const validated = validate(event.data.payload);

      if (validated === null) {
        reject(new Error(`Entropy extension bridge returned an invalid payload for ${type}.`));
        return;
      }

      resolve(validated);
    }

    window.addEventListener("message", handleBridgeResponse);
    window.postMessage(message, "*");
  });
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
  type: "STORE_CHUNK",
  payload: StoreChunkPayload,
  timeoutMs?: number
): Promise<NodeStatusPayload | undefined>;
export function sendExtensionRequest(
  type: "IMPORT_KEYPAIR",
  payload: ImportKeypairPayload,
  timeoutMs?: number
): Promise<PublicKeyPayload>;
export function sendExtensionRequest(
  type: "GET_PUBLIC_KEY",
  payload?: undefined,
  timeoutMs?: number
): Promise<PublicKeyPayload>;
export function sendExtensionRequest(
  type: "SERVE_CHUNK",
  payload: ServeChunkPayload,
  timeoutMs?: number
): Promise<CreditSummaryPayload>;
export function sendExtensionRequest(
  type: "GET_NODE_SETTINGS",
  payload?: undefined,
  timeoutMs?: number
): Promise<NodeSettingsPayload>;
export function sendExtensionRequest(
  type: "ADD_RELAY" | "REMOVE_RELAY",
  payload: RelayUrlPayload,
  timeoutMs?: number
): Promise<NodeSettingsPayload>;
export function sendExtensionRequest(
  type: "SET_SEEDING_ACTIVE",
  payload: SetSeedingActivePayload,
  timeoutMs?: number
): Promise<NodeSettingsPayload>;
export function sendExtensionRequest(
  type: ExtensionRequestType,
  payload?:
    | DelegateSeedingPayload
    | ServeChunkPayload
    | StoreChunkPayload
    | ImportKeypairPayload
    | RelayUrlPayload
    | SetSeedingActivePayload,
  timeoutMs = 1600
): Promise<NodeStatusPayload | CreditSummaryPayload | PublicKeyPayload | NodeSettingsPayload | undefined> {
  const requestId = createEntropyRequestId("web");

  if (type === "DELEGATE_SEEDING") {
    return sendBridgeMessage(
      buildDelegateSeedingMessage(requestId, payload as DelegateSeedingPayload),
      (p) => (p === undefined || isNodeStatusPayload(p) ? (p as NodeStatusPayload | undefined) : null),
      timeoutMs
    );
  }

  if (type === "SERVE_CHUNK") {
    return sendBridgeMessage(
      buildServeChunkMessage(requestId, payload as ServeChunkPayload),
      (p) => (isCreditSummaryPayload(p) ? p : null),
      timeoutMs
    );
  }

  if (type === "STORE_CHUNK") {
    return sendBridgeMessage(
      buildStoreChunkMessage(requestId, payload as StoreChunkPayload),
      (p) => (p === undefined || isNodeStatusPayload(p) ? (p as NodeStatusPayload | undefined) : null),
      timeoutMs
    );
  }

  if (type === "IMPORT_KEYPAIR") {
    return sendBridgeMessage(
      buildImportKeypairMessage(requestId, payload as ImportKeypairPayload),
      (p) => (isPublicKeyPayload(p) ? p : null),
      timeoutMs
    );
  }

  if (type === "GET_CREDIT_SUMMARY") {
    return sendBridgeMessage(
      buildNoPayloadMessage(requestId, type),
      (p) => (isCreditSummaryPayload(p) ? p : null),
      timeoutMs
    );
  }

  if (type === "GET_PUBLIC_KEY") {
    return sendBridgeMessage(
      buildNoPayloadMessage(requestId, type),
      (p) => (isPublicKeyPayload(p) ? p : null),
      timeoutMs
    );
  }

  if (type === "GET_NODE_SETTINGS") {
    return sendBridgeMessage(
      buildNoPayloadMessage(requestId, type),
      (p) => (isNodeSettingsPayload(p) ? p : null),
      timeoutMs
    );
  }

  if (type === "ADD_RELAY") {
    return sendBridgeMessage(
      buildAddRelayMessage(requestId, payload as RelayUrlPayload),
      (p) => (isNodeSettingsPayload(p) ? p : null),
      timeoutMs
    );
  }

  if (type === "REMOVE_RELAY") {
    return sendBridgeMessage(
      buildRemoveRelayMessage(requestId, payload as RelayUrlPayload),
      (p) => (isNodeSettingsPayload(p) ? p : null),
      timeoutMs
    );
  }

  if (type === "SET_SEEDING_ACTIVE") {
    return sendBridgeMessage(
      buildSetSeedingActiveMessage(requestId, payload as SetSeedingActivePayload),
      (p) => (isNodeSettingsPayload(p) ? p : null),
      timeoutMs
    );
  }

  return sendBridgeMessage(
    buildNoPayloadMessage(requestId, type as "GET_NODE_STATUS" | "HEARTBEAT" | "GET_CREDIT_SUMMARY" | "GET_PUBLIC_KEY" | "GET_NODE_SETTINGS"),
    (p) => (p === undefined || isNodeStatusPayload(p) ? (p as NodeStatusPayload | undefined) : null),
    timeoutMs
  );
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

export function storeChunk(payload: StoreChunkPayload): Promise<NodeStatusPayload | undefined> {
  return sendExtensionRequest("STORE_CHUNK", payload);
}

export function importKeypair(payload: ImportKeypairPayload): Promise<PublicKeyPayload> {
  return sendExtensionRequest("IMPORT_KEYPAIR", payload);
}

export function getExtensionPublicKey(): Promise<PublicKeyPayload> {
  return sendExtensionRequest("GET_PUBLIC_KEY");
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
