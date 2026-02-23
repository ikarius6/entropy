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
});
