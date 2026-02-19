export const ENTROPY_WEB_SOURCE = "entropy-web";
export const ENTROPY_EXTENSION_SOURCE = "entropy-extension";

export interface DelegateSeedingPayload {
  rootHash: string;
  chunkHashes: string[];
  size: number;
  chunkSize: number;
  mimeType: string;
  title?: string;
}

export interface ServeChunkPayload {
  chunkHash: string;
  requestedBytes: number;
  peerPubkey: string;
}

export interface StoreChunkPayload {
  hash: string;
  rootHash: string;
  index: number;
  data: ArrayBuffer;
  pinned?: boolean;
}

export interface ImportKeypairPayload {
  privkey: string;
}

export interface PublicKeyPayload {
  pubkey: string;
}

export interface RelayStatusPayload {
  url: string;
  status: "connecting" | "connected" | "disconnected" | "error";
}

export interface NodeSettingsPayload {
  relayUrls: string[];
  relayStatuses: RelayStatusPayload[];
  seedingActive: boolean;
}

export interface RelayUrlPayload {
  url: string;
}

export interface SetSeedingActivePayload {
  active: boolean;
}

export interface NodeStatusPayload {
  delegatedCount: number;
  delegatedRootHashes: string[];
  uptimeMs: number;
  lastHeartbeatAt: number;
  signalingKindRange: string;
  signalingRangeHealthy: boolean;
}

export interface CreditHistoryItem {
  id: string;
  peerPubkey: string;
  direction: "up" | "down";
  bytes: number;
  chunkHash: string;
  timestamp: number;
}

export interface CreditSummaryPayload {
  totalUploaded: number;
  totalDownloaded: number;
  ratio: number | null;
  balance: number;
  entryCount: number;
  coldStorageEligible: boolean;
  history: Array<{
    id: string;
    peerPubkey: string;
    direction: "up" | "down";
    bytes: number;
    chunkHash: string;
    timestamp: number;
  }>;
}

export type EntropyRuntimePayload =
  | NodeStatusPayload
  | CreditSummaryPayload
  | PublicKeyPayload
  | NodeSettingsPayload;

export type EntropyRuntimeMessage =
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "DELEGATE_SEEDING";
      payload: DelegateSeedingPayload;
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "GET_NODE_STATUS";
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "HEARTBEAT";
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "GET_CREDIT_SUMMARY";
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "SERVE_CHUNK";
      payload: ServeChunkPayload;
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "STORE_CHUNK";
      payload: StoreChunkPayload;
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "IMPORT_KEYPAIR";
      payload: ImportKeypairPayload;
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "GET_PUBLIC_KEY";
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "GET_NODE_SETTINGS";
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "ADD_RELAY";
      payload: RelayUrlPayload;
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "REMOVE_RELAY";
      payload: RelayUrlPayload;
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "SET_SEEDING_ACTIVE";
      payload: SetSeedingActivePayload;
    };

export type EntropyRuntimeResponse =
  | {
      ok: true;
      requestId: string;
      type: "DELEGATE_SEEDING" | "GET_NODE_STATUS" | "HEARTBEAT" | "STORE_CHUNK";
      payload?: NodeStatusPayload;
    }
  | {
      ok: true;
      requestId: string;
      type: "GET_CREDIT_SUMMARY";
      payload: CreditSummaryPayload;
    }
  | {
      ok: true;
      requestId: string;
      type: "SERVE_CHUNK";
      payload: CreditSummaryPayload;
    }
  | {
      ok: true;
      requestId: string;
      type: "IMPORT_KEYPAIR" | "GET_PUBLIC_KEY";
      payload: PublicKeyPayload;
    }
  | {
      ok: true;
      requestId: string;
      type: "GET_NODE_SETTINGS" | "ADD_RELAY" | "REMOVE_RELAY" | "SET_SEEDING_ACTIVE";
      payload: NodeSettingsPayload;
    }
  | {
      ok: false;
      requestId: string;
      type: EntropyRuntimeMessage["type"];
      error: string;
    };

export interface EntropyExtensionResponseEvent {
  source: typeof ENTROPY_EXTENSION_SOURCE;
  type: "EXTENSION_RESPONSE";
  requestId: string;
  requestType: EntropyRuntimeMessage["type"];
  payload?: EntropyRuntimePayload;
  error?: string;
}

