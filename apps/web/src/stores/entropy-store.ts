import { create } from 'zustand';
import { RelayPool, DEFAULT_NETWORK_TAG } from '@entropy/core';
import type { EntropyChunkMap } from '@entropy/core';
import type { NostrProfile, FeedItem } from '../types/nostr';
import { sendExtensionRequest } from '../lib/extension-bridge';

const NETWORK_TAGS_STORAGE_KEY = 'entropy-network-tags';

function loadNetworkTags(): string[] {
  try {
    const raw = localStorage.getItem(NETWORK_TAGS_STORAGE_KEY);
    if (!raw) return [DEFAULT_NETWORK_TAG];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [DEFAULT_NETWORK_TAG];
    return parsed.filter((t: unknown) => typeof t === 'string' && t.trim().length > 0);
  } catch {
    return [DEFAULT_NETWORK_TAG];
  }
}

function saveNetworkTags(tags: string[]): void {
  localStorage.setItem(NETWORK_TAGS_STORAGE_KEY, JSON.stringify(tags));
}

interface ActivePlayback {
  rootHash: string;
  chunkMap: EntropyChunkMap;
  downloadedChunks: Map<number, ArrayBuffer>;
  totalChunks: number;
  bufferedUpTo: number;
}

interface EntropyState {
  // Identity
  pubkey: string | null;
  privkey: string | null;
  profile: NostrProfile | null;
  
  // Relays
  relayPool: RelayPool | null;
  relayUrls: string[];
  
  // Profile Cache
  profiles: Record<string, NostrProfile>;
  
  // Network Tags (sub-networks)
  networkTags: string[];

  // Feed
  feedEvents: FeedItem[];
  feedLoading: boolean;

  // ChunkMap cache: rootHash -> EntropyChunkMap (populated as events arrive in feed)
  chunkMapCache: Record<string, EntropyChunkMap>;
  
  // Active Playback
  activePlayback: ActivePlayback | null;
  
  // Actions
  initRelays: (urls: string[]) => Promise<void>;
  setIdentity: (pubkey: string, privkey?: string) => void;
  setProfile: (profile: NostrProfile) => void;
  cacheProfile: (pubkey: string, profile: NostrProfile) => void;
  setFeedEvents: (events: FeedItem[]) => void;
  setFeedLoading: (loading: boolean) => void;
  setNetworkTags: (tags: string[]) => void;
  cacheChunkMap: (chunkMap: EntropyChunkMap) => void;
  startPlayback: (rootHash: string, chunkMap: EntropyChunkMap) => void;
}

export const useEntropyStore = create<EntropyState>((set, get) => ({
  pubkey: null,
  privkey: null,
  profile: null,
  
  relayPool: null,
  relayUrls: [],
  
  profiles: {},
  
  networkTags: loadNetworkTags(),

  feedEvents: [],
  feedLoading: false,

  chunkMapCache: {},

  activePlayback: null,
  
  initRelays: async (urls: string[]) => {
    const pool = new RelayPool();
    pool.connect(urls);
    set({ relayUrls: urls, relayPool: pool });
  },
  
  setIdentity: (pubkey: string, privkey?: string) => {
    set({ pubkey, privkey: privkey || null });
  },

  setProfile: (profile: NostrProfile) => {
    set({ profile });
    get().cacheProfile(profile.pubkey, profile);
  },
  
  cacheProfile: (pubkey: string, profile: NostrProfile) => {
    set((state) => ({
      profiles: {
        ...state.profiles,
        [pubkey]: profile
      }
    }));
  },
  
  setFeedEvents: (events: FeedItem[]) => {
    set({ feedEvents: events });
  },
  
  setFeedLoading: (loading: boolean) => {
    set({ feedLoading: loading });
  },

  setNetworkTags: (tags: string[]) => {
    const cleaned = tags.filter(t => t.trim().length > 0).map(t => t.trim().toLowerCase());
    const final = cleaned.length > 0 ? [...new Set(cleaned)] : [DEFAULT_NETWORK_TAG];
    saveNetworkTags(final);
    set({ networkTags: final });
    // Fire-and-forget sync to extension service worker
    sendExtensionRequest('SET_NETWORK_TAGS', { tags: final }).catch(() => {
      // Extension may not be installed — ignore
    });
  },

  cacheChunkMap: (chunkMap: EntropyChunkMap) => {
    set((state) => ({
      chunkMapCache: { ...state.chunkMapCache, [chunkMap.rootHash]: chunkMap }
    }));
  },
  
  startPlayback: (rootHash: string, chunkMap: EntropyChunkMap) => {
    set({
      activePlayback: {
        rootHash,
        chunkMap,
        downloadedChunks: new Map(),
        totalChunks: chunkMap.chunks.length,
        bufferedUpTo: 0
      }
    });
  }
}));
