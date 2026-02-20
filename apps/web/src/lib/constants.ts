export const DEFAULT_RELAY_URLS = [
  'wss://nos.lol',              // General / Metadata
  'wss://relay.damus.io',       // General / NA
  'wss://relay.primal.net',     // Cache / Performance
  'wss://purplepag.es',         // Profiles / Discovery
];

/** Public backup pool – selected dynamically based on latency */
export const PUBLIC_BACKUP_RELAYS = [
    'wss://nostr.rocks',
    'wss://relay.wellorder.net',
    'wss://nostr.mom',
    'wss://relay.snort.social',
    'wss://nostr.bitcoiner.social',
    'wss://relay.current.fyi',
    'wss://offchain.pub',
];

/** Auth-focused relays for MLS private messages (Kind 1059 / Gift Wrap) */
export const AUTH_MLS_RELAYS = [
    'wss://auth.nostr1.com',      // NIP-42 AUTH dedicated
    'wss://nostr.wine',           // AUTH even on free tier
    'wss://jellyfish.land',       // NIP-59 / NIP-42 focused
    'wss://relay.nostrich.de',    // NIP-05 validated
];

export const KINDS = {
  METADATA: 0,
  TEXT_NOTE: 1,
  CONTACT_LIST: 3,
  ENTROPY_CHUNK_MAP: 7001,
  ENTROPY_SIGNALING: 20001,
};
