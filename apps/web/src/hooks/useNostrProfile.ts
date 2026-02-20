import { useState, useEffect } from "react";
import { useEntropyStore } from "../stores/entropy-store";
import type { NostrProfile } from "../types/nostr";

export function useNostrProfile(pubkey: string | null) {
  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { relayPool, relayUrls } = useEntropyStore();

  useEffect(() => {
    if (!pubkey) {
      setProfile(null);
      setIsLoading(false);
      return;
    }

    // Check if we already have it in store for the current user
    const storeProfile = useEntropyStore.getState().profile;
    if (storeProfile && storeProfile.pubkey === pubkey) {
      setProfile(storeProfile);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    const loadProfile = async () => {
      if (!relayPool || relayUrls.length === 0) {
        setIsLoading(false);
        return;
      }

      try {
        // Here we would use relayPool.subscribe to fetch kind:0
        // For now, return a mock profile
        await new Promise(r => setTimeout(r, 500));
        
        if (isMounted) {
          const mockProfile: NostrProfile = {
            pubkey,
            name: "Entropy User",
            displayName: "Entropy P2P Node",
            about: "Testing Phase 4 of Entropy Network",
          };
          
          setProfile(mockProfile);
          
          // If this is the logged in user, update the store
          if (pubkey === useEntropyStore.getState().pubkey) {
            useEntropyStore.getState().setProfile(mockProfile);
          }
        }
      } catch (err) {
        console.error("Failed to load Nostr profile:", err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, [pubkey, relayPool, relayUrls]);

  return { profile, isLoading };
}
