import { beforeEach, describe, expect, it, vi } from "vitest";

const decodeChunkTransferMessageMock = vi.fn();
const encodeChunkErrorMock = vi.fn(() => new ArrayBuffer(2));
const sendChunkOverDataChannelMock = vi.fn();

vi.mock("@entropy/core", () => ({
  decodeChunkTransferMessage: decodeChunkTransferMessageMock,
  encodeChunkError: encodeChunkErrorMock,
  sendChunkOverDataChannel: sendChunkOverDataChannelMock
}));

class MockDataChannel {
  readyState: RTCDataChannelState = "open";
  binaryType: BinaryType = "arraybuffer";
  send = vi.fn();
  private onMessage: ((event: MessageEvent) => void) | null = null;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type !== "message") {
      return;
    }

    this.onMessage = listener as (event: MessageEvent) => void;
  }

  emitMessage(data: unknown): void {
    this.onMessage?.({ data } as MessageEvent);
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
});
