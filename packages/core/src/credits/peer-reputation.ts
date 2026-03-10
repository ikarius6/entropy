import type { PeerRecord } from "../storage/db";

export const DEFAULT_FAILED_VERIFICATION_BAN_THRESHOLD = 3;

/** Default ban duration: 30 minutes. */
export const DEFAULT_BAN_DURATION_MS = 30 * 60 * 1000;

export interface CreatePeerReputationStoreOptions {
  failedVerificationBanThreshold?: number;
  /** How long a ban lasts in ms. Set to `Infinity` for permanent bans. */
  banDurationMs?: number;
  nowMs?: () => number;
  seedPeers?: PeerRecord[];
}

export interface PeerReputationStore {
  getPeer(pubkey: string): Promise<PeerRecord | null>;
  listPeers(): Promise<PeerRecord[]>;
  isBanned(pubkey: string): Promise<boolean>;
  recordSuccess(pubkey: string, bytes: number): Promise<PeerRecord>;
  recordFailedVerification(pubkey: string): Promise<PeerRecord>;
  setBanned(pubkey: string, banned: boolean): Promise<PeerRecord>;
}

function clonePeer(peer: PeerRecord): PeerRecord {
  return { ...peer };
}

function createEmptyPeer(pubkey: string, nowMs: number): PeerRecord {
  return {
    pubkey,
    successfulTransfers: 0,
    failedVerifications: 0,
    totalBytesExchanged: 0,
    lastSeen: nowMs,
    banned: false
  };
}

function assertPubkey(pubkey: string): void {
  if (pubkey.length === 0) {
    throw new Error("pubkey is required.");
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

class InMemoryPeerReputationStore implements PeerReputationStore {
  private readonly peers = new Map<string, PeerRecord>();

  private readonly failedVerificationBanThreshold: number;

  private readonly banDurationMs: number;

  private readonly nowMs: () => number;

  constructor(options: CreatePeerReputationStoreOptions = {}) {
    const threshold = options.failedVerificationBanThreshold ?? DEFAULT_FAILED_VERIFICATION_BAN_THRESHOLD;

    assertPositiveInteger(threshold, "failedVerificationBanThreshold");

    this.failedVerificationBanThreshold = threshold;
    this.banDurationMs = options.banDurationMs ?? DEFAULT_BAN_DURATION_MS;
    this.nowMs = options.nowMs ?? (() => Date.now());

    for (const peer of options.seedPeers ?? []) {
      assertPubkey(peer.pubkey);
      this.peers.set(peer.pubkey, clonePeer(peer));
    }
  }

  async getPeer(pubkey: string): Promise<PeerRecord | null> {
    assertPubkey(pubkey);
    const peer = this.peers.get(pubkey);
    return peer ? clonePeer(peer) : null;
  }

  async listPeers(): Promise<PeerRecord[]> {
    return [...this.peers.values()]
      .sort((left, right) => right.lastSeen - left.lastSeen)
      .map(clonePeer);
  }

  async isBanned(pubkey: string): Promise<boolean> {
    assertPubkey(pubkey);
    const peer = this.peers.get(pubkey);
    if (!peer || !peer.banned) return false;

    // Legacy records without bannedAt or bans that have expired → auto-unban
    if (this.banDurationMs !== Infinity) {
      const expired = peer.bannedAt == null || (this.nowMs() - peer.bannedAt >= this.banDurationMs);
      if (expired) {
        peer.banned = false;
        peer.bannedAt = undefined;
        peer.failedVerifications = 0;
        this.peers.set(pubkey, peer);
        return false;
      }
    }

    return true;
  }

  async recordSuccess(pubkey: string, bytes: number): Promise<PeerRecord> {
    assertPubkey(pubkey);
    assertPositiveInteger(bytes, "bytes");

    const peer = this.getOrCreate(pubkey);
    peer.successfulTransfers += 1;
    peer.totalBytesExchanged += bytes;
    peer.lastSeen = this.nowMs();

    this.peers.set(pubkey, peer);
    return clonePeer(peer);
  }

  async recordFailedVerification(pubkey: string): Promise<PeerRecord> {
    assertPubkey(pubkey);

    const peer = this.getOrCreate(pubkey);
    peer.failedVerifications += 1;
    peer.lastSeen = this.nowMs();

    if (peer.failedVerifications >= this.failedVerificationBanThreshold) {
      peer.banned = true;
      peer.bannedAt = this.nowMs();
    }

    this.peers.set(pubkey, peer);
    return clonePeer(peer);
  }

  async setBanned(pubkey: string, banned: boolean): Promise<PeerRecord> {
    assertPubkey(pubkey);

    const peer = this.getOrCreate(pubkey);
    peer.banned = banned;
    peer.bannedAt = banned ? this.nowMs() : undefined;
    if (!banned) peer.failedVerifications = 0;
    peer.lastSeen = this.nowMs();

    this.peers.set(pubkey, peer);
    return clonePeer(peer);
  }

  private getOrCreate(pubkey: string): PeerRecord {
    return this.peers.get(pubkey) ?? createEmptyPeer(pubkey, this.nowMs());
  }
}

export function createPeerReputationStore(
  options: CreatePeerReputationStoreOptions = {}
): PeerReputationStore {
  return new InMemoryPeerReputationStore(options);
}
