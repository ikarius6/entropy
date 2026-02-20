import { describe, expect, it, vi } from "vitest";
import { ChunkDownloader } from "../transport/chunk-downloader";
import type { EntropyChunkMap, PeerManager, SignalingChannel, RelayPool } from "../index";

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
    start: vi.fn(),
    stop: vi.fn(),
    sendOffer: vi.fn(),
    sendAnswer: vi.fn(),
    sendIceCandidate: vi.fn(),
    onMessage: vi.fn()
  } as unknown as SignalingChannel;

  const mockRelayPool = {} as unknown as RelayPool;

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
});
