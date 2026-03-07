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

function isColdStorageAssignmentPayload(value: unknown): value is ColdStorageAssignmentPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.chunkHash === "string" &&
    typeof value.rootHash === "string" &&
    typeof value.assignedAt === "number" &&
    typeof value.expiresAt === "number" &&
    typeof value.premiumCredits === "number" &&
    (value.replicationCount === undefined || typeof value.replicationCount === "number")
  );
}

export function isColdStorageStatusPayload(value: unknown): value is ColdStorageStatusPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value.assignments) &&
    value.assignments.every((assignment) => isColdStorageAssignmentPayload(assignment)) &&
    typeof value.totalPremiumCredits === "number"
  );
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
  data: number[];
  pinned?: boolean;
}

export interface ImportKeypairPayload {
  privkey: string;
}

export interface ExportIdentityPayload {
  pubkey: string;
  privkey: string;
}

export interface GetChunkPayload {
  hash: string;
  rootHash?: string;
  gatekeepers?: string[];
}

export interface CheckLocalChunksPayload {
  hashes: string[];
}

export interface CheckLocalChunksResultPayload {
  total: number;
  local: number;
  localBytes: number;
}

export interface ChunkDataPayload {
  hash: string;
  rootHash: string;
  index: number;
  data: number[];
}

export interface SignEventPayload {
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
}

export interface SignedEventPayload {
  id: string;
  pubkey: string;
  sig: string;
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
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

export interface ColdStorageAssignmentPayload {
  chunkHash: string;
  rootHash: string;
  assignedAt: number;
  expiresAt: number;
  premiumCredits: number;
  replicationCount?: number;
}

export interface ColdStorageStatusPayload {
  assignments: ColdStorageAssignmentPayload[];
  totalPremiumCredits: number;
}

export interface ReleaseColdAssignmentPayload {
  chunkHash: string;
}

export interface TagContentPayload {
  rootHash: string;
  tag: string;
}

// NIP-07 origin allowlist — controls which page origins can call signEvent.
export interface SignAllowlistPayload {
  origins: string[];
}

export interface SignOriginPayload {
  origin: string;
}

export interface TagContentResultPayload {
  added: boolean;
  tags: Array<{ name: string; counter: number; updatedAt: number }>;
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
  integrityValid: boolean;
  trustScore: number;
  receiptVerifiedEntries: number;
  history: Array<{
    id: string;
    peerPubkey: string;
    direction: "up" | "down";
    bytes: number;
    chunkHash: string;
    timestamp: number;
  }>;
}

// ---------------------------------------------------------------------------
// Privacy / Tor settings
// ---------------------------------------------------------------------------

export interface TurnServerConfig {
  urls: string;
  username?: string;
  credential?: string;
}

export interface IceServerConfig {
  urls: string;
}

export interface PrivacySettingsPayload {
  /** Route Nostr relay connections through Tor SOCKS5 proxy. */
  torEnabled: boolean;
  /** SOCKS5 proxy address for Tor (default: 127.0.0.1:9150). */
  torProxyAddress: string;
  /** Force WebRTC to use TURN-only (relay) mode — hides IP from peers but requires a TURN server. */
  forceRelay: boolean;
  /** User-configured TURN server(s). Required when forceRelay is true. */
  turnServers: TurnServerConfig[];
  /** Strip local/host ICE candidates from signaling messages. */
  filterLocalCandidates: boolean;
  /** User-configured ICE (STUN) servers. Defaults to Google public STUN servers when empty/undefined. */
  customIceServers?: IceServerConfig[];
}

export function isPrivacySettingsPayload(value: unknown): value is PrivacySettingsPayload {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.torEnabled !== "boolean" ||
    typeof value.torProxyAddress !== "string" ||
    typeof value.forceRelay !== "boolean" ||
    !Array.isArray(value.turnServers) ||
    !value.turnServers.every((s) => {
      if (!isRecord(s)) return false;
      return typeof s.urls === "string";
    }) ||
    typeof value.filterLocalCandidates !== "boolean"
  ) {
    return false;
  }

  if (value.customIceServers !== undefined) {
    if (
      !Array.isArray(value.customIceServers) ||
      !value.customIceServers.every((s) => isRecord(s) && typeof s.urls === "string")
    ) {
      return false;
    }
  }

  return true;
}

