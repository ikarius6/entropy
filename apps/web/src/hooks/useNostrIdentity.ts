import { useEffect, useState } from "react";
import { useEntropyStore } from "../stores/entropy-store";
import { getExtensionPublicKey } from "../lib/extension-bridge";
import { useNostrProfile } from "./useNostrProfile";

export function useNostrIdentity() {
  const { pubkey, setIdentity } = useEntropyStore();
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  // Derive connection state directly from the store — no local copy
  const isConnected = !!pubkey;

  // We'll load the profile once we have the pubkey
  const { profile, isLoading: isProfileLoading } = useNostrProfile(pubkey);

  const connect = async () => {
    if (isConnecting) return;
    try {
      setError(null);
      setIsConnecting(true);
      console.log("[useNostrIdentity] Attempting getExtensionPublicKey()...");
      const payload = await getExtensionPublicKey();
      console.log("[useNostrIdentity] Raw payload received:", payload);
      if (payload && payload.pubkey) {
        console.log("[useNostrIdentity] pubkey OK:", payload.pubkey);
        setIdentity(payload.pubkey);
      } else {
        console.warn("[useNostrIdentity] payload missing pubkey:", payload);
        throw new Error("No pubkey returned from extension");
      }
    } catch (err) {
      console.error("[useNostrIdentity] connect() failed:", err);
      setError(err instanceof Error ? err.message : "Failed to connect to extension");
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    setIdentity("");
  };

  useEffect(() => {
    console.log("[useNostrIdentity] mount — pubkey in store:", pubkey);
    if (!pubkey) {
      console.log("[useNostrIdentity] no pubkey, auto-connecting...");
      connect().catch((err) => {
        console.error("[useNostrIdentity] auto-connect error:", err);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    pubkey,
    profile,
    isConnected,
    isConnecting,
    isProfileLoading,
    error,
    connect,
    disconnect
  };
}
