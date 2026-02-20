import { useState, useEffect } from "react";
import { type QuotaManager, createIndexedDbQuotaManager, createIndexedDbChunkStore } from "@entropy/core";

export function useQuotaManager() {
  const [usedBytes, setUsedBytes] = useState(0);
  const [quotaBytes, setQuotaBytes] = useState(2 * 1024 * 1024 * 1024); // Default 2GB
  const [isOverQuota, setIsOverQuota] = useState(false);
  const [quotaManager, setQuotaManager] = useState<QuotaManager | null>(null);

  useEffect(() => {
    let isMounted = true;
    
    // Initialize QuotaManager
    const init = async () => {
      try {
        const store = createIndexedDbChunkStore({ dbName: "entropy-web-store" });
        const qm = createIndexedDbQuotaManager(store, { limitBytes: quotaBytes });
        if (isMounted) {
          setQuotaManager(qm);
          await refreshUsage(qm);
        }
      } catch (err) {
        console.error("Failed to initialize quota manager:", err);
      }
    };
    
    init();
    
    return () => {
      isMounted = false;
    };
  }, [quotaBytes]);

  const refreshUsage = async (qm = quotaManager) => {
    if (!qm) return;
    try {
      // In a real implementation we would get this from the quota manager
      // For now we'll mock it based on navigator.storage if available
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        setUsedBytes(estimate.usage || 0);
        setIsOverQuota((estimate.usage || 0) > quotaBytes);
      }
    } catch (err) {
      console.error("Failed to estimate storage:", err);
    }
  };

  const setQuota = async (bytes: number) => {
    setQuotaBytes(bytes);
    try {
      const store = createIndexedDbChunkStore({ dbName: "entropy-web-store" });
      const qm = createIndexedDbQuotaManager(store, { limitBytes: bytes });
      setQuotaManager(qm);
      await refreshUsage(qm);
    } catch (err) {
      console.error("Failed to update quota manager:", err);
    }
  };

  const evictLRU = async (): Promise<number> => {
    if (!quotaManager) return 0;
    try {
      // Mock evicting for now since the real method might need actual DB access
      // Let's evict 100MB as a test
      const freed = await quotaManager.evictLRU(100 * 1024 * 1024);
      await refreshUsage();
      return freed;
    } catch (err) {
      console.error("Failed to evict LRU:", err);
      return 0;
    }
  };

  const usagePercent = quotaBytes > 0 ? (usedBytes / quotaBytes) * 100 : 0;

  return {
    usedBytes,
    quotaBytes,
    usagePercent,
    isOverQuota,
    evictLRU,
    setQuota,
    refreshUsage
  };
}