export const DEFAULT_ICE_SERVERS_CONFIG: IceServerConfig[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettingsPayload = {
  torEnabled: false,
  torProxyAddress: "127.0.0.1:9150",
  forceRelay: false,
  turnServers: [],
  filterLocalCandidates: false,
  customIceServers: undefined,
};

export interface NodeMetricsPayload {
  chunksServed: number;
  bytesServed: number;
  chunksDownloaded: number;
  bytesDownloaded: number;
  peersConnected: number;
  coldStorageAssignments: number;
  uptimeMs: number;
  lastHealthCheck: number | null;
  healthStatus: "healthy" | "degraded" | "unknown";
}

export type EntropyRuntimePayload =
  | NodeStatusPayload
  | ColdStorageStatusPayload
  | CreditSummaryPayload
  | NodeMetricsPayload
  | PrivacySettingsPayload
  | PublicKeyPayload
  | ExportIdentityPayload
  | NodeSettingsPayload
  | SignedEventPayload
  | ChunkDataPayload
  | CheckLocalChunksResultPayload
  | TagContentResultPayload
  | SignAllowlistPayload;

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
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "SIGN_EVENT";
      payload: SignEventPayload;
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "GET_CHUNK";
      payload: GetChunkPayload;
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "GET_COLD_STORAGE_ASSIGNMENTS";
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "RELEASE_COLD_ASSIGNMENT";
      payload: ReleaseColdAssignmentPayload;
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "GET_NODE_METRICS";
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "CHECK_LOCAL_CHUNKS";
      payload: CheckLocalChunksPayload;
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "EXPORT_IDENTITY";
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "GET_PRIVACY_SETTINGS";
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "SET_PRIVACY_SETTINGS";
      payload: PrivacySettingsPayload;
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "TAG_CONTENT";
      payload: TagContentPayload;
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "GET_SIGN_ALLOWLIST";
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "ADD_SIGN_ORIGIN";
      payload: SignOriginPayload;
    }
  | {
      source: typeof ENTROPY_WEB_SOURCE;
      requestId: string;
      type: "REMOVE_SIGN_ORIGIN";
      payload: SignOriginPayload;
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
      type: "EXPORT_IDENTITY";
      payload: ExportIdentityPayload;
    }
  | {
      ok: true;
      requestId: string;
      type: "SIGN_EVENT";
      payload: SignedEventPayload;
    }
  | {
      ok: true;
      requestId: string;
      type: "GET_CHUNK";
      payload: ChunkDataPayload | null;
    }
  | {
      ok: true;
      requestId: string;
      type: "GET_NODE_SETTINGS" | "ADD_RELAY" | "REMOVE_RELAY" | "SET_SEEDING_ACTIVE";
      payload: NodeSettingsPayload;
    }
  | {
      ok: true;
      requestId: string;
      type: "GET_COLD_STORAGE_ASSIGNMENTS" | "RELEASE_COLD_ASSIGNMENT";
      payload: ColdStorageStatusPayload;
    }
  | {
      ok: true;
      requestId: string;
      type: "GET_NODE_METRICS";
      payload: NodeMetricsPayload;
    }
  | {
      ok: true;
      requestId: string;
      type: "CHECK_LOCAL_CHUNKS";
      payload: CheckLocalChunksResultPayload;
    }
  | {
      ok: true;
      requestId: string;
      type: "TAG_CONTENT";
      payload: TagContentResultPayload;
    }
  | {
      ok: true;
      requestId: string;
      type: "GET_PRIVACY_SETTINGS" | "SET_PRIVACY_SETTINGS";
      payload: PrivacySettingsPayload;
    }
  | {
      ok: true;
      requestId: string;
      type: "GET_SIGN_ALLOWLIST" | "ADD_SIGN_ORIGIN" | "REMOVE_SIGN_ORIGIN";
      payload: SignAllowlistPayload;
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
    value === "SET_SEEDING_ACTIVE" ||
    value === "SIGN_EVENT" ||
    value === "GET_CHUNK" ||
    value === "GET_COLD_STORAGE_ASSIGNMENTS" ||
    value === "RELEASE_COLD_ASSIGNMENT" ||
    value === "GET_NODE_METRICS" ||
    value === "CHECK_LOCAL_CHUNKS" ||
    value === "EXPORT_IDENTITY" ||
    value === "TAG_CONTENT" ||
    value === "GET_PRIVACY_SETTINGS" ||
    value === "SET_PRIVACY_SETTINGS" ||
    value === "GET_SIGN_ALLOWLIST" ||
    value === "ADD_SIGN_ORIGIN" ||
    value === "REMOVE_SIGN_ORIGIN"
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
    typeof value.integrityValid === "boolean" &&
    typeof value.trustScore === "number" &&
    typeof value.receiptVerifiedEntries === "number" &&
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
    Array.isArray(value.data) &&
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

  if (typeof value.url !== "string" || value.url.trim().length === 0) {
    return false;
  }

  // Enforce ws(s):// protocol at the bridge level — defense-in-depth before
  // the background script's stricter normalizeRelayUrl runs.
  return /^wss?:\/\//i.test(value.url.trim());
}

function isSetSeedingActivePayload(value: unknown): value is SetSeedingActivePayload {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.active === "boolean";
}

function isReleaseColdAssignmentPayload(value: unknown): value is ReleaseColdAssignmentPayload {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.chunkHash === "string" && value.chunkHash.length > 0;
}

function isTagContentPayload(value: unknown): value is TagContentPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.rootHash === "string" &&
    value.rootHash.length > 0 &&
    typeof value.tag === "string" &&
    value.tag.length > 0
  );
}

