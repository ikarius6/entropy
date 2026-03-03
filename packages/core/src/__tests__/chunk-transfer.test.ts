import { describe, expect, it } from "vitest";

import type { StoredChunk } from "../storage/chunk-store";
import {
  DATA_CHANNEL_BUFFERED_LOW_THRESHOLD_BYTES,
  MAX_DATA_CHANNEL_BUFFERED_AMOUNT_BYTES,
  FRAGMENT_SIZE,
  decodeChunkTransferMessage,
  decodeCustodyChallenge,
  decodeCustodyProof,
  encodeChunkError,
  encodeChunkRequest,
  encodeChunkResponse,
  encodeCustodyChallenge,
  encodeCustodyProof,
  encodeTransferReceipt,
  decodeTransferReceipt,
  createChunkReceiver,
  sendChunkOverDataChannel,
  type TransferReceiptEvent
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

  it("encodes and decodes custody challenges", () => {
    const encoded = encodeCustodyChallenge({
      type: "CUSTODY_CHALLENGE",
      chunkHash: CHUNK_HASH,
      offset: 12,
      length: 34
    });

    const decoded = decodeCustodyChallenge(encoded);

    expect(decoded).toEqual({
      type: "CUSTODY_CHALLENGE",
      chunkHash: CHUNK_HASH,
      offset: 12,
      length: 34
    });
  });

  it("encodes and decodes custody proofs", () => {
    const encoded = encodeCustodyProof({
      type: "CUSTODY_PROOF",
      chunkHash: CHUNK_HASH,
      sliceHash: ROOT_HASH
    });

    const decoded = decodeCustodyProof(encoded);

    expect(decoded).toEqual({
      type: "CUSTODY_PROOF",
      chunkHash: CHUNK_HASH,
      sliceHash: ROOT_HASH
    });
  });

  it("routes custody challenge/proof through generic decoder", () => {
    const challenge = decodeChunkTransferMessage(
      encodeCustodyChallenge({
        type: "CUSTODY_CHALLENGE",
        chunkHash: CHUNK_HASH,
        offset: 1,
        length: 2
      })
    );

    expect(challenge).toEqual({
      type: "CUSTODY_CHALLENGE",
      chunkHash: CHUNK_HASH,
      offset: 1,
      length: 2
    });

    const proof = decodeChunkTransferMessage(
      encodeCustodyProof({
        type: "CUSTODY_PROOF",
        chunkHash: CHUNK_HASH,
        sliceHash: ROOT_HASH
      })
    );

    expect(proof).toEqual({
      type: "CUSTODY_PROOF",
      chunkHash: CHUNK_HASH,
      sliceHash: ROOT_HASH
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

  it("sends small chunks as a single message", () => {
    const channel = new MockDataChannel();
    const chunk = makeChunk({ data: new Uint8Array(100).buffer });

    sendChunkOverDataChannel(channel as unknown as RTCDataChannel, chunk);

    expect(channel.sentPayloads).toHaveLength(1);
    const decoded = decodeChunkTransferMessage(channel.sentPayloads[0]);
    expect(decoded.type).toBe("CHUNK_DATA");
  });

  it("fragments large chunks into header + data fragments", () => {
    const channel = new MockDataChannel();
    const largeData = new Uint8Array(FRAGMENT_SIZE * 3 + 1000);
    for (let i = 0; i < largeData.byteLength; i++) {
      largeData[i] = i % 256;
    }
    const chunk = makeChunk({ data: largeData.buffer });

    sendChunkOverDataChannel(channel as unknown as RTCDataChannel, chunk);

    expect(channel.sentPayloads.length).toBe(5);
    expect(new Uint8Array(channel.sentPayloads[0])[0]).toBe(4);

    let totalDataBytes = 0;
    for (let i = 1; i < channel.sentPayloads.length; i++) {
      totalDataBytes += channel.sentPayloads[i].byteLength;
    }
    expect(totalDataBytes).toBe(largeData.byteLength);
  });

  it("createChunkReceiver reassembles fragmented messages", () => {
    const channel = new MockDataChannel();
    const largeData = new Uint8Array(FRAGMENT_SIZE * 2 + 500);
    for (let i = 0; i < largeData.byteLength; i++) {
      largeData[i] = i % 256;
    }
    const chunk = makeChunk({ data: largeData.buffer });

    sendChunkOverDataChannel(channel as unknown as RTCDataChannel, chunk);

    const receiver = createChunkReceiver();
    let result = null;
    for (const payload of channel.sentPayloads) {
      result = receiver.receive(payload);
    }

    expect(result).not.toBeNull();
    expect(result!.type).toBe("CHUNK_DATA");
    if (result!.type === "CHUNK_DATA") {
      expect(result!.chunkHash).toBe(CHUNK_HASH);
      expect(new Uint8Array(result!.data)).toEqual(largeData);
    }
  });

  it("createChunkReceiver passes through small messages directly", () => {
    const receiver = createChunkReceiver();
    const encoded = encodeChunkResponse({
      type: "CHUNK_DATA",
      chunkHash: CHUNK_HASH,
      data: bytes([1, 2, 3])
    });

    const result = receiver.receive(encoded);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("CHUNK_DATA");
    if (result!.type === "CHUNK_DATA") {
      expect(Array.from(new Uint8Array(result!.data))).toEqual([1, 2, 3]);
    }
  });

  it("createChunkReceiver handles error messages", () => {
    const receiver = createChunkReceiver();
    const encoded = encodeChunkError({
      type: "CHUNK_ERROR",
      chunkHash: CHUNK_HASH,
      reason: "NOT_FOUND"
    });

    const result = receiver.receive(encoded);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("CHUNK_ERROR");
    if (result!.type === "CHUNK_ERROR") {
      expect(result!.reason).toBe("NOT_FOUND");
    }
  });
});

// ---------------------------------------------------------------------------
// Transfer Receipt
// ---------------------------------------------------------------------------

describe("transfer receipt encode/decode", () => {
  const RECEIPT: TransferReceiptEvent = {
    id: "abc123",
    pubkey: "deadbeef".repeat(8),
    created_at: 1_700_000_000,
    kind: 7772,
    tags: [
      ["p", "sender-pubkey"],
      ["x", CHUNK_HASH],
      ["bytes", "1024"],
      ["receipt", "1700000000"]
    ],
    content: "",
    sig: "ff".repeat(64)
  };

  it("round-trips a transfer receipt through encode/decode", () => {
    const encoded = encodeTransferReceipt({
      type: "TRANSFER_RECEIPT",
      chunkHash: CHUNK_HASH,
      receipt: RECEIPT
    });

    const decoded = decodeTransferReceipt(encoded);

    expect(decoded.type).toBe("TRANSFER_RECEIPT");
    expect(decoded.chunkHash).toBe(CHUNK_HASH);
    expect(decoded.receipt.id).toBe(RECEIPT.id);
    expect(decoded.receipt.pubkey).toBe(RECEIPT.pubkey);
    expect(decoded.receipt.sig).toBe(RECEIPT.sig);
    expect(decoded.receipt.kind).toBe(7772);
    expect(decoded.receipt.tags).toEqual(RECEIPT.tags);
  });

  it("is recognized by decodeChunkTransferMessage", () => {
    const encoded = encodeTransferReceipt({
      type: "TRANSFER_RECEIPT",
      chunkHash: CHUNK_HASH,
      receipt: RECEIPT
    });

    const decoded = decodeChunkTransferMessage(encoded);

    expect(decoded.type).toBe("TRANSFER_RECEIPT");
    if (decoded.type === "TRANSFER_RECEIPT") {
      expect(decoded.chunkHash).toBe(CHUNK_HASH);
      expect(decoded.receipt.sig).toBe(RECEIPT.sig);
    }
  });

  it("throws on truncated buffer", () => {
    expect(() => decodeTransferReceipt(new ArrayBuffer(5))).toThrow("truncated");
  });

  it("throws on wrong message type byte", () => {
    const buf = new Uint8Array(100);
    buf[0] = 0x01; // CHUNK_REQUEST type
    expect(() => decodeTransferReceipt(buf.buffer)).toThrow("Expected transfer receipt");
  });

  it("throws on malformed JSON", () => {
    const output = new Uint8Array(1 + 32 + 4 + 5);
    const view = new DataView(output.buffer);
    output[0] = 0x07;
    // Write a valid hash
    for (let i = 0; i < 32; i++) output[1 + i] = 0xab;
    // Write JSON length
    view.setUint32(33, 5, false);
    // Write invalid JSON
    const badJson = new TextEncoder().encode("{bad}");
    output.set(badJson, 37);

    expect(() => decodeTransferReceipt(output.buffer)).toThrow();
  });

  it("is handled by ChunkReceiver", () => {
    const receiver = createChunkReceiver();
    const encoded = encodeTransferReceipt({
      type: "TRANSFER_RECEIPT",
      chunkHash: CHUNK_HASH,
      receipt: RECEIPT
    });

    const result = receiver.receive(encoded);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("TRANSFER_RECEIPT");
  });
});
