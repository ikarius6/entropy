import { describe, expect, it, vi, beforeEach } from "vitest";

import { Relay, RelayPool, type NostrEvent, type NostrFilter } from "../nostr/client";

// Stub signature verification — these tests exercise relay plumbing, not crypto.
vi.mock("../nostr/identity", () => ({
  verifyEventSignature: () => true
}));

// ---------------------------------------------------------------------------
// Helpers — minimal mock for WebSocket
// ---------------------------------------------------------------------------

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly OPEN = 1;

  readyState = 0; // CONNECTING
  url: string;
  sentMessages: string[] = [];
  private handlers = new Map<string, Function[]>();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);

    // Simulate async open
    queueMicrotask(() => {
      this.readyState = 1; // OPEN
      this.dispatch("open", {});
    });
  }

  addEventListener(type: string, handler: Function): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = 3; // CLOSED
    this.dispatch("close", {});
  }

  // Test helpers
  dispatch(type: string, event: unknown): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler(event);
    }
  }

  simulateMessage(data: string): void {
    this.dispatch("message", { data });
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** Flush both microtask and macrotask queues so mock WebSockets finish opening. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
});

// ---------------------------------------------------------------------------
// Tests — Relay
// ---------------------------------------------------------------------------

describe("Relay", () => {
  it("connects and transitions to connected status", async () => {
    const relay = new Relay("wss://relay.example.com");
    expect(relay.getStatus()).toBe("disconnected");

    relay.connect();
    expect(relay.getStatus()).toBe("connecting");

    // Wait for the microtask that opens the mock socket
    await new Promise((resolve) => queueMicrotask(resolve));

    expect(relay.getStatus()).toBe("connected");
    relay.disconnect();
    expect(relay.getStatus()).toBe("disconnected");
  });

  it("queues messages sent before the socket is open", async () => {
    const relay = new Relay("wss://relay.example.com");
    relay.connect();

    const fakeEvent = makeFakeEvent();
    relay.publish(fakeEvent);

    // Socket is still connecting — message should be queued
    const ws = MockWebSocket.instances[0];
    expect(ws.sentMessages).toHaveLength(0);

    // Open the socket
    await new Promise((resolve) => queueMicrotask(resolve));
    expect(ws.sentMessages).toHaveLength(1);

    const parsed = JSON.parse(ws.sentMessages[0]);
    expect(parsed[0]).toBe("EVENT");
    expect(parsed[1].id).toBe(fakeEvent.id);
  });

  it("subscribes and receives events from the relay", async () => {
    const relay = new Relay("wss://relay.example.com");
    relay.connect();
    await new Promise((resolve) => queueMicrotask(resolve));

    const received: NostrEvent[] = [];
    const filters: NostrFilter[] = [{ kinds: [7001] }];
    relay.subscribe("sub-1", filters, (event) => received.push(event));

    // Simulate relay sending an EVENT message
    const ws = MockWebSocket.instances[0];
    const fakeEvent = makeFakeEvent();
    ws.simulateMessage(JSON.stringify(["EVENT", "sub-1", fakeEvent]));

    expect(received).toHaveLength(1);
    expect(received[0].id).toBe(fakeEvent.id);
  });

  it("calls the EOSE callback when the relay signals end of stored events", async () => {
    const relay = new Relay("wss://relay.example.com");
    relay.connect();
    await new Promise((resolve) => queueMicrotask(resolve));

    const eoseCalled = vi.fn();
    relay.subscribe("sub-1", [{ kinds: [7001] }], () => {}, eoseCalled);

    const ws = MockWebSocket.instances[0];
    ws.simulateMessage(JSON.stringify(["EOSE", "sub-1"]));

    expect(eoseCalled).toHaveBeenCalledOnce();
  });

  it("stops receiving events after closing a subscription", async () => {
    const relay = new Relay("wss://relay.example.com");
    relay.connect();
    await new Promise((resolve) => queueMicrotask(resolve));

    const received: NostrEvent[] = [];
    relay.subscribe("sub-1", [{ kinds: [7001] }], (event) => received.push(event));
    relay.closeSubscription("sub-1");

    const ws = MockWebSocket.instances[0];
    ws.simulateMessage(JSON.stringify(["EVENT", "sub-1", makeFakeEvent()]));

    // Should not receive the event after closing
    expect(received).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — RelayPool
// ---------------------------------------------------------------------------

describe("RelayPool", () => {
  it("connects to multiple relays", async () => {
    const pool = new RelayPool();
    pool.connect(["wss://relay1.example.com", "wss://relay2.example.com"]);
    await flush();

    const statuses = pool.getRelayStatuses();
    expect(statuses).toHaveLength(2);
    expect(statuses.every((s) => s.status === "connected")).toBe(true);

    pool.disconnect();
  });

  it("publishes events to all relays", async () => {
    const pool = new RelayPool();
    pool.connect(["wss://relay1.example.com", "wss://relay2.example.com"]);
    await flush();

    pool.publish(makeFakeEvent());

    // Both sockets should have received the EVENT message
    expect(MockWebSocket.instances[0].sentMessages.length).toBeGreaterThan(0);
    expect(MockWebSocket.instances[1].sentMessages.length).toBeGreaterThan(0);

    pool.disconnect();
  });

  it("subscribes across all relays and returns an unsubscribe handle", async () => {
    const pool = new RelayPool();
    pool.connect(["wss://relay1.example.com"]);
    await flush();

    const received: NostrEvent[] = [];
    const sub = pool.subscribe([{ kinds: [7001] }], (event) => received.push(event));

    const ws = MockWebSocket.instances[0];
    ws.simulateMessage(JSON.stringify(["EVENT", sub.id, makeFakeEvent()]));

    expect(received).toHaveLength(1);

    sub.unsubscribe();

    // After unsubscribe, CLOSE should have been sent
    const closeMsg = ws.sentMessages.find((m) => JSON.parse(m)[0] === "CLOSE");
    expect(closeMsg).toBeDefined();

    pool.disconnect();
  });

  it("does not duplicate relay connections", async () => {
    const pool = new RelayPool();
    pool.connect(["wss://relay1.example.com"]);
    pool.connect(["wss://relay1.example.com"]);

    expect(MockWebSocket.instances).toHaveLength(1);
    pool.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeEvent(): NostrEvent {
  return {
    id: "fake-id-" + Math.random().toString(36).slice(2),
    pubkey: "fake-pubkey",
    created_at: Math.floor(Date.now() / 1000),
    kind: 7001,
    content: "",
    tags: [["x-hash", "abc123"]],
    sig: "fake-sig"
  };
}
