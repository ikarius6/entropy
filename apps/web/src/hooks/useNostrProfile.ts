import { useState, useEffect } from "react";
import { useEntropyStore } from "../stores/entropy-store";
import { KINDS } from "../lib/constants";
import type { NostrEvent } from "@entropy/core";
import type { NostrProfile } from "../types/nostr";

export function useNostrProfile(pubkey: string | null) {
  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { relayPool, relayUrls, profiles, cacheProfile, setProfile: setStoreProfile } = useEntropyStore();

  useEffect(() => {
    if (!pubkey) {
      setProfile(null);
      setIsLoading(false);
      return;
    }

    // Check the store's profile cache first
    const cached = profiles[pubkey];
    if (cached) {
      setProfile(cached);
      return;
    }

    // Also check the current user's profile in the store
    const storeProfile = useEntropyStore.getState().profile;
    if (storeProfile && storeProfile.pubkey === pubkey) {
      setProfile(storeProfile);
      return;
    }

    if (!relayPool || relayUrls.length === 0) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    let latestCreatedAt = 0;

    // Subscribe to kind:0 (NIP-01 metadata) for this pubkey
    const sub = relayPool.subscribe(
      [{ kinds: [KINDS.METADATA], authors: [pubkey], limit: 1 }],
      (event: NostrEvent) => {
        if (!isMounted) return;
        // Keep only the newest metadata event
        if (event.created_at <= latestCreatedAt) return;
        latestCreatedAt = event.created_at;

        try {
          const meta = JSON.parse(event.content);
          const parsed: NostrProfile = {
            pubkey,
            name: meta.name,
            displayName: meta.display_name || meta.displayName,
            about: meta.about,
            picture: meta.picture,
            banner: meta.banner,
            nip05: meta.nip05,
            lud16: meta.lud16,
          };

          setProfile(parsed);
          cacheProfile(pubkey, parsed);

          // If this is the logged-in user, also update the store's primary profile
          if (pubkey === useEntropyStore.getState().pubkey) {
            setStoreProfile(parsed);
          }
        } catch (err) {
          console.warn("[useNostrProfile] failed to parse kind:0 content:", err);
        }
      },
      () => {
        // EOSE — done loading
        if (isMounted) {
          setIsLoading(false);
        }
        sub.unsubscribe();
      }
    );

    return () => {
      isMounted = false;
      sub.unsubscribe();
    };
  }, [pubkey, relayPool, relayUrls.join(",")]);

  return { profile, isLoading };
}
