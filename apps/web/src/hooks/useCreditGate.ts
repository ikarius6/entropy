import { useMemo } from "react";
import { useCredits } from "./useCredits";

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
}

/**
 * Checks whether the user has sufficient credits to download content
 * of the given size. Returns gating state used by CreditGate component
 * to block P2P transfers until credits are sufficient.
 */
export function useCreditGate(contentSizeBytes: number): CreditGateState {
  const { summary, isLoading, error, refresh } = useCredits();

  return useMemo(() => {
    if (isLoading || !summary) {
      return {
        allowed: false,
        balance: 0,
        required: contentSizeBytes,
        deficit: contentSizeBytes,
        isLoading: true,
        error,
        refresh,
      };
    }

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
    };
  }, [summary, isLoading, error, contentSizeBytes, refresh]);
}