export type EntropyRuntimePushMessage =
  | {
      source: typeof ENTROPY_EXTENSION_SOURCE;
      type: "NODE_STATUS_UPDATE";
      payload: NodeStatusPayload;
    }
  | {
      source: typeof ENTROPY_EXTENSION_SOURCE;
      type: "CREDIT_UPDATE";
      payload: CreditSummaryPayload;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

function isEntropyRequestType(value: unknown): value is EntropyRuntimeMessage["type"] {
  return (
    value === "DELEGATE_SEEDING" ||
    value === "GET_NODE_STATUS" ||
    value === "HEARTBEAT" ||
    value === "GET_CREDIT_SUMMARY" ||
    value === "SERVE_CHUNK" ||
    value === "STORE_CHUNK" ||
    value === "IMPORT_KEYPAIR" ||
    value === "GET_PUBLIC_KEY" ||
    value === "GET_NODE_SETTINGS" ||
    value === "ADD_RELAY" ||
    value === "REMOVE_RELAY" ||
    value === "SET_SEEDING_ACTIVE"
  );
}

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function createEntropyRequestId(prefix = "entropy"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isDelegateSeedingPayload(value: unknown): value is DelegateSeedingPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.rootHash === "string" &&
    Array.isArray(value.chunkHashes) &&
    value.chunkHashes.every((hash) => typeof hash === "string") &&
    typeof value.size === "number" &&
    typeof value.chunkSize === "number" &&
    typeof value.mimeType === "string"
  );
}

export function isNodeStatusPayload(value: unknown): value is NodeStatusPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.delegatedCount === "number" &&
    Array.isArray(value.delegatedRootHashes) &&
    value.delegatedRootHashes.every((entry) => typeof entry === "string") &&
    typeof value.uptimeMs === "number" &&
    typeof value.lastHeartbeatAt === "number" &&
    typeof value.signalingKindRange === "string" &&
    typeof value.signalingRangeHealthy === "boolean"
  );
}

export function isNodeSettingsPayload(value: unknown): value is NodeSettingsPayload {
  if (!isRecord(value)) {
    return false;
  }

  if (!Array.isArray(value.relayUrls) || !value.relayUrls.every((entry) => typeof entry === "string")) {
    return false;
  }

  if (!Array.isArray(value.relayStatuses)) {
    return false;
  }

  const hasValidStatuses = value.relayStatuses.every((entry) => {
    if (!isRecord(entry)) {
      return false;
    }

    return (
      typeof entry.url === "string" &&
      (entry.status === "connecting" ||
        entry.status === "connected" ||
        entry.status === "disconnected" ||
        entry.status === "error")
    );
  });

  return hasValidStatuses && typeof value.seedingActive === "boolean";
}

export function isCreditSummaryPayload(value: unknown): value is CreditSummaryPayload {
  if (!isRecord(value) || !Array.isArray(value.history)) {
    return false;
  }

  const hasValidHistory = value.history.every((entry) => {
    if (!isRecord(entry)) {
      return false;
    }

    return (
      typeof entry.id === "string" &&
      typeof entry.peerPubkey === "string" &&
      (entry.direction === "up" || entry.direction === "down") &&
      typeof entry.bytes === "number" &&
      typeof entry.chunkHash === "string" &&
      typeof entry.timestamp === "number"
    );
  });

  return (
    typeof value.totalUploaded === "number" &&
    typeof value.totalDownloaded === "number" &&
    (typeof value.ratio === "number" || value.ratio === null) &&
    typeof value.balance === "number" &&
    typeof value.entryCount === "number" &&
    typeof value.coldStorageEligible === "boolean" &&
    hasValidHistory
  );
}

function isServeChunkPayload(value: unknown): value is ServeChunkPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.chunkHash === "string" &&
    typeof value.requestedBytes === "number" &&
    typeof value.peerPubkey === "string"
  );
}

function isStoreChunkPayload(value: unknown): value is StoreChunkPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.hash === "string" &&
    typeof value.rootHash === "string" &&
    typeof value.index === "number" &&
    isArrayBuffer(value.data) &&
    (value.pinned === undefined || typeof value.pinned === "boolean")
  );
}

