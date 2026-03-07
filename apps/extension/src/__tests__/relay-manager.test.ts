import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMockStorage } from "./__mocks__/webextension-polyfill";

const relayPoolInstances: Array<{
  statuses: Array<{ url: string; status: string }>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  getRelayStatuses: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("../background/tor-proxy", () => ({
  isTorActive: vi.fn(() => false),
  applyTorProxy: vi.fn()
}));

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
    __resetMockStorage();
    relayPoolInstances.length = 0;
  });

  it("initializes with default relays when storage is empty", async () => {
    const relayManager = await import("../background/relay-manager");

    await relayManager.initRelayManager();

    expect(await relayManager.getRelayUrls()).toEqual(relayManager.DEFAULT_RELAY_URLS);
    expect(relayManager.getRelayStatuses()).toHaveLength(relayManager.DEFAULT_RELAY_URLS.length);
  });

  it("adds and removes relay URLs with normalization", async () => {
    const relayManager = await import("../background/relay-manager");

    await relayManager.initRelayManager(["wss://relay-a.example.com", "wss://relay-b.example.com"]);
    await relayManager.addRelay("wss://relay-c.example.com///");

    expect(await relayManager.getRelayUrls()).toEqual([
      "wss://relay-a.example.com",
      "wss://relay-b.example.com",
      "wss://relay-c.example.com"
    ]);

    await relayManager.removeRelay("wss://relay-a.example.com/");

    expect(await relayManager.getRelayUrls()).toEqual([
      "wss://relay-b.example.com",
      "wss://relay-c.example.com"
    ]);
  });

  it("falls back to default relays when removing the last relay", async () => {
    const relayManager = await import("../background/relay-manager");

    await relayManager.initRelayManager(["wss://single-relay.example.com"]);
    await relayManager.removeRelay("wss://single-relay.example.com");

    expect(await relayManager.getRelayUrls()).toEqual(relayManager.DEFAULT_RELAY_URLS);
  });

  it("reinitializes relay connections when an unhealthy status is detected", async () => {
    const relayManager = await import("../background/relay-manager");

    await relayManager.initRelayManager(["wss://relay-a.example.com"]);

    const before = relayPoolInstances.length;
    const activePool = relayManager.getRelayPool() as unknown as { statuses: Array<{ url: string; status: string }> };

    activePool.statuses = [{ url: "wss://relay-a.example.com", status: "error" }];

    await relayManager.ensureRelayConnections();

    expect(relayPoolInstances.length).toBeGreaterThan(before);
  });

  // -------------------------------------------------------------------------
  // Security validation tests
  // -------------------------------------------------------------------------

  it("rejects non-ws:// schemes", async () => {
    const { addRelay } = await import("../background/relay-manager");
    await expect(addRelay("https://evil.com")).rejects.toThrow("ws:// or wss://");
    await expect(addRelay("javascript:alert(1)")).rejects.toThrow();
  });

  it("rejects loopback address (127.x.x.x)", async () => {
    const { addRelay, initRelayManager } = await import("../background/relay-manager");
    await initRelayManager([]);
    await expect(addRelay("wss://127.0.0.1")).rejects.toThrow("not allowed");
  });

  it("rejects localhost hostname", async () => {
    const { addRelay, initRelayManager } = await import("../background/relay-manager");
    await initRelayManager([]);
    await expect(addRelay("wss://localhost")).rejects.toThrow("not allowed");
  });

  it("rejects private-network IP (192.168.x.x)", async () => {
    const { addRelay, initRelayManager } = await import("../background/relay-manager");
    await initRelayManager([]);
    await expect(addRelay("wss://192.168.1.100")).rejects.toThrow("not allowed");
  });

  it("rejects private-network IP (10.x.x.x)", async () => {
    const { addRelay, initRelayManager } = await import("../background/relay-manager");
    await initRelayManager([]);
    await expect(addRelay("wss://10.0.0.1")).rejects.toThrow("not allowed");
  });

  it("rejects URLs that exceed the maximum length", async () => {
    const { addRelay, initRelayManager } = await import("../background/relay-manager");
    await initRelayManager([]);
    const longUrl = "wss://a.example.com/" + "x".repeat(500);
    await expect(addRelay(longUrl)).rejects.toThrow("maximum length");
  });

  it("rejects URLs containing control characters", async () => {
    const { addRelay, initRelayManager } = await import("../background/relay-manager");
    await initRelayManager([]);
    await expect(addRelay("wss://evil.com\nwss://second.com")).rejects.toThrow("control characters");
  });

  it("enforces MAX_RELAY_COUNT and rejects relays beyond the limit", async () => {
    const { addRelay, initRelayManager, MAX_RELAY_COUNT } = await import("../background/relay-manager");

    const initial = Array.from({ length: MAX_RELAY_COUNT }, (_, i) => `wss://relay-${i}.example.com`);
    await initRelayManager(initial);

    await expect(addRelay("wss://one-too-many.example.com")).rejects.toThrow("maximum");
  });

  it("is idempotent — adding an existing relay is a no-op", async () => {
    const { addRelay, initRelayManager, getRelayUrls } = await import("../background/relay-manager");

    await initRelayManager(["wss://relay.example.com"]);
    await addRelay("wss://relay.example.com");

    expect(await getRelayUrls()).toEqual(["wss://relay.example.com"]);
  });

  // -------------------------------------------------------------------------
  // .onion URL tests
  // -------------------------------------------------------------------------

  it("rejects .onion relay URLs when Tor is not active", async () => {
    const { addRelay, initRelayManager } = await import("../background/relay-manager");
    await initRelayManager([]);
    await expect(addRelay("wss://abc123xyz.onion")).rejects.toThrow("enabling Tor");
  });

  it("isOnionUrl correctly identifies .onion URLs", async () => {
    const { isOnionUrl } = await import("../background/relay-manager");

    expect(isOnionUrl("wss://abcdef1234567890.onion")).toBe(true);
    expect(isOnionUrl("wss://relay.damus.io")).toBe(false);
    expect(isOnionUrl("wss://sub.domain.onion")).toBe(true);
    expect(isOnionUrl("not-a-url")).toBe(false);
    expect(isOnionUrl("wss://onion.example.com")).toBe(false);
  });
});
