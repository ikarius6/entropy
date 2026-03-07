import { useMemo, useState, useEffect } from "react";
import { useCredits } from "./useCredits";
import { useEntropyStore } from "../stores/entropy-store";
import { checkLocalChunks } from "../lib/extension-bridge";

export interface CreditGateState {
  /** Whether the user has enough credits to download this content */
  allowed: boolean;
  /** Current credit balance in bytes */
  balance: number;
  /** Content size in bytes */
  required: number;
  /** How many bytes short the user is (0 if allowed) */
  deficit: number;
  /** Whether credit data is still loading */
  isLoading: boolean;
  /** Error fetching credits */
  error: string | null;
  /** Refresh credit state */
  refresh: () => Promise<void>;
  /** Why the gate was bypassed (null if gating normally) */
  bypassReason: "owner" | "local" | null;
}

export interface CreditGateOptions {
  /** Total content size in bytes */
  contentSizeBytes: number;
  /** Pubkey of the content author — if matches current user, gate is bypassed */
  authorPubkey?: string;
  /** Chunk hashes to check local availability */
  chunkHashes?: string[];
}

/**
 * Checks whether the user has sufficient credits to download content
 * of the given size. Returns gating state used by CreditGate component
 * to block P2P transfers until credits are sufficient.
 *
 * The gate is bypassed when:
 * 1. The content author is the current user (own content is always free)
 * 2. All chunks are already cached locally (no P2P transfer needed)
 */
export function useCreditGate(options: CreditGateOptions): CreditGateState;
export function useCreditGate(contentSizeBytes: number): CreditGateState;
export function useCreditGate(arg: number | CreditGateOptions): CreditGateState {
  const opts: CreditGateOptions = typeof arg === "number"
    ? { contentSizeBytes: arg }
    : arg;

  const { contentSizeBytes, authorPubkey, chunkHashes } = opts;

  const { summary, isLoading, error, refresh } = useCredits();
  const myPubkey = useEntropyStore((s) => s.pubkey);

  // --- Owner check ---
  const isOwner = !!(authorPubkey && myPubkey && authorPubkey === myPubkey);

  // --- Local availability check ---
  const [localBytes, setLocalBytes] = useState<number | null>(null);
  const [localCheckDone, setLocalCheckDone] = useState(false);

  // Stable string key so the effect doesn't re-fire on every render
  // (chunkHashes is a new array reference each render)
  const hashesKey = chunkHashes && chunkHashes.length > 0 ? chunkHashes.join(",") : "";

  useEffect(() => {
    if (!hashesKey) {
      setLocalBytes(null);
      setLocalCheckDone(true);
      return;
    }

    const hashes = hashesKey.split(",");

    setLocalCheckDone(false);
    let cancelled = false;

    checkLocalChunks(hashes, 10_000)
      .then((result) => {
        if (cancelled) return;
        setLocalBytes(result.local === result.total ? result.localBytes : null);
        setLocalCheckDone(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Conservative: if the local-check fails (timeout / SW busy), fall back
        // to the normal credit balance check instead of bypassing the gate.
        console.warn("[useCreditGate] checkLocalChunks failed/timed out — falling back to credit check");
        setLocalBytes(null);
        setLocalCheckDone(true);
      });

    return () => { cancelled = true; };
  }, [hashesKey]);

  const allLocal = localCheckDone && localBytes !== null;

  return useMemo(() => {
    // Bypass: own content is always free
    if (isOwner) {
      return {
        allowed: true,
        balance: summary?.balance ?? 0,
        required: contentSizeBytes,
        deficit: 0,
        isLoading: false,
        error: null,
        refresh,
        bypassReason: "owner" as const,
      };
    }

    // Bypass: all chunks are already cached locally — no P2P transfer needed
    if (allLocal) {
      return {
        allowed: true,
        balance: summary?.balance ?? 0,
        required: contentSizeBytes,
        deficit: 0,
        isLoading: false,
        error: null,
        refresh,
        bypassReason: "local" as const,
      };
    }

    // Still loading credits or local check
    if (isLoading || !summary || (hashesKey && !localCheckDone)) {
      return {
        allowed: false,
        balance: 0,
        required: contentSizeBytes,
        deficit: contentSizeBytes,
        isLoading: true,
        error,
        refresh,
        bypassReason: null,
      };
    }

    // Normal gating: check balance vs content size
    const balance = summary.balance;
    const deficit = Math.max(0, contentSizeBytes - balance);
    const allowed = balance >= contentSizeBytes;

    return {
      allowed,
      balance,
      required: contentSizeBytes,
      deficit,
      isLoading: false,
      error,
      refresh,
      bypassReason: null,
    };
  }, [summary, isLoading, error, contentSizeBytes, refresh, isOwner, allLocal, localCheckDone, hashesKey]);
}
