import type { CreditEntry } from "../credits/ledger";
import { createChunkStore, type ChunkStore, type StoredChunk } from "./chunk-store";

export const ENTROPY_DB_NAME = "entropy";
export const ENTROPY_DB_VERSION = 1;

export interface PeerRecord {
  pubkey: string;
  successfulTransfers: number;
  failedVerifications: number;
  totalBytesExchanged: number;
  lastSeen: number;
  banned: boolean;
  /** Epoch ms when the peer was banned. Used for ban expiration. */
  bannedAt?: number;
}

export interface EntropyDb {
  name: string;
  version: number;
  chunks: ChunkStore;
  credits: CreditEntry[];
  peers: PeerRecord[];
}

export interface CreateEntropyDbOptions {
  name?: string;
  version?: number;
  seedChunks?: StoredChunk[];
  credits?: CreditEntry[];
  peers?: PeerRecord[];
}

export function createEntropyDb(options: CreateEntropyDbOptions = {}): EntropyDb {
  return {
    name: options.name ?? ENTROPY_DB_NAME,
    version: options.version ?? ENTROPY_DB_VERSION,
    chunks: createChunkStore(options.seedChunks ?? []),
    credits: [...(options.credits ?? [])],
    peers: [...(options.peers ?? [])]
  };
}
