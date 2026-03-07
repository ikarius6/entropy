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
  /** For kind:6 reposts — the inner reposted event parsed from content */
  repostedEvent?: FeedItem;
  /** Pubkey of the user who reposted (the kind:6 author) */
  repostedBy?: string;
  /** Whether this kind:1 is a reply (has NIP-10 e-tags) */
  isReply?: boolean;
  /** The event id this replies to (NIP-10 "reply" or last "e" tag) */
  replyToId?: string;
}
