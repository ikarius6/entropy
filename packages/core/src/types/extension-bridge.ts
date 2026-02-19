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

export interface NodeStatusPayload {
  delegatedCount: number;
  delegatedRootHashes: string[];
  uptimeMs: number;
  lastHeartbeatAt: number;
  signalingKindRange: string;
  signalingRangeHealthy: boolean;
}

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
    };

export type EntropyRuntimeResponse =
  | {
      ok: true;
      requestId: string;
      type: EntropyRuntimeMessage["type"];
      payload?: NodeStatusPayload;
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
  payload?: NodeStatusPayload;
  error?: string;
}

export interface EntropyRuntimePushMessage {
  source: typeof ENTROPY_EXTENSION_SOURCE;
  type: "NODE_STATUS_UPDATE";
  payload: NodeStatusPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEntropyRequestType(value: unknown): value is EntropyRuntimeMessage["type"] {
  return value === "DELEGATE_SEEDING" || value === "GET_NODE_STATUS" || value === "HEARTBEAT";
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

  return true;
}

export function isEntropyRuntimeResponse(value: unknown): value is EntropyRuntimeResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return false;
  }

  if (!isRequestId(value.requestId) || !isEntropyRequestType(value.type)) {
    return false;
  }

  if (value.ok) {
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
    isEntropyRequestType(value.requestType)
  );
}

export function isEntropyRuntimePushMessage(value: unknown): value is EntropyRuntimePushMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.source === ENTROPY_EXTENSION_SOURCE &&
    value.type === "NODE_STATUS_UPDATE" &&
    isNodeStatusPayload(value.payload)
  );
}
