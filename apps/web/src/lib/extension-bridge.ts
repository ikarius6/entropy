import {
  createEntropyRequestId,
  ENTROPY_WEB_SOURCE,
  isCreditSummaryPayload,
  isColdStorageStatusPayload,
  isExportIdentityPayload,
  isNodeMetricsPayload,
  isCheckLocalChunksResultPayload,
  isEntropyExtensionResponseEvent,
  isNodeSettingsPayload,
  isPrivacySettingsPayload,
  isPublicKeyPayload,
  isNodeStatusPayload,
  isEntropyRuntimePushMessage,
  isTagContentResultPayload,
  type ColdStorageStatusPayload,
  type CreditSummaryPayload,
  type CheckLocalChunksResultPayload,
  type DelegateSeedingPayload,
  type ExportIdentityPayload,
  type ImportKeypairPayload,
  type EntropyRuntimeMessage,
  type NodeSettingsPayload,
  type NodeStatusPayload,
  type PrivacySettingsPayload,
  type PublicKeyPayload,
  type RelayUrlPayload,
  type NodeMetricsPayload,
  type ReleaseColdAssignmentPayload,
  type SetSeedingActivePayload,
  type StoreChunkPayload,
  type ServeChunkPayload,
  type GetChunkPayload,
  type ChunkDataPayload,
  type TagContentPayload,
  type TagContentResultPayload,
  type SignAllowlistPayload,
  type SignOriginPayload
} from "@entropy/core";

export type ExtensionRequestType = EntropyRuntimeMessage["type"];
export type {
  ColdStorageStatusPayload,
  CreditSummaryPayload,
  DelegateSeedingPayload,
  ExportIdentityPayload,
  ImportKeypairPayload,
  NodeSettingsPayload,
  NodeStatusPayload,
  PublicKeyPayload,
  RelayUrlPayload,
  ReleaseColdAssignmentPayload,
  SetSeedingActivePayload,
  StoreChunkPayload,
  ServeChunkPayload,
  GetChunkPayload,
  ChunkDataPayload
};

export type { ColdStorageAssignmentPayload, NodeMetricsPayload, PrivacySettingsPayload, TagContentPayload, TagContentResultPayload, SignAllowlistPayload, SignOriginPayload, TurnServerConfig } from "@entropy/core";

function buildNoPayloadMessage(
  requestId: string,
  type:
    | "GET_NODE_STATUS"
    | "HEARTBEAT"
    | "GET_CREDIT_SUMMARY"
    | "GET_PUBLIC_KEY"
    | "GET_NODE_SETTINGS"
    | "GET_COLD_STORAGE_ASSIGNMENTS"
    | "GET_NODE_METRICS"
    | "EXPORT_IDENTITY"
    | "GET_PRIVACY_SETTINGS"
    | "GET_SIGN_ALLOWLIST"
): EntropyRuntimeMessage {
  return { source: ENTROPY_WEB_SOURCE, requestId, type };
}

