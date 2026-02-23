import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pruneDelegationsMock = vi.fn(async () => 0);

vi.mock("../background/seeder", () => ({
  pruneDelegations: pruneDelegationsMock
}));

describe("scheduler", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("runs delegation prune task on the configured interval", async () => {
    const {
      scheduleMaintenance,
      PRUNE_INTERVAL_MS,
      MAX_DELEGATION_AGE_MS
    } = await import("../background/scheduler");

    scheduleMaintenance();

    await vi.advanceTimersByTimeAsync(PRUNE_INTERVAL_MS + 1);

    expect(pruneDelegationsMock).toHaveBeenCalledTimes(1);
    expect(pruneDelegationsMock).toHaveBeenCalledWith(MAX_DELEGATION_AGE_MS);
  });

  it("runs cold storage cycle and prune tasks when manager is provided", async () => {
    const {
      scheduleMaintenance,
      COLD_STORAGE_CYCLE_MS,
      COLD_PRUNE_INTERVAL_MS,
      PRUNE_INTERVAL_MS
    } = await import("../background/scheduler");

    const coldStorageManager = {
      runCycle: vi.fn(async () => {}),
      pruneExpired: vi.fn(async () => {}),
      verifyIntegrity: vi.fn(async () => ({ verified: 0, lost: 0 }))
    };

    scheduleMaintenance(coldStorageManager);

    await vi.advanceTimersByTimeAsync(COLD_STORAGE_CYCLE_MS + 1);
    expect(coldStorageManager.runCycle).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(
      COLD_PRUNE_INTERVAL_MS - COLD_STORAGE_CYCLE_MS + 1
    );

    expect(pruneDelegationsMock).toHaveBeenCalled();
    expect(coldStorageManager.pruneExpired).toHaveBeenCalled();
  });
});
