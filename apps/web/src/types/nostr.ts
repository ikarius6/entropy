export interface NostrProfile {
  pubkey: string;
  name?: string;
  displayName?: string;
  about?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  lud16?: string;
}

export interface ContactList {
  pubkey: string;
  follows: string[];
  relays: Record<string, { read: boolean; write: boolean }>;
}

export interface FeedItem {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  created_at: number;
  tags: string[][];
  profile?: NostrProfile;
  chunkMap?: any; // We'll type this properly later with EntropyChunkMap
}
