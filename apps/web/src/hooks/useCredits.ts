import { useCallback, useEffect, useRef, useState } from "react";

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

  // Initial fetch on mount.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Periodic refresh every 30 s to catch credits earned while the push was missed
  // (e.g. service-worker restart, cross-tab activity, extension reload).
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => { void refreshRef.current(); }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Re-fetch immediately when the tab becomes visible again.
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        void refreshRef.current();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Real-time push from the extension (covers the common seeding case).
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
