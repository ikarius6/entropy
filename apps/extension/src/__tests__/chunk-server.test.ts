import { beforeEach, describe, expect, it, vi } from "vitest";

const decodeChunkTransferMessageMock = vi.fn();
const encodeCustodyProofMock = vi.fn(() => new ArrayBuffer(65));
const encodeChunkErrorMock = vi.fn(() => new ArrayBuffer(2));
const sendChunkOverDataChannelMock = vi.fn();
const sha256HexMock = vi.fn(async () => "aa".repeat(32));

vi.mock("@entropy/core", () => ({
  decodeChunkTransferMessage: decodeChunkTransferMessageMock,
  encodeCustodyProof: encodeCustodyProofMock,
  encodeChunkError: encodeChunkErrorMock,
  sendChunkOverDataChannel: sendChunkOverDataChannelMock,
  sha256Hex: sha256HexMock,
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

class MockDataChannel {
  readyState: RTCDataChannelState = "open";
  binaryType: BinaryType = "arraybuffer";
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = "closed";
    this.emitClose();
  });
  private listeners = new Map<string, ((event: Event) => void)[]>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const fn = listener as (event: Event) => void;
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...existing, fn]);
  }

  emitMessage(data: unknown): void {
    for (const fn of this.listeners.get("message") ?? []) {
      fn({ data } as unknown as Event);
    }
  }

  emitClose(): void {
    for (const fn of this.listeners.get("close") ?? []) {
      fn(new Event("close"));
    }
  }
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("chunk-server", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("serves a chunk when request is valid and authorized", async () => {
    const { handleDataChannel } = await import("../background/chunk-server");

    const chunk = {
      hash: "chunk-hash",
      rootHash: "root-hash",
      index: 0,
      data: new ArrayBuffer(4),
      createdAt: 1,
      lastAccessed: 1,
      pinned: false
    };

    decodeChunkTransferMessageMock.mockReturnValue({
      type: "CHUNK_REQUEST",
      chunkHash: "chunk-hash",
      rootHash: "root-hash",
      requesterPubkey: "peer-a"
    });

    const channel = new MockDataChannel();
    const onChunkServed = vi.fn();
    const chunkStore = {
      getChunk: vi.fn(async () => chunk)
    };

    handleDataChannel(
      channel as unknown as RTCDataChannel,
      "peer-a",
      chunkStore as never,
      onChunkServed,
      {
        authorizeRequest: async () => true
      }
    );

    channel.emitMessage(new ArrayBuffer(1));
    await flushAsync();

    expect(sendChunkOverDataChannelMock).toHaveBeenCalledWith(channel, chunk);
    expect(onChunkServed).toHaveBeenCalledWith("chunk-hash", 4);
    expect(encodeChunkErrorMock).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when chunk is missing", async () => {
    const { handleDataChannel } = await import("../background/chunk-server");

    decodeChunkTransferMessageMock.mockReturnValue({
      type: "CHUNK_REQUEST",
      chunkHash: "chunk-hash",
      rootHash: "root-hash",
      requesterPubkey: "peer-a"
    });

    const channel = new MockDataChannel();
    const chunkStore = {
      getChunk: vi.fn(async () => null)
    };

    handleDataChannel(channel as unknown as RTCDataChannel, "peer-a", chunkStore as never, vi.fn());

    channel.emitMessage(new ArrayBuffer(1));
    await flushAsync();

    expect(encodeChunkErrorMock).toHaveBeenCalledWith({
      type: "CHUNK_ERROR",
      chunkHash: "chunk-hash",
      reason: "NOT_FOUND"
    });
    expect(channel.send).toHaveBeenCalled();
  });

  it("returns BUSY when requester pubkey does not match active peer", async () => {
    const { handleDataChannel } = await import("../background/chunk-server");

    decodeChunkTransferMessageMock.mockReturnValue({
      type: "CHUNK_REQUEST",
      chunkHash: "chunk-hash",
      rootHash: "root-hash",
      requesterPubkey: "peer-other"
    });

    const channel = new MockDataChannel();
    const chunkStore = {
      getChunk: vi.fn(async () => null)
    };

    handleDataChannel(channel as unknown as RTCDataChannel, "peer-a", chunkStore as never, vi.fn());

    channel.emitMessage(new ArrayBuffer(1));
    await flushAsync();

    expect(encodeChunkErrorMock).toHaveBeenCalledWith({
      type: "CHUNK_ERROR",
      chunkHash: "chunk-hash",
      reason: "BUSY"
    });
    expect(chunkStore.getChunk).not.toHaveBeenCalled();
  });

  it("returns INSUFFICIENT_CREDIT when authorization fails", async () => {
    const { handleDataChannel } = await import("../background/chunk-server");

    decodeChunkTransferMessageMock.mockReturnValue({
      type: "CHUNK_REQUEST",
      chunkHash: "chunk-hash",
      rootHash: "root-hash",
      requesterPubkey: "peer-a"
    });

    const chunk = {
      hash: "chunk-hash",
      rootHash: "root-hash",
      index: 0,
      data: new ArrayBuffer(4),
      createdAt: 1,
      lastAccessed: 1,
      pinned: false
    };

    const channel = new MockDataChannel();
    const chunkStore = {
      getChunk: vi.fn(async () => chunk)
    };

    handleDataChannel(
      channel as unknown as RTCDataChannel,
      "peer-a",
      chunkStore as never,
      vi.fn(),
      {
        authorizeRequest: async () => false
      }
    );

    channel.emitMessage(new ArrayBuffer(1));
    await flushAsync();

    expect(encodeChunkErrorMock).toHaveBeenCalledWith({
      type: "CHUNK_ERROR",
      chunkHash: "chunk-hash",
      reason: "INSUFFICIENT_CREDIT"
    });
    expect(sendChunkOverDataChannelMock).not.toHaveBeenCalled();
  });

  it("returns BUSY when peer exceeds rate limit", async () => {
    const { handleDataChannel } = await import("../background/chunk-server");

    decodeChunkTransferMessageMock.mockReturnValue({
      type: "CHUNK_REQUEST",
      chunkHash: "chunk-hash",
      rootHash: "root-hash",
      requesterPubkey: "peer-rate"
    });

    const chunk = {
      hash: "chunk-hash",
      rootHash: "root-hash",
      index: 0,
      data: new ArrayBuffer(4),
      createdAt: 1,
      lastAccessed: 1,
      pinned: false
    };

    const channel = new MockDataChannel();
    const chunkStore = { getChunk: vi.fn(async () => chunk) };

    handleDataChannel(
      channel as unknown as RTCDataChannel,
      "peer-rate",
      chunkStore as never,
      vi.fn(),
      { authorizeRequest: async () => true }
    );

    // Send 11 messages in the same tick — first 10 should succeed, 11th should be rate-limited
    for (let i = 0; i < 11; i++) {
      channel.emitMessage(new ArrayBuffer(1));
    }
    await flushAsync();

    const busyCalls = (encodeChunkErrorMock.mock.calls as unknown as Array<[{ reason: string }]>).filter(
      ([arg]) => arg.reason === "BUSY"
    );
    expect(busyCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("ignores oversized messages without crashing", async () => {
    const { handleDataChannel } = await import("../background/chunk-server");

    const channel = new MockDataChannel();
    const chunkStore = { getChunk: vi.fn(async () => null) };

    handleDataChannel(channel as unknown as RTCDataChannel, "peer-big", chunkStore as never, vi.fn());

    // 5 MB buffer — exceeds MAX_MESSAGE_BYTES (4 MB)
    channel.emitMessage(new ArrayBuffer(5 * 1024 * 1024));
    await flushAsync();

    expect(decodeChunkTransferMessageMock).not.toHaveBeenCalled();
    expect(encodeChunkErrorMock).not.toHaveBeenCalled();
  });

  it("responds with custody proof when receiving a valid custody challenge", async () => {
    const { handleDataChannel } = await import("../background/chunk-server");

    decodeChunkTransferMessageMock.mockReturnValue({
      type: "CUSTODY_CHALLENGE",
      chunkHash: "chunk-hash",
      offset: 1,
      length: 2
    });

    const channel = new MockDataChannel();
    const chunkStore = {
      getChunk: vi.fn(async () => ({
        hash: "chunk-hash",
        rootHash: "root-hash",
        index: 0,
        data: new Uint8Array([9, 8, 7, 6]).buffer,
        createdAt: 1,
        lastAccessed: 1,
        pinned: false
      }))
    };

    handleDataChannel(
      channel as unknown as RTCDataChannel,
      "peer-a",
      chunkStore as never,
      vi.fn()
    );

    channel.emitMessage(new ArrayBuffer(1));
    await flushAsync();

    expect(sha256HexMock).toHaveBeenCalledTimes(1);
    expect(encodeCustodyProofMock).toHaveBeenCalledWith({
      type: "CUSTODY_PROOF",
      chunkHash: "chunk-hash",
      sliceHash: "aa".repeat(32)
    });
    expect(channel.send).toHaveBeenCalled();
    expect(sendChunkOverDataChannelMock).not.toHaveBeenCalled();
  });
});