function buildReleaseColdAssignmentMessage(
  requestId: string,
  payload: ReleaseColdAssignmentPayload
): EntropyRuntimeMessage {
  return { source: ENTROPY_WEB_SOURCE, requestId, type: "RELEASE_COLD_ASSIGNMENT", payload };
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
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        !event.data ||
        event.data.type !== "EXTENSION_RESPONSE"
      ) {
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
    window.postMessage(message, window.location.origin);
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
  type: "GET_COLD_STORAGE_ASSIGNMENTS",
  payload?: undefined,
  timeoutMs?: number
): Promise<ColdStorageStatusPayload>;
export function sendExtensionRequest(
  type: "GET_NODE_METRICS",
  payload?: undefined,
  timeoutMs?: number
): Promise<NodeMetricsPayload>;
export function sendExtensionRequest(
  type: "EXPORT_IDENTITY",
  payload?: undefined,
  timeoutMs?: number
): Promise<ExportIdentityPayload>;
export function sendExtensionRequest(
  type: "RELEASE_COLD_ASSIGNMENT",
  payload: ReleaseColdAssignmentPayload,
  timeoutMs?: number
): Promise<ColdStorageStatusPayload>;
export function sendExtensionRequest(
  type: "GET_PRIVACY_SETTINGS",
  payload?: undefined,
  timeoutMs?: number
): Promise<PrivacySettingsPayload>;
export function sendExtensionRequest(
  type: "SET_PRIVACY_SETTINGS",
  payload: PrivacySettingsPayload,
  timeoutMs?: number
): Promise<PrivacySettingsPayload>;
export function sendExtensionRequest(
  type: "TAG_CONTENT",
  payload: TagContentPayload,
  timeoutMs?: number
): Promise<TagContentResultPayload>;
export function sendExtensionRequest(
  type: ExtensionRequestType,
  payload?:
    | DelegateSeedingPayload
    | ServeChunkPayload
    | StoreChunkPayload
    | ImportKeypairPayload
    | RelayUrlPayload
    | SetSeedingActivePayload
    | ReleaseColdAssignmentPayload
    | PrivacySettingsPayload
    | TagContentPayload,
  timeoutMs = 1600
): Promise<NodeStatusPayload | CreditSummaryPayload | PublicKeyPayload | ExportIdentityPayload | NodeSettingsPayload | ColdStorageStatusPayload | NodeMetricsPayload | PrivacySettingsPayload | TagContentResultPayload | undefined> {
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

  if (type === "GET_COLD_STORAGE_ASSIGNMENTS") {
    return sendBridgeMessage(
      buildNoPayloadMessage(requestId, type),
      (p) => (isColdStorageStatusPayload(p) ? p : null),
      timeoutMs
    );
  }

  if (type === "GET_NODE_METRICS") {
    return sendBridgeMessage(
      buildNoPayloadMessage(requestId, type),
      (p) => (isNodeMetricsPayload(p) ? p : null),
      timeoutMs
    );
  }

  if (type === "RELEASE_COLD_ASSIGNMENT") {
    return sendBridgeMessage(
      buildReleaseColdAssignmentMessage(requestId, payload as ReleaseColdAssignmentPayload),
      (p) => (isColdStorageStatusPayload(p) ? p : null),
      timeoutMs
    );
  }

  if (type === "EXPORT_IDENTITY") {
    return sendBridgeMessage(
      buildNoPayloadMessage(requestId, type),
      (p) => (isExportIdentityPayload(p) ? p : null),
      timeoutMs
    );
  }

  if (type === "GET_PRIVACY_SETTINGS") {
    return sendBridgeMessage(
      buildNoPayloadMessage(requestId, type),
      (p) => (isPrivacySettingsPayload(p) ? p : null),
      timeoutMs
    );
  }

  if (type === "SET_PRIVACY_SETTINGS") {
    const privacyPayload = payload as PrivacySettingsPayload;
    const privacyMsg: EntropyRuntimeMessage = {
      source: ENTROPY_WEB_SOURCE,
      requestId,
      type: "SET_PRIVACY_SETTINGS",
      payload: privacyPayload
    };
    return sendBridgeMessage(
      privacyMsg,
      (p) => (isPrivacySettingsPayload(p) ? p : null),
      timeoutMs
    );
  }

  if (type === "TAG_CONTENT") {
    const tagPayload = payload as TagContentPayload;
    const tagMsg: EntropyRuntimeMessage = {
      source: ENTROPY_WEB_SOURCE,
      requestId,
      type: "TAG_CONTENT",
      payload: tagPayload
    };
    return sendBridgeMessage(
      tagMsg,
      (p) => (isTagContentResultPayload(p) ? p : null),
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

export function getColdStorageAssignments(): Promise<ColdStorageStatusPayload> {
  return sendExtensionRequest("GET_COLD_STORAGE_ASSIGNMENTS");
}

export function releaseColdAssignment(payload: ReleaseColdAssignmentPayload): Promise<ColdStorageStatusPayload> {
  return sendExtensionRequest("RELEASE_COLD_ASSIGNMENT", payload);
}

export function getNodeMetrics(): Promise<NodeMetricsPayload> {
  return sendExtensionRequest("GET_NODE_METRICS");
}

export function exportIdentity(): Promise<ExportIdentityPayload> {
  return sendExtensionRequest("EXPORT_IDENTITY");
}

export function tagContent(rootHash: string, tag: string): Promise<TagContentResultPayload> {
  return sendExtensionRequest("TAG_CONTENT", { rootHash, tag });
}

export function checkLocalChunks(hashes: string[], timeoutMs = 3000): Promise<CheckLocalChunksResultPayload> {
  const requestId = createEntropyRequestId("web");
  const message: EntropyRuntimeMessage = {
    source: ENTROPY_WEB_SOURCE,
    requestId,
    type: "CHECK_LOCAL_CHUNKS",
    payload: { hashes }
  };

  return sendBridgeMessage(
    message,
    (p) => (isCheckLocalChunksResultPayload(p) ? p : null),
    timeoutMs
  );
}

export function getChunk(payload: GetChunkPayload, timeoutMs = 5000): Promise<ChunkDataPayload | null> {
  const requestId = createEntropyRequestId("web");
  const message: EntropyRuntimeMessage = { source: ENTROPY_WEB_SOURCE, requestId, type: "GET_CHUNK", payload };

  return new Promise((resolve, reject) => {
    const timeoutHandle = window.setTimeout(() => {
      window.removeEventListener("message", handleResponse);
      reject(new Error("GET_CHUNK bridge timeout"));
    }, timeoutMs);

    function handleResponse(event: MessageEvent): void {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        !event.data ||
        event.data.type !== "EXTENSION_RESPONSE"
      ) return;
      if (!isEntropyExtensionResponseEvent(event.data)) return;
      if (event.data.requestId !== requestId || event.data.requestType !== "GET_CHUNK") return;

      window.clearTimeout(timeoutHandle);
      window.removeEventListener("message", handleResponse);

      console.log("[getChunk] bridge response payload:", event.data.payload, "error:", event.data.error);

      if (typeof event.data.error === "string" && event.data.error.length > 0) {
        reject(new Error(event.data.error));
        return;
      }

      // null payload means chunk not found — that is a valid resolved value
      resolve((event.data.payload as ChunkDataPayload) ?? null);
    }

    window.addEventListener("message", handleResponse);
    console.log("[getChunk] sending GET_CHUNK for hash:", payload.hash.slice(0, 12) + "…");
    window.postMessage(message, window.location.origin);
  });
}

export function subscribeToNodeStatusUpdates(
  onUpdate: (status: NodeStatusPayload) => void
): () => void {
  function handleRuntimePush(event: MessageEvent): void {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      !isEntropyRuntimePushMessage(event.data)
    ) {
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
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      !isEntropyRuntimePushMessage(event.data)
    ) {
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
// ---------------------------------------------------------------------------
// NIP-07 Sign Allowlist
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWLIST_TIMEOUT_MS = 5_000;

function validateAllowlistPayload(v: unknown): SignAllowlistPayload | null {
  if (v !== null && typeof v === "object" && Array.isArray((v as SignAllowlistPayload).origins)) {
    return v as SignAllowlistPayload;
  }
  return null;
}

export function getSignAllowlist(): Promise<SignAllowlistPayload> {
  const requestId = createEntropyRequestId("sign-allowlist");
  const message = buildNoPayloadMessage(requestId, "GET_SIGN_ALLOWLIST");
  return sendBridgeMessage<SignAllowlistPayload>(message, validateAllowlistPayload, DEFAULT_ALLOWLIST_TIMEOUT_MS);
}

export function addSignOrigin(origin: string): Promise<SignAllowlistPayload> {
  const requestId = createEntropyRequestId("sign-allowlist");
  const message: EntropyRuntimeMessage = { source: ENTROPY_WEB_SOURCE, requestId, type: "ADD_SIGN_ORIGIN", payload: { origin } };
  return sendBridgeMessage<SignAllowlistPayload>(message, validateAllowlistPayload, DEFAULT_ALLOWLIST_TIMEOUT_MS);
}

export function removeSignOrigin(origin: string): Promise<SignAllowlistPayload> {
  const requestId = createEntropyRequestId("sign-allowlist");
  const message: EntropyRuntimeMessage = { source: ENTROPY_WEB_SOURCE, requestId, type: "REMOVE_SIGN_ORIGIN", payload: { origin } };
  return sendBridgeMessage<SignAllowlistPayload>(message, validateAllowlistPayload, DEFAULT_ALLOWLIST_TIMEOUT_MS);
}

// ---------------------------------------------------------------------------
// Privacy / Tor Settings
// ---------------------------------------------------------------------------

export function getPrivacySettings(): Promise<PrivacySettingsPayload> {
  return sendExtensionRequest("GET_PRIVACY_SETTINGS");
}

export function setPrivacySettings(settings: PrivacySettingsPayload): Promise<PrivacySettingsPayload> {
  return sendExtensionRequest("SET_PRIVACY_SETTINGS", settings);
}
