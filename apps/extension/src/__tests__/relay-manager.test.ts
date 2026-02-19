import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, unknown>();

const storageGet = vi.fn(async (key: string) => ({ [key]: storage.get(key) }));
const storageSet = vi.fn(async (value: Record<string, unknown>) => {
  for (const [entryKey, entryValue] of Object.entries(value)) {
    storage.set(entryKey, entryValue);
  }
});

const relayPoolInstances: Array<{
  statuses: Array<{ url: string; status: string }>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  getRelayStatuses: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("@entropy/core", () => {
  class MockRelayPool {
    statuses: Array<{ url: string; status: string }> = [];

    connect = vi.fn((urls: string[]) => {
      this.statuses = urls.map((url) => ({ url, status: "connected" }));
    });

    disconnect = vi.fn(() => {
      this.statuses = [];
    });

    getRelayStatuses = vi.fn(() => this.statuses);

    constructor() {
      relayPoolInstances.push(this);
    }
  }

  return {
    RelayPool: MockRelayPool
  };
});

describe("relay-manager", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    storage.clear();
    relayPoolInstances.length = 0;

    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: storageGet,
          set: storageSet
        }
      }
    });
  });

  it("initializes with default relays when storage is empty", async () => {
    const relayManager = await import("../background/relay-manager");

    await relayManager.initRelayManager();

    expect(await relayManager.getRelayUrls()).toEqual(relayManager.DEFAULT_RELAY_URLS);
    expect(relayManager.getRelayStatuses()).toHaveLength(relayManager.DEFAULT_RELAY_URLS.length);
  });

  it("adds and removes relay URLs with normalization", async () => {
    const relayManager = await import("../background/relay-manager");

    await relayManager.initRelayManager(["wss://relay-a", "wss://relay-b"]);
    await relayManager.addRelay("wss://relay-c///");

    expect(await relayManager.getRelayUrls()).toEqual(["wss://relay-a", "wss://relay-b", "wss://relay-c"]);

    await relayManager.removeRelay("wss://relay-a/");

    expect(await relayManager.getRelayUrls()).toEqual(["wss://relay-b", "wss://relay-c"]);
  });

  it("falls back to default relays when removing the last relay", async () => {
    const relayManager = await import("../background/relay-manager");

    await relayManager.initRelayManager(["wss://single-relay"]);
    await relayManager.removeRelay("wss://single-relay");

    expect(await relayManager.getRelayUrls()).toEqual(relayManager.DEFAULT_RELAY_URLS);
  });

  it("reinitializes relay connections when an unhealthy status is detected", async () => {
    const relayManager = await import("../background/relay-manager");

    await relayManager.initRelayManager(["wss://relay-a"]);

    const before = relayPoolInstances.length;
    const activePool = relayManager.getRelayPool() as unknown as { statuses: Array<{ url: string; status: string }> };

    activePool.statuses = [{ url: "wss://relay-a", status: "error" }];

    await relayManager.ensureRelayConnections();

    expect(relayPoolInstances.length).toBeGreaterThan(before);
  });
});
