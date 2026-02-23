import { useCallback, useEffect, useState } from "react";

import {
  getColdStorageAssignments,
  releaseColdAssignment,
  type ColdStorageStatusPayload,
  type ReleaseColdAssignmentPayload
} from "../lib/extension-bridge";

export interface ColdStorageState {
  status: ColdStorageStatusPayload | null;
  isLoading: boolean;
  isReleasing: string | null;
  error: string | null;
  refresh: () => Promise<void>;
  release: (payload: ReleaseColdAssignmentPayload) => Promise<void>;
}

export function useColdStorage(): ColdStorageState {
  const [status, setStatus] = useState<ColdStorageStatusPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReleasing, setIsReleasing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);

    try {
      const next = await getColdStorageAssignments();
      setStatus(next);
      setError(null);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Failed to read cold storage assignments.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const release = useCallback(async (payload: ReleaseColdAssignmentPayload) => {
    setIsReleasing(payload.chunkHash);

    try {
      const updated = await releaseColdAssignment(payload);
      setStatus(updated);
      setError(null);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Failed to release cold storage assignment.";
      setError(message);
    } finally {
      setIsReleasing(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    status,
    isLoading,
    isReleasing,
    error,
    refresh,
    release
  };
}
