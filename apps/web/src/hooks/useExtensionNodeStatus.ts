import { useCallback, useEffect, useState } from "react";

import {
  getNodeStatus,
  sendHeartbeat,
  subscribeToNodeStatusUpdates,
  type NodeStatusPayload
} from "../lib/extension-bridge";

export interface ExtensionNodeStatusState {
  status: NodeStatusPayload | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useExtensionNodeStatus(pollIntervalMs = 15000): ExtensionNodeStatusState {
  const [status, setStatus] = useState<NodeStatusPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);

    try {
      const nextStatus = await getNodeStatus();
      setStatus(nextStatus ?? null);
      setError(null);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Failed to read extension node status.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const unsubscribe = subscribeToNodeStatusUpdates((nextStatus) => {
      setStatus(nextStatus);
      setError(null);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const intervalHandle = window.setInterval(() => {
      void sendHeartbeat()
        .then((heartbeatStatus) => {
          if (heartbeatStatus) {
            setStatus(heartbeatStatus);
          }
        })
        .catch(() => {
          // Ignore heartbeat failures. Refresh path handles user-facing errors.
        });
    }, pollIntervalMs);

    return () => {
      window.clearInterval(intervalHandle);
    };
  }, [pollIntervalMs]);

  return {
    status,
    isLoading,
    error,
    refresh
  };
}
