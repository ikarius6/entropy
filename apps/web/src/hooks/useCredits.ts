import { useCallback, useEffect, useState } from "react";

import {
  getCreditSummary,
  subscribeToCreditUpdates,
  type CreditSummaryPayload
} from "../lib/extension-bridge";

export interface CreditsState {
  summary: CreditSummaryPayload | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useCredits(): CreditsState {
  const [summary, setSummary] = useState<CreditSummaryPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);

    try {
      const nextSummary = await getCreditSummary();
      setSummary(nextSummary);
      setError(null);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Failed to read extension credit summary.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const unsubscribe = subscribeToCreditUpdates((nextSummary) => {
      setSummary(nextSummary);
      setError(null);
    });

    return unsubscribe;
  }, []);

  return {
    summary,
    isLoading,
    error,
    refresh
  };
}
