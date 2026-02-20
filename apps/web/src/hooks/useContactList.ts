import { useState, useEffect } from "react";
import { useEntropyStore } from "../stores/entropy-store";
import type { NostrEvent } from "@entropy/core";

export function useContactList(pubkey: string | null) {
  const [follows, setFollows] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { relayPool, relayUrls } = useEntropyStore();

  useEffect(() => {
    if (!pubkey || !relayPool || relayUrls.length === 0) {
      setFollows([]);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    let latestCreatedAt = 0;
    let latestFollows: string[] = [];
    let subHandle: { unsubscribe: () => void } | null = null;

    subHandle = relayPool.subscribe(
      [{ kinds: [3], authors: [pubkey], limit: 1 }],
      (event: NostrEvent) => {
        if (!isMounted) return;
        if (event.created_at <= latestCreatedAt) return;
        latestCreatedAt = event.created_at;
        latestFollows = event.tags
          .filter(t => t[0] === "p" && typeof t[1] === "string" && t[1].length === 64)
          .map(t => t[1]);
        setFollows(latestFollows);
      },
      () => {
        if (!isMounted) return;
        setFollows(latestFollows);
        setIsLoading(false);
        subHandle?.unsubscribe();
      }
    );

    return () => {
      isMounted = false;
      subHandle?.unsubscribe();
    };
  }, [pubkey, relayPool, relayUrls.join(",")]);

  return { follows, isLoading };
}
