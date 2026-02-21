import { create } from 'zustand';
import { RelayPool } from '@entropy/core';
import type { EntropyChunkMap } from '@entropy/core';
import type { NostrProfile, FeedItem } from '../types/nostr';

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