export function isTagContentResultPayload(value: unknown): value is TagContentResultPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.added === "boolean" &&
    Array.isArray(value.tags) &&
    value.tags.every((t) => {
      if (!isRecord(t)) return false;
      return typeof t.name === "string" && typeof t.counter === "number" && typeof t.updatedAt === "number";
    })
  );
}

function isCheckLocalChunksPayload(value: unknown): value is CheckLocalChunksPayload {
  if (!isRecord(value)) {
    return false;
  }

  return Array.isArray(value.hashes) && value.hashes.every((h) => typeof h === "string");
}

export function isCheckLocalChunksResultPayload(value: unknown): value is CheckLocalChunksResultPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.total === "number" &&
    typeof value.local === "number" &&
    typeof value.localBytes === "number"
  );
}

export function isNodeMetricsPayload(value: unknown): value is NodeMetricsPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.chunksServed === "number" &&
    typeof value.bytesServed === "number" &&
    typeof value.chunksDownloaded === "number" &&
    typeof value.bytesDownloaded === "number" &&
    typeof value.peersConnected === "number" &&
    typeof value.coldStorageAssignments === "number" &&
    typeof value.uptimeMs === "number" &&
    (value.lastHealthCheck === null || typeof value.lastHealthCheck === "number") &&
    (value.healthStatus === "healthy" ||
      value.healthStatus === "degraded" ||
      value.healthStatus === "unknown")
  );
}

export function isPublicKeyPayload(value: unknown): value is PublicKeyPayload {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.pubkey === "string" && value.pubkey.length > 0;
}

export function isExportIdentityPayload(value: unknown): value is ExportIdentityPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.pubkey === "string" &&
    value.pubkey.length > 0 &&
    typeof value.privkey === "string" &&
    value.privkey.length > 0
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

  if (value.type === "RELEASE_COLD_ASSIGNMENT") {
    return isReleaseColdAssignmentPayload(value.payload);
  }

  if (value.type === "CHECK_LOCAL_CHUNKS") {
    return isCheckLocalChunksPayload(value.payload);
  }

  if (value.type === "TAG_CONTENT") {
    return isTagContentPayload(value.payload);
  }

  if (value.type === "SET_PRIVACY_SETTINGS") {
    return isPrivacySettingsPayload(value.payload);
  }

  if (value.type === "ADD_SIGN_ORIGIN" || value.type === "REMOVE_SIGN_ORIGIN") {
    return isRecord(value.payload) && typeof (value.payload as Record<string, unknown>).origin === "string";
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

  if (requestType === "EXPORT_IDENTITY") {
    return isExportIdentityPayload(payload);
  }

  if (requestType === "GET_CHUNK") {
    // null means chunk not found — valid response
    return payload === null || payload === undefined || isRecord(payload);
  }

  if (requestType === "GET_COLD_STORAGE_ASSIGNMENTS" || requestType === "RELEASE_COLD_ASSIGNMENT") {
    return isColdStorageStatusPayload(payload);
  }

  if (requestType === "GET_NODE_METRICS") {
    return isNodeMetricsPayload(payload);
  }

  if (requestType === "CHECK_LOCAL_CHUNKS") {
    return isCheckLocalChunksResultPayload(payload);
  }

  if (requestType === "TAG_CONTENT") {
    return isTagContentResultPayload(payload);
  }

  if (requestType === "SIGN_EVENT") {
    return isRecord(payload) && typeof payload.id === "string" && typeof payload.sig === "string";
  }

  if (requestType === "GET_PRIVACY_SETTINGS" || requestType === "SET_PRIVACY_SETTINGS") {
    return isPrivacySettingsPayload(payload);
  }

  if (
    requestType === "GET_SIGN_ALLOWLIST" ||
    requestType === "ADD_SIGN_ORIGIN" ||
    requestType === "REMOVE_SIGN_ORIGIN"
  ) {
    return isRecord(payload) && Array.isArray((payload as Record<string, unknown>).origins);
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

    if (value.type === "EXPORT_IDENTITY") {
      return isExportIdentityPayload(value.payload);
    }

    if (
      value.type === "GET_NODE_SETTINGS" ||
      value.type === "ADD_RELAY" ||
      value.type === "REMOVE_RELAY" ||
      value.type === "SET_SEEDING_ACTIVE"
    ) {
      return isNodeSettingsPayload(value.payload);
    }

    if (value.type === "GET_PRIVACY_SETTINGS" || value.type === "SET_PRIVACY_SETTINGS") {
      return isPrivacySettingsPayload(value.payload);
    }

    if (value.type === "GET_COLD_STORAGE_ASSIGNMENTS" || value.type === "RELEASE_COLD_ASSIGNMENT") {
      return isColdStorageStatusPayload(value.payload);
    }

    if (value.type === "CHECK_LOCAL_CHUNKS") {
      return isCheckLocalChunksResultPayload(value.payload);
    }

    if (value.type === "TAG_CONTENT") {
      return isTagContentResultPayload(value.payload);
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
