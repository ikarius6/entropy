import { useState, useEffect, useRef } from "react";
import { type QuotaManager, createIndexedDbQuotaManager, createIndexedDbChunkStore } from "@entropy/core";

export function useQuotaManager() {
  const [usedBytes, setUsedBytes] = useState(0);
  const [quotaBytes, setQuotaBytes] = useState(2 * 1024 * 1024 * 1024); // Default 2GB
  const [isOverQuota, setIsOverQuota] = useState(false);
  const qmRef = useRef<QuotaManager | null>(null);

  const refreshUsage = async (qm: QuotaManager | null = qmRef.current) => {
    if (!qm) return;
    try {
      const info = await qm.getQuotaInfo();
      setUsedBytes(info.used);
      setQuotaBytes(info.limit);
      setIsOverQuota(info.used > info.limit);
    } catch (err) {
      console.error("[useQuotaManager] failed to get quota info:", err);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        const store = createIndexedDbChunkStore({ dbName: "entropy-web-store" });
        const qm = createIndexedDbQuotaManager(store, { limitBytes: quotaBytes });
        if (isMounted) {
          qmRef.current = qm;
          await refreshUsage(qm);
        }
      } catch (err) {
        console.error("[useQuotaManager] failed to initialize:", err);
      }
    };

    init();

    return () => {
      isMounted = false;
    };
  }, [quotaBytes]);

  const setQuota = async (bytes: number) => {
    try {
      const store = createIndexedDbChunkStore({ dbName: "entropy-web-store" });
      const qm = createIndexedDbQuotaManager(store, { limitBytes: bytes });
      qmRef.current = qm;
      setQuotaBytes(bytes);
      await refreshUsage(qm);
    } catch (err) {
      console.error("[useQuotaManager] failed to update quota:", err);
    }
  };

  const evictLRU = async (): Promise<number> => {
    const qm = qmRef.current;
    if (!qm) return 0;
    try {
      const info = await qm.getQuotaInfo();
      // Evict enough to free 10% of the limit, or whatever is over quota
      const overQuota = Math.max(0, info.used - info.limit);
      const targetFree = Math.max(overQuota, info.limit * 0.1);
      const freed = await qm.evictLRU(targetFree);
      await refreshUsage(qm);
      return freed;
    } catch (err) {
      console.error("[useQuotaManager] failed to evict LRU:", err);
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
    refreshUsage,
  };
}
