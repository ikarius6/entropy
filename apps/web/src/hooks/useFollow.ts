import { useState } from "react";
import { useEntropyStore } from "../stores/entropy-store";
import { useContactList } from "./useContactList";

/**
 * Provides follow / unfollow actions for a given target pubkey.
 *
 * `useContactList` is a one-shot read (it unsubscribes after EOSE), so it
 * won't automatically reflect a kind:3 we just published. We keep a local
 * `optimisticFollowing` override that flips immediately on toggle so the UI
 * stays correct without waiting for the relay to echo the event.
 */
export function useFollow(targetPubkey: string | null) {
  const { pubkey: myPubkey, relayPool } = useEntropyStore();
  const { follows } = useContactList(myPubkey);
  const [isPending, setIsPending] = useState(false);
  // null = "no override yet, trust useContactList"
  const [optimisticFollowing, setOptimisticFollowing] = useState<boolean | null>(null);

  const baseIsFollowing = targetPubkey ? follows.includes(targetPubkey) : false;
  // Once the user has clicked, use the optimistic value so the UI is instant.
  const isFollowing = optimisticFollowing ?? baseIsFollowing;

  const toggle = async () => {
    if (!targetPubkey || !myPubkey || isPending) return;

    if (!window.nostr) {
      console.warn("[useFollow] NIP-07 extension not available");
      return;
    }

    const nextFollowing = !isFollowing;
    setOptimisticFollowing(nextFollowing); // flip UI immediately
    setIsPending(true);

    try {
      const nextFollows = isFollowing
        ? follows.filter((pk) => pk !== targetPubkey)
        : [...follows, targetPubkey];

      // Build a NIP-02 kind:3 contact-list event.
      const draft = {
        kind: 3,
        content: "",
        tags: nextFollows.map((pk) => ["p", pk]),
        created_at: Math.floor(Date.now() / 1000),
      };

      const signed = await window.nostr.signEvent(draft);

      if (relayPool) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        relayPool.publish(signed as any);
        console.log(
          `[useFollow] ${isFollowing ? "unfollowed" : "followed"} ${targetPubkey.slice(0, 8)}…`
        );
      } else {
        console.warn("[useFollow] no relay pool — event signed but not published");
      }
    } catch (err) {
      console.error("[useFollow] error:", err);
      // Revert optimistic update on failure
      setOptimisticFollowing(!nextFollowing);
    } finally {
      setIsPending(false);
    }
  };

  return { isFollowing, toggle, isPending };
}
