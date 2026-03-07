import { beforeEach, describe, expect, it, vi } from "vitest";

const decodeChunkTransferMessageMock = vi.fn();
const encodeCustodyProofMock = vi.fn(() => new ArrayBuffer(65));
const encodeChunkErrorMock = vi.fn(() => new ArrayBuffer(2));
const sendChunkOverDataChannelMock = vi.fn();
const sha256HexMock = vi.fn(async () => "aa".repeat(32));
const hexToBytesMock = vi.fn((hex: string) => new Uint8Array(hex.length / 2));
const concatBytesMock = vi.fn((...parts: Uint8Array[]) => {
  const total = parts.reduce((s, p) => s + p.length, 0);
  return new Uint8Array(total);
});

const encodeTransferReceiptMock = vi.fn(() => new ArrayBuffer(4));
const buildReceiptDraftMock = vi.fn(() => ({ kind: 9735, tags: [], content: "", created_at: 0 }));
const encodeTagUpdateMock = vi.fn(() => new ArrayBuffer(4));
const decodeTagUpdateMock = vi.fn(() => ({ type: "TAG_UPDATE", rootHash: "root", tags: [] }));
const isTagUpdateMessageMock = vi.fn(() => false);
const mergeContentTagsMock = vi.fn((_local: unknown[], incoming: unknown[]) => incoming);

vi.mock("@entropy/core", () => ({
  decodeChunkTransferMessage: decodeChunkTransferMessageMock,
  encodeCustodyProof: encodeCustodyProofMock,
  encodeChunkError: encodeChunkErrorMock,
  encodeTransferReceipt: encodeTransferReceiptMock,
  sendChunkOverDataChannel: sendChunkOverDataChannelMock,
  buildReceiptDraft: buildReceiptDraftMock,
  ENTROPY_UPSTREAM_RECEIPT_KIND: 9735,
  sha256Hex: sha256HexMock,
  hexToBytes: hexToBytesMock,
  concatBytes: concatBytesMock,
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
  encodeTagUpdate: encodeTagUpdateMock,
  decodeTagUpdate: decodeTagUpdateMock,
  isTagUpdateMessage: isTagUpdateMessageMock,
  mergeContentTags: mergeContentTagsMock
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
    expect(onChunkServed).toHaveBeenCalledWith("chunk-hash", 4, undefined);
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
      injectionOffset: 2,
      nonce: "ff".repeat(32)
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

    // before=[9,8], nonce=[0xff*32], after=[7,6]
    expect(hexToBytesMock).toHaveBeenCalledWith("ff".repeat(32));
    expect(concatBytesMock).toHaveBeenCalledTimes(1);
    const concatCall = concatBytesMock.mock.calls[0] as Uint8Array[];
    // First arg = before slice (bytes 0..2), second = nonce, third = after slice (bytes 2..)
    expect(concatCall).toHaveLength(3);
    expect(sha256HexMock).toHaveBeenCalledTimes(1);
    expect(encodeCustodyProofMock).toHaveBeenCalledWith({
      type: "CUSTODY_PROOF",
      chunkHash: "chunk-hash",
      sliceHash: "aa".repeat(32)
    });
    expect(channel.send).toHaveBeenCalled();
    expect(sendChunkOverDataChannelMock).not.toHaveBeenCalled();
  });

  it("responds with custody proof when injectionOffset is 0 (nonce prepended)", async () => {
    const { handleDataChannel } = await import("../background/chunk-server");

    decodeChunkTransferMessageMock.mockReturnValue({
      type: "CUSTODY_CHALLENGE",
      chunkHash: "chunk-hash",
      injectionOffset: 0,
      nonce: "ab".repeat(32)
    });

    const channel = new MockDataChannel();
    const chunkStore = {
      getChunk: vi.fn(async () => ({
        hash: "chunk-hash",
        rootHash: "root-hash",
        index: 0,
        data: new Uint8Array([1, 2, 3, 4]).buffer,
        createdAt: 1,
        lastAccessed: 1,
        pinned: false
      }))
    };

    handleDataChannel(channel as unknown as RTCDataChannel, "peer-a", chunkStore as never, vi.fn());
    channel.emitMessage(new ArrayBuffer(1));
    await flushAsync();

    // before=[] (empty), nonce=..., after=[1,2,3,4]
    const concatCall = concatBytesMock.mock.calls[0] as Uint8Array[];
    expect(concatCall).toHaveLength(3);
    expect(concatCall[0]).toHaveLength(0); // empty before
    expect(sha256HexMock).toHaveBeenCalledTimes(1);
    expect(channel.send).toHaveBeenCalled();
  });

  it("returns BUSY when injectionOffset exceeds chunk size", async () => {
    const { handleDataChannel } = await import("../background/chunk-server");

    decodeChunkTransferMessageMock.mockReturnValue({
      type: "CUSTODY_CHALLENGE",
      chunkHash: "chunk-hash",
      injectionOffset: 9999, // way beyond 4-byte chunk
      nonce: "cc".repeat(32)
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

    handleDataChannel(channel as unknown as RTCDataChannel, "peer-a", chunkStore as never, vi.fn());
    channel.emitMessage(new ArrayBuffer(1));
    await flushAsync();

    expect(encodeChunkErrorMock).toHaveBeenCalledWith({
      type: "CHUNK_ERROR",
      chunkHash: "chunk-hash",
      reason: "BUSY"
    });
    expect(sha256HexMock).not.toHaveBeenCalled();
  });
});