function isImportKeypairPayload(value: unknown): value is ImportKeypairPayload {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.privkey === "string";
}

function isRelayUrlPayload(value: unknown): value is RelayUrlPayload {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.url === "string" && value.url.trim().length > 0;
}

function isSetSeedingActivePayload(value: unknown): value is SetSeedingActivePayload {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.active === "boolean";
}

export function isPublicKeyPayload(value: unknown): value is PublicKeyPayload {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.pubkey === "string" && value.pubkey.length > 0;
}

export function isEntropyRuntimeMessage(value: unknown): value is EntropyRuntimeMessage {
  if (
    !isRecord(value) ||
    value.source !== ENTROPY_WEB_SOURCE ||
    !isEntropyRequestType(value.type) ||
    !isRequestId(value.requestId)
  ) {
    return false;
  }

  if (value.type === "DELEGATE_SEEDING") {
    return isDelegateSeedingPayload(value.payload);
  }

  if (value.type === "SERVE_CHUNK") {
    return isServeChunkPayload(value.payload);
  }

  if (value.type === "STORE_CHUNK") {
    return isStoreChunkPayload(value.payload);
  }

  if (value.type === "IMPORT_KEYPAIR") {
    return isImportKeypairPayload(value.payload);
  }

  if (value.type === "ADD_RELAY" || value.type === "REMOVE_RELAY") {
    return isRelayUrlPayload(value.payload);
  }

  if (value.type === "SET_SEEDING_ACTIVE") {
    return isSetSeedingActivePayload(value.payload);
  }

  return true;
}

function isPayloadForRequestType(requestType: EntropyRuntimeMessage["type"], payload: unknown): boolean {
  if (requestType === "GET_CREDIT_SUMMARY" || requestType === "SERVE_CHUNK") {
    return isCreditSummaryPayload(payload);
  }

  if (
    requestType === "GET_NODE_SETTINGS" ||
    requestType === "ADD_RELAY" ||
    requestType === "REMOVE_RELAY" ||
    requestType === "SET_SEEDING_ACTIVE"
  ) {
    return isNodeSettingsPayload(payload);
  }

  if (requestType === "IMPORT_KEYPAIR" || requestType === "GET_PUBLIC_KEY") {
    return isPublicKeyPayload(payload);
  }

  return isNodeStatusPayload(payload);
}

export function isEntropyRuntimeResponse(value: unknown): value is EntropyRuntimeResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return false;
  }

  if (!isRequestId(value.requestId) || !isEntropyRequestType(value.type)) {
    return false;
  }

  if (value.ok) {
    if (value.type === "GET_CREDIT_SUMMARY" || value.type === "SERVE_CHUNK") {
      return isCreditSummaryPayload(value.payload);
    }

    if (value.type === "IMPORT_KEYPAIR" || value.type === "GET_PUBLIC_KEY") {
      return isPublicKeyPayload(value.payload);
    }

    if (
      value.type === "GET_NODE_SETTINGS" ||
      value.type === "ADD_RELAY" ||
      value.type === "REMOVE_RELAY" ||
      value.type === "SET_SEEDING_ACTIVE"
    ) {
      return isNodeSettingsPayload(value.payload);
    }

    return value.payload === undefined || isNodeStatusPayload(value.payload);
  }

  return typeof value.error === "string";
}

export function isEntropyExtensionResponseEvent(value: unknown): value is EntropyExtensionResponseEvent {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.source === ENTROPY_EXTENSION_SOURCE &&
    value.type === "EXTENSION_RESPONSE" &&
    isRequestId(value.requestId) &&
    isEntropyRequestType(value.requestType) &&
    (value.payload === undefined || isPayloadForRequestType(value.requestType, value.payload))
  );
}

export function isEntropyRuntimePushMessage(value: unknown): value is EntropyRuntimePushMessage {
  if (!isRecord(value)) {
    return false;
  }

  if (value.source !== ENTROPY_EXTENSION_SOURCE) {
    return false;
  }

  if (value.type === "NODE_STATUS_UPDATE") {
    return isNodeStatusPayload(value.payload);
  }

  if (value.type === "CREDIT_UPDATE") {
    return isCreditSummaryPayload(value.payload);
  }

  return false;
}
