import Dexie, { type Table } from "dexie";

import {
  DEFAULT_BAN_DURATION_MS,
  DEFAULT_FAILED_VERIFICATION_BAN_THRESHOLD,
  type PeerReputationStore
} from "../credits/peer-reputation";
import type { PeerRecord } from "./db";

export const DEFAULT_INDEXEDDB_PEER_REPUTATION_NAME = "entropy-peer-reputation";
export const INDEXEDDB_PEER_REPUTATION_VERSION = 1;

export interface CreateIndexedDbPeerReputationStoreOptions {
  dbName?: string;
  failedVerificationBanThreshold?: number;
  /** How long a ban lasts in ms. Set to `Infinity` for permanent bans. */
  banDurationMs?: number;
  nowMs?: () => number;
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

class PeerReputationDatabase extends Dexie {
  peers!: Table<PeerRecord, string>;

  constructor(name: string) {
    super(name);

    this.version(INDEXEDDB_PEER_REPUTATION_VERSION).stores({
      peers: "pubkey, lastSeen, banned"
    });
  }
}

export class IndexedDbPeerReputationStore implements PeerReputationStore {
  private readonly db: PeerReputationDatabase;

  private readonly failedVerificationBanThreshold: number;

  private readonly banDurationMs: number;

  private readonly nowMs: () => number;

  constructor(options: CreateIndexedDbPeerReputationStoreOptions = {}) {
    const threshold =
      options.failedVerificationBanThreshold ?? DEFAULT_FAILED_VERIFICATION_BAN_THRESHOLD;

    assertPositiveInteger(threshold, "failedVerificationBanThreshold");

    this.db = new PeerReputationDatabase(
      options.dbName ?? DEFAULT_INDEXEDDB_PEER_REPUTATION_NAME
    );
    this.failedVerificationBanThreshold = threshold;
    this.banDurationMs = options.banDurationMs ?? DEFAULT_BAN_DURATION_MS;
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  close(): void {
    this.db.close();
  }

  async getPeer(pubkey: string): Promise<PeerRecord | null> {
    assertPubkey(pubkey);
    const peer = await this.db.peers.get(pubkey);
    return peer ? clonePeer(peer) : null;
  }

  async listPeers(): Promise<PeerRecord[]> {
    const peers = await this.db.peers.toArray();
    return peers
      .sort((left, right) => right.lastSeen - left.lastSeen)
      .map(clonePeer);
  }

  async isBanned(pubkey: string): Promise<boolean> {
    assertPubkey(pubkey);
    const peer = await this.db.peers.get(pubkey);
    if (!peer || !peer.banned) return false;

    // Legacy records without bannedAt or bans that have expired → auto-unban
    if (this.banDurationMs !== Infinity) {
      const expired = peer.bannedAt == null || (this.nowMs() - peer.bannedAt >= this.banDurationMs);
      if (expired) {
        peer.banned = false;
        peer.bannedAt = undefined;
        peer.failedVerifications = 0;
        await this.db.peers.put(peer);
        return false;
      }
    }

    return true;
  }

  async recordSuccess(pubkey: string, bytes: number): Promise<PeerRecord> {
    assertPubkey(pubkey);
    assertPositiveInteger(bytes, "bytes");

    const peer = await this.getOrCreate(pubkey);
    peer.successfulTransfers += 1;
    peer.totalBytesExchanged += bytes;
    peer.lastSeen = this.nowMs();

    await this.db.peers.put(peer);
    return clonePeer(peer);
  }

  async recordFailedVerification(pubkey: string): Promise<PeerRecord> {
    assertPubkey(pubkey);

    const peer = await this.getOrCreate(pubkey);
    peer.failedVerifications += 1;
    peer.lastSeen = this.nowMs();

    if (peer.failedVerifications >= this.failedVerificationBanThreshold) {
      peer.banned = true;
      peer.bannedAt = this.nowMs();
    }

    await this.db.peers.put(peer);
    return clonePeer(peer);
  }

  async setBanned(pubkey: string, banned: boolean): Promise<PeerRecord> {
    assertPubkey(pubkey);

    const peer = await this.getOrCreate(pubkey);
    peer.banned = banned;
    peer.bannedAt = banned ? this.nowMs() : undefined;
    if (!banned) peer.failedVerifications = 0;
    peer.lastSeen = this.nowMs();

    await this.db.peers.put(peer);
    return clonePeer(peer);
  }

  private async getOrCreate(pubkey: string): Promise<PeerRecord> {
    const existing = await this.db.peers.get(pubkey);
    if (existing) {
      return existing;
    }

    const created = createEmptyPeer(pubkey, this.nowMs());
    await this.db.peers.put(created);
    return created;
  }
}

export function createIndexedDbPeerReputationStore(
  options: CreateIndexedDbPeerReputationStoreOptions = {}
): IndexedDbPeerReputationStore {
  return new IndexedDbPeerReputationStore(options);
}
