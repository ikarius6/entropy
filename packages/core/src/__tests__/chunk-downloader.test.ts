import { describe, expect, it, vi } from "vitest";
import { ChunkDownloader } from "../transport/chunk-downloader";
import type { EntropyChunkMap, PeerManager, SignalingChannel, RelayPool } from "../index";
import { sha256Hex } from "../crypto/hash";

describe("chunk-downloader", () => {
  const mockChunkMap: EntropyChunkMap = {
    rootHash: "mock-root-hash",
    chunks: ["hash1", "hash2", "hash3"],
    size: 15 * 1024 * 1024,
    chunkSize: 5 * 1024 * 1024,
    gatekeepers: ["peer1", "peer2"]
  };

  const mockPeerManager = {
    addPeer: vi.fn(),
    removePeer: vi.fn(),
    getPeer: vi.fn(),
    listPeers: vi.fn(),
    size: 0,
    on: vi.fn(),
    off: vi.fn(),
    disconnectAll: vi.fn()
  } as unknown as PeerManager;

  const mockSignalingChannel = {
    sendOffer: vi.fn(),
    sendAnswer: vi.fn(),
    sendIceCandidate: vi.fn(),
    onSignal: vi.fn(() => vi.fn()),
  } as unknown as SignalingChannel;

  const mockRelayPool = {} as unknown as RelayPool;

  type DownloaderInternals = {
    inFlightChunks: Map<number, { peerId: string; timestamp: number }>;
    handleReceivedChunk: (peerId: string, index: number, data: ArrayBuffer) => void;
  };

  it("should initialize with correct pending chunks", () => {
    const downloader = new ChunkDownloader({
      chunkMap: mockChunkMap,
      peerManager: mockPeerManager,
      signalingChannel: mockSignalingChannel,
      myPubkey: "my-pubkey",
      relayPool: mockRelayPool
    });

    expect(downloader.downloadedCount).toBe(0);
    expect(downloader.hasChunk(0)).toBe(false);
  });

  it("should complete immediately if chunk map is empty", async () => {
    const onComplete = vi.fn();
    
    const downloader = new ChunkDownloader({
      chunkMap: { ...mockChunkMap, chunks: [] },
      peerManager: mockPeerManager,
      signalingChannel: mockSignalingChannel,
      myPubkey: "my-pubkey",
      relayPool: mockRelayPool,
      onComplete
    });

    await downloader.start();
    expect(onComplete).toHaveBeenCalled();
  });

  it("skips banned peers and reports an error when no eligible peers remain", async () => {
    const onError = vi.fn();

    const downloader = new ChunkDownloader({
      chunkMap: {
        ...mockChunkMap,
        chunks: ["a".repeat(64)],
        gatekeepers: ["peer1"]
      },
      peerManager: mockPeerManager,
      signalingChannel: mockSignalingChannel,
      myPubkey: "my-pubkey",
      relayPool: mockRelayPool,
      isPeerBanned: async () => true,
      onError
    });

    await downloader.start();

    expect(onError).toHaveBeenCalledTimes(1);
    const [err] = onError.mock.calls[0] as [Error];
    expect(err.message).toContain("No eligible gatekeeper peers available");
  });

  it("uses dynamic seeder discovery when static gatekeepers are empty", async () => {
    const onError = vi.fn();
    const discoverPeers = vi.fn(async () => ["dynamic-peer"]);

    const downloader = new ChunkDownloader({
      chunkMap: {
        ...mockChunkMap,
        chunks: ["a".repeat(64)],
        gatekeepers: []
      },
      peerManager: mockPeerManager,
      signalingChannel: mockSignalingChannel,
      myPubkey: "my-pubkey",
      relayPool: mockRelayPool,
      discoverPeers,
      isPeerBanned: async () => true,
      onError
    });

    await downloader.start();

    expect(discoverPeers).toHaveBeenCalledWith(mockChunkMap.rootHash);
    expect(onError).toHaveBeenCalledTimes(1);
    const [err] = onError.mock.calls[0] as [Error];
    expect(err.message).toContain("No eligible gatekeeper peers available");
  });

  it("calls onPeerTransferSuccess when receiving a valid chunk", async () => {
    const data = new TextEncoder().encode("entropy-valid-chunk");
    const expectedHash = await sha256Hex(data);
    const onPeerTransferSuccess = vi.fn();

    const downloader = new ChunkDownloader({
      chunkMap: {
        rootHash: "root-hash",
        chunks: [expectedHash],
        size: data.byteLength,
        chunkSize: data.byteLength,
        gatekeepers: []
      },
      peerManager: mockPeerManager,
      signalingChannel: mockSignalingChannel,
      myPubkey: "my-pubkey",
      relayPool: mockRelayPool,
      onPeerTransferSuccess
    });

    const internals = downloader as unknown as DownloaderInternals;
    internals.inFlightChunks.set(0, { peerId: "peer1", timestamp: Date.now() });
    internals.handleReceivedChunk("peer1", 0, data.buffer.slice(0));

    await vi.waitFor(() => {
      expect(onPeerTransferSuccess).toHaveBeenCalledWith("peer1", data.byteLength);
    });
    expect(downloader.downloadedCount).toBe(1);
  });

  it("calls onPeerFailedVerification when receiving an invalid chunk", async () => {
    const expectedData = new TextEncoder().encode("entropy-expected");
    const wrongData = new TextEncoder().encode("entropy-wrong");
    const expectedHash = await sha256Hex(expectedData);
    const onPeerFailedVerification = vi.fn();

    const downloader = new ChunkDownloader({
      chunkMap: {
        rootHash: "root-hash",
        chunks: [expectedHash],
        size: expectedData.byteLength,
        chunkSize: expectedData.byteLength,
        gatekeepers: []
      },
      peerManager: mockPeerManager,
      signalingChannel: mockSignalingChannel,
      myPubkey: "my-pubkey",
      relayPool: mockRelayPool,
      onPeerFailedVerification
    });

    const internals = downloader as unknown as DownloaderInternals;
    internals.inFlightChunks.set(0, { peerId: "peer2", timestamp: Date.now() });
    internals.handleReceivedChunk("peer2", 0, wrongData.buffer.slice(0));

    await vi.waitFor(() => {
      expect(onPeerFailedVerification).toHaveBeenCalledWith("peer2");
    });
    expect(downloader.downloadedCount).toBe(0);
  });

  // -----------------------------------------------------------------------
  // ICE reconnection tests
  // -----------------------------------------------------------------------

  type IceReconnectionInternals = {
    isRunning: boolean;
    connectedPeers: Set<string>;
    dataChannels: Map<string, RTCDataChannel>;
    inFlightChunks: Map<number, { peerId: string; timestamp: number }>;
    pendingChunks: number[];
    iceDisconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
    iceRestartTimers: Map<string, ReturnType<typeof setTimeout>>;
    iceRestartInProgress: Set<string>;
    startIceDisconnectTimer: (peerPubkey: string, pc: RTCPeerConnection) => void;
    attemptIceRestart: (peerPubkey: string, pc: RTCPeerConnection) => void;
    cancelIceTimers: (peerPubkey: string) => void;
    handlePeerDisconnected: (peerPubkey: string) => void;
  };

  function createDownloaderForIceTests() {
    return new ChunkDownloader({
      chunkMap: mockChunkMap,
      peerManager: mockPeerManager,
      signalingChannel: mockSignalingChannel,
      myPubkey: "my-pubkey",
      relayPool: mockRelayPool
    });
  }

  it("starts a disconnect grace timer when ICE state is 'disconnected'", () => {
    vi.useFakeTimers();
    const downloader = createDownloaderForIceTests();
    const internals = downloader as unknown as IceReconnectionInternals;
    internals.isRunning = true;

    const mockPc = {
      iceConnectionState: "disconnected",
      signalingState: "stable",
      restartIce: vi.fn(),
      createOffer: vi.fn(async () => ({ type: "offer", sdp: "restart-offer" })),
      setLocalDescription: vi.fn(async () => {}),
    } as unknown as RTCPeerConnection;

    internals.startIceDisconnectTimer("peer1", mockPc);

    expect(internals.iceDisconnectTimers.has("peer1")).toBe(true);

    // Does not start a duplicate timer
    internals.startIceDisconnectTimer("peer1", mockPc);
    expect(internals.iceDisconnectTimers.size).toBe(1);

    vi.useRealTimers();
    downloader.cancel();
  });

  it("cancels disconnect timer when ICE recovers to 'connected'", () => {
    vi.useFakeTimers();
    const downloader = createDownloaderForIceTests();
    const internals = downloader as unknown as IceReconnectionInternals;
    internals.isRunning = true;

    const mockPc = {
      iceConnectionState: "disconnected",
      signalingState: "stable",
    } as unknown as RTCPeerConnection;

    internals.startIceDisconnectTimer("peer1", mockPc);
    expect(internals.iceDisconnectTimers.has("peer1")).toBe(true);

    // Simulate ICE recovery
    internals.cancelIceTimers("peer1");
    expect(internals.iceDisconnectTimers.has("peer1")).toBe(false);

    vi.useRealTimers();
    downloader.cancel();
  });

  it("attempts ICE restart when ICE state goes to 'failed'", async () => {
    const downloader = createDownloaderForIceTests();
    const internals = downloader as unknown as IceReconnectionInternals;
    internals.isRunning = true;

    const mockPc = {
      iceConnectionState: "failed",
      signalingState: "stable",
      restartIce: vi.fn(),
      createOffer: vi.fn(async () => ({ type: "offer", sdp: "restart-offer" })),
      setLocalDescription: vi.fn(async () => {}),
    } as unknown as RTCPeerConnection;

    internals.attemptIceRestart("peer1", mockPc);

    expect(internals.iceRestartInProgress.has("peer1")).toBe(true);

    // Wait for the async ICE restart to complete
    await vi.waitFor(() => {
      expect(mockPc.restartIce).toHaveBeenCalled();
      expect(mockPc.createOffer).toHaveBeenCalledWith({ iceRestart: true });
      expect((mockSignalingChannel.sendOffer as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });

    downloader.cancel();
  });

  it("does not attempt ICE restart if already in progress", () => {
    const downloader = createDownloaderForIceTests();
    const internals = downloader as unknown as IceReconnectionInternals;
    internals.isRunning = true;
    internals.iceRestartInProgress.add("peer1");

    const mockPc = {
      iceConnectionState: "failed",
      signalingState: "stable",
      restartIce: vi.fn(),
    } as unknown as RTCPeerConnection;

    internals.attemptIceRestart("peer1", mockPc);

    expect(mockPc.restartIce).not.toHaveBeenCalled();
    downloader.cancel();
  });

  it("handles peer disconnected when connection is closed", () => {
    const downloader = createDownloaderForIceTests();
    const internals = downloader as unknown as IceReconnectionInternals;
    internals.isRunning = true;
    internals.connectedPeers.add("peer1");
    internals.inFlightChunks.set(0, { peerId: "peer1", timestamp: Date.now() });

    const mockPc = {
      signalingState: "closed",
    } as unknown as RTCPeerConnection;

    internals.attemptIceRestart("peer1", mockPc);

    // Should have handled disconnection instead of attempting restart
    expect(internals.connectedPeers.has("peer1")).toBe(false);
    expect(internals.inFlightChunks.has(0)).toBe(false);
    expect((mockPeerManager.removePeer as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("peer1");

    downloader.cancel();
  });

  it("cancel() cleans up all ICE timers", () => {
    vi.useFakeTimers();
    const downloader = createDownloaderForIceTests();
    const internals = downloader as unknown as IceReconnectionInternals;
    internals.isRunning = true;

    const mockPc = {
      iceConnectionState: "disconnected",
      signalingState: "stable",
    } as unknown as RTCPeerConnection;

    internals.startIceDisconnectTimer("peer1", mockPc);
    internals.iceRestartInProgress.add("peer2");

    expect(internals.iceDisconnectTimers.size).toBe(1);
    expect(internals.iceRestartInProgress.size).toBe(1);

    downloader.cancel();

    expect(internals.iceDisconnectTimers.size).toBe(0);
    expect(internals.iceRestartTimers.size).toBe(0);
    expect(internals.iceRestartInProgress.size).toBe(0);

    vi.useRealTimers();
  });
});
