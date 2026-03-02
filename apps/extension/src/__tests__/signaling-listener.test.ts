import { beforeEach, describe, expect, it, vi } from "vitest";

const signalingInstances: Array<{
  __callback?: (signal: unknown) => void;
  sendAnswer: ReturnType<typeof vi.fn>;
  sendIceCandidate: ReturnType<typeof vi.fn>;
  __unsubscribe: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("@entropy/core", () => {
  class MockSignalingChannel {
    __callback?: (signal: unknown) => void;
    sendAnswer = vi.fn();
    sendIceCandidate = vi.fn();
    __unsubscribe = vi.fn();

    constructor(_pool: unknown) {
      signalingInstances.push(this);
    }

    onSignal(_myPubkey: string, callback: (signal: unknown) => void): () => void {
      this.__callback = callback;
      return this.__unsubscribe;
    }
  }

  return {
    SignalingChannel: MockSignalingChannel,
    createRtcConfiguration: vi.fn(() => ({ iceServers: [] })),
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
  };
});

class MockPeerConnection {
  static instances: MockPeerConnection[] = [];

  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;

  readonly setRemoteDescription = vi.fn(async () => {});
  readonly createAnswer = vi.fn(async () => ({ type: "answer", sdp: "mock-answer" }));
  readonly setLocalDescription = vi.fn(async () => {});
  readonly addIceCandidate = vi.fn(async () => {});
  readonly close = vi.fn(() => {});

  constructor(_configuration: RTCConfiguration) {
    MockPeerConnection.instances.push(this);
  }
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("signaling-listener", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    signalingInstances.length = 0;
    MockPeerConnection.instances = [];

    vi.stubGlobal("RTCPeerConnection", MockPeerConnection as unknown as typeof RTCPeerConnection);
  });

  it("handles offers and wires data channels to the peer callback", async () => {
    const { startSignalingListener } = await import("../background/signaling-listener");

    const onPeerConnected = vi.fn();

    startSignalingListener({} as never, "my-pubkey", onPeerConnected);

    const signaling = signalingInstances[0];

    signaling.__callback?.({
      type: "offer",
      senderPubkey: "peer-a",
      rootHash: "root-a",
      payload: { type: "offer", sdp: "mock-offer" },
      createdAt: 1
    });

    await flushAsync();

    expect(MockPeerConnection.instances).toHaveLength(1);

    const peer = MockPeerConnection.instances[0];

    expect(peer.setRemoteDescription).toHaveBeenCalled();
    expect(signaling.sendAnswer).toHaveBeenCalledOnce();

    const channel = { label: "chunks" } as RTCDataChannel;
    peer.ondatachannel?.({ channel } as RTCDataChannelEvent);

    expect(onPeerConnected).toHaveBeenCalledWith("peer-a", channel);
  });

  it("ignores offers when canServeRoot returns false", async () => {
    const { startSignalingListener } = await import("../background/signaling-listener");

    startSignalingListener({} as never, "my-pubkey", vi.fn(), {
      canServeRoot: () => false
    });

    const signaling = signalingInstances[0];

    signaling.__callback?.({
      type: "offer",
      senderPubkey: "peer-a",
      rootHash: "root-a",
      payload: { type: "offer", sdp: "mock-offer" },
      createdAt: 1
    });

    await flushAsync();

    expect(MockPeerConnection.instances).toHaveLength(0);
  });

  it("reuses existing RTCPeerConnection for ICE restart offers", async () => {
    const { startSignalingListener } = await import("../background/signaling-listener");

    const onPeerConnected = vi.fn();

    startSignalingListener({} as never, "my-pubkey", onPeerConnected);

    const signaling = signalingInstances[0];

    // First: send a normal offer to establish a connection
    signaling.__callback?.({
      type: "offer",
      senderPubkey: "peer-a",
      rootHash: "root-a",
      payload: { type: "offer", sdp: "mock-offer" },
      createdAt: 1
    });

    await flushAsync();

    expect(MockPeerConnection.instances).toHaveLength(1);
    const firstPeer = MockPeerConnection.instances[0];

    // Simulate ICE disconnected state on the existing connection
    Object.defineProperty(firstPeer, "iceConnectionState", { value: "disconnected", writable: true });
    Object.defineProperty(firstPeer, "signalingState", { value: "stable", writable: true });

    // Send another offer (ICE restart) — should NOT create a new RTCPeerConnection
    // Need to wait for dedup window (5s) — but in test we advance time
    // Actually, the dedup is based on Date.now() diff — we mock it
    const originalNow = Date.now;
    Date.now = () => originalNow() + 10_000; // Jump past dedup window

    signaling.__callback?.({
      type: "offer",
      senderPubkey: "peer-a",
      rootHash: "root-a",
      payload: { type: "offer", sdp: "mock-ice-restart-offer" },
      createdAt: 2
    });

    await flushAsync();

    // Should still be 1 instance — the existing connection was reused
    expect(MockPeerConnection.instances).toHaveLength(1);
    // setRemoteDescription should have been called again on the same peer
    expect(firstPeer.setRemoteDescription).toHaveBeenCalledTimes(2);
    expect(firstPeer.createAnswer).toHaveBeenCalledTimes(2);
    expect(signaling.sendAnswer).toHaveBeenCalledTimes(2);
    // The existing peer should NOT have been closed
    expect(firstPeer.close).not.toHaveBeenCalled();

    Date.now = originalNow;
  });

  it("applies incoming ice candidates to existing peer connections", async () => {
    const { startSignalingListener } = await import("../background/signaling-listener");

    startSignalingListener({} as never, "my-pubkey", vi.fn());

    const signaling = signalingInstances[0];

    signaling.__callback?.({
      type: "offer",
      senderPubkey: "peer-a",
      rootHash: "root-a",
      payload: { type: "offer", sdp: "mock-offer" },
      createdAt: 1
    });

    await flushAsync();

    const peer = MockPeerConnection.instances[0];

    signaling.__callback?.({
      type: "ice-candidate",
      senderPubkey: "peer-a",
      rootHash: "root-a",
      payload: { candidate: "candidate-data", sdpMLineIndex: 0, sdpMid: null },
      createdAt: 2
    });

    await flushAsync();

    expect(peer.addIceCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ candidate: "candidate-data" })
    );
  });
});
