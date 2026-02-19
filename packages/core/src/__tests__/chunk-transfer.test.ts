import { describe, expect, it } from "vitest";

import type { StoredChunk } from "../storage/chunk-store";
import {
  DATA_CHANNEL_BUFFERED_LOW_THRESHOLD_BYTES,
  MAX_DATA_CHANNEL_BUFFERED_AMOUNT_BYTES,
  decodeChunkTransferMessage,
  encodeChunkError,
  encodeChunkRequest,
  encodeChunkResponse,
  sendChunkOverDataChannel
} from "../transport/chunk-transfer";

const CHUNK_HASH = "ab".repeat(32);
const ROOT_HASH = "cd".repeat(32);

function bytes(values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

function makeChunk(overrides: Partial<StoredChunk> = {}): StoredChunk {
  return {
    hash: CHUNK_HASH,
    data: bytes([1, 2, 3, 4]),
    rootHash: "root-a",
    index: 0,
    createdAt: 1,
    lastAccessed: 1,
    pinned: false,
    ...overrides
  };
}

class MockDataChannel {
  readyState: RTCDataChannelState = "open";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  sentPayloads: ArrayBuffer[] = [];
  private bufferedAmountLowListener: (() => void) | null = null;

  send(data: string | Blob | ArrayBuffer | ArrayBufferView): void {
    if (data instanceof ArrayBuffer) {
      this.sentPayloads.push(data.slice(0));
      return;
    }

    if (ArrayBuffer.isView(data)) {
      const payload = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      this.sentPayloads.push(payload.slice().buffer);
      return;
    }

    throw new Error("Unexpected payload type in MockDataChannel.");
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    _options?: AddEventListenerOptions | boolean
  ): void {
    if (type !== "bufferedamountlow") {
      return;
    }

    this.bufferedAmountLowListener = () => {
      if (typeof listener === "function") {
        listener(new Event("bufferedamountlow"));
      } else {
        listener.handleEvent(new Event("bufferedamountlow"));
      }
    };
  }

  removeEventListener(
    type: string,
    _listener: EventListenerOrEventListenerObject,
    _options?: EventListenerOptions | boolean
  ): void {
    if (type === "bufferedamountlow") {
      this.bufferedAmountLowListener = null;
    }
  }

  emitBufferedAmountLow(): void {
    const listener = this.bufferedAmountLowListener;
    this.bufferedAmountLowListener = null;
    listener?.();
  }
}

describe("chunk transfer", () => {
  it("encodes and decodes chunk requests", () => {
    const encoded = encodeChunkRequest({
      type: "CHUNK_REQUEST",
      chunkHash: CHUNK_HASH,
      rootHash: ROOT_HASH,
      requesterPubkey: "npub1requester"
    });

    const decoded = decodeChunkTransferMessage(encoded);

    expect(decoded).toEqual({
      type: "CHUNK_REQUEST",
      chunkHash: CHUNK_HASH,
      rootHash: ROOT_HASH,
      requesterPubkey: "npub1requester"
    });
  });

  it("encodes and decodes chunk data payloads", () => {
    const encoded = encodeChunkResponse({
      type: "CHUNK_DATA",
      chunkHash: CHUNK_HASH,
      data: bytes([7, 8, 9])
    });

    const decoded = decodeChunkTransferMessage(encoded);

    expect(decoded.type).toBe("CHUNK_DATA");

    if (decoded.type !== "CHUNK_DATA") {
      return;
    }

    expect(decoded.chunkHash).toBe(CHUNK_HASH);
    expect(Array.from(new Uint8Array(decoded.data))).toEqual([7, 8, 9]);
  });

  it("encodes and decodes chunk errors", () => {
    const encoded = encodeChunkError({
      type: "CHUNK_ERROR",
      chunkHash: CHUNK_HASH,
      reason: "BUSY"
    });

    const decoded = decodeChunkTransferMessage(encoded);

    expect(decoded).toEqual({
      type: "CHUNK_ERROR",
      chunkHash: CHUNK_HASH,
      reason: "BUSY"
    });
  });

  it("throws for unknown message types", () => {
    expect(() => decodeChunkTransferMessage(new Uint8Array([255]).buffer)).toThrowError(
      "Unknown chunk transfer message type: 255."
    );
  });

  it("sends chunk payload immediately when buffered amount is low", () => {
    const channel = new MockDataChannel();

    sendChunkOverDataChannel(channel as unknown as RTCDataChannel, makeChunk());

    expect(channel.sentPayloads).toHaveLength(1);

    const decoded = decodeChunkTransferMessage(channel.sentPayloads[0]);
    expect(decoded.type).toBe("CHUNK_DATA");
  });

  it("waits for bufferedamountlow event before sending when under backpressure", () => {
    const channel = new MockDataChannel();
    channel.bufferedAmount = MAX_DATA_CHANNEL_BUFFERED_AMOUNT_BYTES + 1;

    sendChunkOverDataChannel(channel as unknown as RTCDataChannel, makeChunk());

    expect(channel.sentPayloads).toHaveLength(0);
    expect(channel.bufferedAmountLowThreshold).toBeGreaterThanOrEqual(
      DATA_CHANNEL_BUFFERED_LOW_THRESHOLD_BYTES
    );

    channel.bufferedAmount = 0;
    channel.emitBufferedAmountLow();

    expect(channel.sentPayloads).toHaveLength(1);
  });

  it("throws when channel is not open", () => {
    const channel = new MockDataChannel();
    channel.readyState = "closing";

    expect(() =>
      sendChunkOverDataChannel(channel as unknown as RTCDataChannel, makeChunk())
    ).toThrowError("Data channel must be open to send chunks.");
  });
});
