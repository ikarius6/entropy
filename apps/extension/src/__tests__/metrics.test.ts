import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMockStorage } from "./__mocks__/webextension-polyfill";

describe("metrics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    __resetMockStorage();
  });

  it("starts with zero counters", async () => {
    const { createMetricsCollector } = await import("../background/metrics");

    const collector = createMetricsCollector({ startedAt: 1000, nowMs: () => 2000 });
    const metrics = await collector.getMetrics();

    expect(metrics.chunksServed).toBe(0);
    expect(metrics.bytesServed).toBe(0);
    expect(metrics.chunksDownloaded).toBe(0);
    expect(metrics.bytesDownloaded).toBe(0);
    expect(metrics.peersConnected).toBe(0);
    expect(metrics.coldStorageAssignments).toBe(0);
    expect(metrics.healthStatus).toBe("unknown");
    expect(metrics.lastHealthCheck).toBeNull();
    expect(metrics.uptimeMs).toBe(1000);
  });

  it("accumulates recordChunkServed calls", async () => {
    const { createMetricsCollector } = await import("../background/metrics");

    const collector = createMetricsCollector({ startedAt: 0, nowMs: () => 0 });

    await collector.recordChunkServed(512);
    await collector.recordChunkServed(1024);

    const metrics = await collector.getMetrics();
    expect(metrics.chunksServed).toBe(2);
    expect(metrics.bytesServed).toBe(1536);
  });

  it("accumulates recordChunkDownloaded calls", async () => {
    const { createMetricsCollector } = await import("../background/metrics");

    const collector = createMetricsCollector({ startedAt: 0, nowMs: () => 0 });

    await collector.recordChunkDownloaded(256);
    await collector.recordChunkDownloaded(256);
    await collector.recordChunkDownloaded(256);

    const metrics = await collector.getMetrics();
    expect(metrics.chunksDownloaded).toBe(3);
    expect(metrics.bytesDownloaded).toBe(768);
  });

  it("setPeersConnected updates the counter", async () => {
    const { createMetricsCollector } = await import("../background/metrics");

    const collector = createMetricsCollector({ startedAt: 0, nowMs: () => 0 });

    await collector.setPeersConnected(5);
    const metrics = await collector.getMetrics();
    expect(metrics.peersConnected).toBe(5);
  });

  it("setColdStorageAssignments updates the counter", async () => {
    const { createMetricsCollector } = await import("../background/metrics");

    const collector = createMetricsCollector({ startedAt: 0, nowMs: () => 0 });

    await collector.setColdStorageAssignments(3);
    const metrics = await collector.getMetrics();
    expect(metrics.coldStorageAssignments).toBe(3);
  });

  it("runHealthCheck marks healthy when chunks served > 0", async () => {
    const { createMetricsCollector } = await import("../background/metrics");

    const collector = createMetricsCollector({ startedAt: 0, nowMs: () => 5000 });

    await collector.recordChunkServed(100);
    await collector.runHealthCheck();

    const metrics = await collector.getMetrics();
    expect(metrics.healthStatus).toBe("healthy");
    expect(metrics.lastHealthCheck).toBe(5000);
    expect(metrics.uptimeMs).toBe(5000);
  });

  it("runHealthCheck marks degraded when no chunks served and no peers", async () => {
    const { createMetricsCollector } = await import("../background/metrics");

    const collector = createMetricsCollector({ startedAt: 0, nowMs: () => 3000 });

    await collector.runHealthCheck();

    const metrics = await collector.getMetrics();
    expect(metrics.healthStatus).toBe("degraded");
  });

  it("reset clears all counters", async () => {
    const { createMetricsCollector } = await import("../background/metrics");

    const collector = createMetricsCollector({ startedAt: 0, nowMs: () => 0 });

    await collector.recordChunkServed(100);
    await collector.setPeersConnected(4);
    await collector.reset();

    const metrics = await collector.getMetrics();
    expect(metrics.chunksServed).toBe(0);
    expect(metrics.bytesServed).toBe(0);
    expect(metrics.peersConnected).toBe(0);
    expect(metrics.healthStatus).toBe("unknown");
  });
});
