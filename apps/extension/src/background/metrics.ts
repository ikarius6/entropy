import browser from "webextension-polyfill";
import { logger } from "@entropy/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NodeMetrics {
  chunksServed: number;
  bytesServed: number;
  chunksDownloaded: number;
  bytesDownloaded: number;
  peersConnected: number;
  coldStorageAssignments: number;
  uptimeMs: number;
  lastHealthCheck: number | null;
  healthStatus: "healthy" | "degraded" | "unknown";
}

const STORAGE_KEY = "nodeMetrics";
const ZERO_METRICS: NodeMetrics = {
  chunksServed: 0,
  bytesServed: 0,
  chunksDownloaded: 0,
  bytesDownloaded: 0,
  peersConnected: 0,
  coldStorageAssignments: 0,
  uptimeMs: 0,
  lastHealthCheck: null,
  healthStatus: "unknown"
};

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

interface MetricsSchema {
  nodeMetrics?: Partial<NodeMetrics>;
}

async function readMetrics(): Promise<NodeMetrics> {
  const stored = (await browser.storage.local.get(STORAGE_KEY)) as Partial<MetricsSchema>;
  const raw = stored[STORAGE_KEY];

  if (!raw || typeof raw !== "object") {
    return { ...ZERO_METRICS };
  }

  return {
    chunksServed: typeof raw.chunksServed === "number" ? raw.chunksServed : 0,
    bytesServed: typeof raw.bytesServed === "number" ? raw.bytesServed : 0,
    chunksDownloaded: typeof raw.chunksDownloaded === "number" ? raw.chunksDownloaded : 0,
    bytesDownloaded: typeof raw.bytesDownloaded === "number" ? raw.bytesDownloaded : 0,
    peersConnected: typeof raw.peersConnected === "number" ? raw.peersConnected : 0,
    coldStorageAssignments:
      typeof raw.coldStorageAssignments === "number" ? raw.coldStorageAssignments : 0,
    uptimeMs: typeof raw.uptimeMs === "number" ? raw.uptimeMs : 0,
    lastHealthCheck: typeof raw.lastHealthCheck === "number" ? raw.lastHealthCheck : null,
    healthStatus:
      raw.healthStatus === "healthy" || raw.healthStatus === "degraded"
        ? raw.healthStatus
        : "unknown"
  };
}

async function writeMetrics(metrics: NodeMetrics): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: metrics });
}

// ---------------------------------------------------------------------------
// MetricsCollector
// ---------------------------------------------------------------------------

export interface MetricsCollector {
  recordChunkServed(bytes: number): Promise<void>;
  recordChunkDownloaded(bytes: number): Promise<void>;
  setPeersConnected(count: number): Promise<void>;
  setColdStorageAssignments(count: number): Promise<void>;
  runHealthCheck(): Promise<void>;
  getMetrics(): Promise<NodeMetrics>;
  reset(): Promise<void>;
}

export interface CreateMetricsCollectorOptions {
  startedAt?: number;
  nowMs?: () => number;
}

export function createMetricsCollector(
  options: CreateMetricsCollectorOptions = {}
): MetricsCollector {
  const startedAt = options.startedAt ?? Date.now();
  const nowMs = options.nowMs ?? (() => Date.now());

  async function recordChunkServed(bytes: number): Promise<void> {
    const metrics = await readMetrics();
    metrics.chunksServed += 1;
    metrics.bytesServed += bytes;
    await writeMetrics(metrics);
  }

  async function recordChunkDownloaded(bytes: number): Promise<void> {
    const metrics = await readMetrics();
    metrics.chunksDownloaded += 1;
    metrics.bytesDownloaded += bytes;
    await writeMetrics(metrics);
  }

  async function setPeersConnected(count: number): Promise<void> {
    const metrics = await readMetrics();
    metrics.peersConnected = count;
    await writeMetrics(metrics);
  }

  async function setColdStorageAssignments(count: number): Promise<void> {
    const metrics = await readMetrics();
    metrics.coldStorageAssignments = count;
    await writeMetrics(metrics);
  }

  async function runHealthCheck(): Promise<void> {
    const metrics = await readMetrics();
    const now = nowMs();
    metrics.uptimeMs = now - startedAt;
    metrics.lastHealthCheck = now;

    // Simple heuristic: degraded if no chunks served and no peers connected
    if (metrics.chunksServed === 0 && metrics.peersConnected === 0) {
      metrics.healthStatus = "degraded";
    } else {
      metrics.healthStatus = "healthy";
    }

    await writeMetrics(metrics);
    logger.log(
      "[metrics] health check:",
      metrics.healthStatus,
      "| uptime:",
      Math.round(metrics.uptimeMs / 1000) + "s",
      "| chunks served:",
      metrics.chunksServed,
      "| peers:",
      metrics.peersConnected
    );
  }

  async function getMetrics(): Promise<NodeMetrics> {
    const metrics = await readMetrics();
    metrics.uptimeMs = nowMs() - startedAt;
    return metrics;
  }

  async function reset(): Promise<void> {
    await writeMetrics({ ...ZERO_METRICS });
  }

  return {
    recordChunkServed,
    recordChunkDownloaded,
    setPeersConnected,
    setColdStorageAssignments,
    runHealthCheck,
    getMetrics,
    reset
  };
}
