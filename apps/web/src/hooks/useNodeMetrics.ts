import { useCallback, useEffect, useState } from "react";

import { getNodeMetrics, type NodeMetricsPayload } from "../lib/extension-bridge";

export interface NodeMetricsState {
  metrics: NodeMetricsPayload | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useNodeMetrics(): NodeMetricsState {
  const [metrics, setMetrics] = useState<NodeMetricsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);

    try {
      const next = await getNodeMetrics();
      setMetrics(next);
      setError(null);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Failed to read node metrics.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    const intervalId = setInterval(() => {
      void refresh();
    }, 30_000);

    return () => clearInterval(intervalId);
  }, [refresh]);

  return { metrics, isLoading, error, refresh };
}
