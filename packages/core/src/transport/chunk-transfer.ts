import { bytesToHex, hexToBytes } from "../crypto/hash";
import type { StoredChunk } from "../storage/chunk-store";

const MESSAGE_TYPE_CHUNK_REQUEST = 1;
const MESSAGE_TYPE_CHUNK_DATA = 2;
const MESSAGE_TYPE_CHUNK_ERROR = 3;

const HASH_BYTES = 32;
const REQUEST_BASE_BYTES = 1 + HASH_BYTES + HASH_BYTES + 2;
const RESPONSE_BASE_BYTES = 1 + HASH_BYTES + 4;
const ERROR_BYTES = 1 + HASH_BYTES + 1;

const ERROR_REASON_CODES = {
  NOT_FOUND: 0,
  INSUFFICIENT_CREDIT: 1,
  BUSY: 2
} as const;

const ERROR_CODE_REASONS: Record<number, ChunkErrorReason> = {
  0: "NOT_FOUND",
  1: "INSUFFICIENT_CREDIT",
  2: "BUSY"
};

export const MAX_DATA_CHANNEL_BUFFERED_AMOUNT_BYTES = 4 * 1024 * 1024;
export const DATA_CHANNEL_BUFFERED_LOW_THRESHOLD_BYTES = 256 * 1024;

export type ChunkErrorReason = "NOT_FOUND" | "INSUFFICIENT_CREDIT" | "BUSY";

export type ChunkRequestMessage = {
  type: "CHUNK_REQUEST";
  chunkHash: string;
  rootHash: string;
  requesterPubkey: string;
};

export type ChunkResponseMessage = {
  type: "CHUNK_DATA";
  chunkHash: string;
  data: ArrayBuffer;
};

export type ChunkErrorMessage = {
  type: "CHUNK_ERROR";
  chunkHash: string;
  reason: ChunkErrorReason;
};

export type ChunkTransferMessage = ChunkRequestMessage | ChunkResponseMessage | ChunkErrorMessage;

function normalizeHash(hash: string, label: string): string {
  const normalized = hash.trim().toLowerCase();

  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a 32-byte SHA-256 hex string.`);
  }

  return normalized;
}

function copyBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return buffer.slice(0);
}

function writeHash(target: Uint8Array, offset: number, hash: string, label: string): number {
  const hashBytes = hexToBytes(normalizeHash(hash, label));

  if (hashBytes.byteLength !== HASH_BYTES) {
    throw new Error(`${label} must be 32 bytes.`);
  }

  target.set(hashBytes, offset);
  return offset + HASH_BYTES;
}

function readHash(source: Uint8Array, offset: number): { hash: string; nextOffset: number } {
  const endOffset = offset + HASH_BYTES;

  if (endOffset > source.byteLength) {
    throw new Error("Chunk transfer message is truncated while reading hash.");
  }

  const hash = bytesToHex(source.subarray(offset, endOffset));
  return { hash, nextOffset: endOffset };
}

export function encodeChunkRequest(message: ChunkRequestMessage): ArrayBuffer {
  if (message.requesterPubkey.length === 0) {
    throw new Error("requesterPubkey is required.");
  }

  const pubkeyBytes = new TextEncoder().encode(message.requesterPubkey);

  if (pubkeyBytes.byteLength > 0xffff) {
    throw new Error("requesterPubkey is too large to encode.");
  }

  const output = new Uint8Array(REQUEST_BASE_BYTES + pubkeyBytes.byteLength);
  const view = new DataView(output.buffer);

  output[0] = MESSAGE_TYPE_CHUNK_REQUEST;

  let offset = 1;
  offset = writeHash(output, offset, message.chunkHash, "chunkHash");
  offset = writeHash(output, offset, message.rootHash, "rootHash");

  view.setUint16(offset, pubkeyBytes.byteLength, false);
  offset += 2;
  output.set(pubkeyBytes, offset);

  return output.buffer;
}

export function encodeChunkResponse(message: ChunkResponseMessage): ArrayBuffer {
  const data = new Uint8Array(copyBuffer(message.data));
  const output = new Uint8Array(RESPONSE_BASE_BYTES + data.byteLength);
  const view = new DataView(output.buffer);

  output[0] = MESSAGE_TYPE_CHUNK_DATA;

  let offset = 1;
  offset = writeHash(output, offset, message.chunkHash, "chunkHash");

  view.setUint32(offset, data.byteLength, false);
  offset += 4;
  output.set(data, offset);

  return output.buffer;
}

export function encodeChunkError(message: ChunkErrorMessage): ArrayBuffer {
  const reasonCode = ERROR_REASON_CODES[message.reason];

  if (reasonCode === undefined) {
    throw new Error(`Unsupported chunk transfer error reason: ${message.reason}.`);
  }

  const output = new Uint8Array(ERROR_BYTES);
  output[0] = MESSAGE_TYPE_CHUNK_ERROR;

  const offset = writeHash(output, 1, message.chunkHash, "chunkHash");
  output[offset] = reasonCode;

  return output.buffer;
}

export function decodeChunkTransferMessage(buffer: ArrayBuffer): ChunkTransferMessage {
  const input = new Uint8Array(buffer);

  if (input.byteLength < 1) {
    throw new Error("Chunk transfer message cannot be empty.");
  }

  const type = input[0];

  if (type === MESSAGE_TYPE_CHUNK_REQUEST) {
    if (input.byteLength < REQUEST_BASE_BYTES) {
      throw new Error("Chunk request message is truncated.");
    }

    let offset = 1;
    const chunkHashResult = readHash(input, offset);
    offset = chunkHashResult.nextOffset;

    const rootHashResult = readHash(input, offset);
    offset = rootHashResult.nextOffset;

    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const requesterPubkeyLength = view.getUint16(offset, false);
    offset += 2;

    const endOffset = offset + requesterPubkeyLength;

    if (endOffset > input.byteLength) {
      throw new Error("Chunk request message has an invalid requester pubkey length.");
    }

    const requesterPubkey = new TextDecoder().decode(input.subarray(offset, endOffset));

    if (requesterPubkey.length === 0) {
      throw new Error("Chunk request message has an empty requester pubkey.");
    }

    return {
      type: "CHUNK_REQUEST",
      chunkHash: chunkHashResult.hash,
      rootHash: rootHashResult.hash,
      requesterPubkey
    };
  }

  if (type === MESSAGE_TYPE_CHUNK_DATA) {
    if (input.byteLength < RESPONSE_BASE_BYTES) {
      throw new Error("Chunk data message is truncated.");
    }

    let offset = 1;
    const chunkHashResult = readHash(input, offset);
    offset = chunkHashResult.nextOffset;

    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const dataLength = view.getUint32(offset, false);
    offset += 4;

    const endOffset = offset + dataLength;

    if (endOffset > input.byteLength) {
      throw new Error("Chunk data message has an invalid payload length.");
    }

    const payload = input.slice(offset, endOffset);

    return {
      type: "CHUNK_DATA",
      chunkHash: chunkHashResult.hash,
      data: payload.buffer
    };
  }

  if (type === MESSAGE_TYPE_CHUNK_ERROR) {
    if (input.byteLength < ERROR_BYTES) {
      throw new Error("Chunk error message is truncated.");
    }

    const chunkHashResult = readHash(input, 1);
    const reasonCode = input[1 + HASH_BYTES];
    const reason = ERROR_CODE_REASONS[reasonCode];

    if (!reason) {
      throw new Error(`Chunk error message has an unknown reason code: ${reasonCode}.`);
    }

    return {
      type: "CHUNK_ERROR",
      chunkHash: chunkHashResult.hash,
      reason
    };
  }

  throw new Error(`Unknown chunk transfer message type: ${type}.`);
}

export function sendChunkOverDataChannel(channel: RTCDataChannel, chunk: StoredChunk): void {
  if (channel.readyState !== "open") {
    throw new Error("Data channel must be open to send chunks.");
  }

  const payload = encodeChunkResponse({
    type: "CHUNK_DATA",
    chunkHash: chunk.hash,
    data: chunk.data
  });

  const trySend = (): void => {
    if (channel.readyState !== "open") {
      return;
    }

    if (channel.bufferedAmount <= MAX_DATA_CHANNEL_BUFFERED_AMOUNT_BYTES) {
      channel.send(payload);
      return;
    }

    const threshold = Math.max(
      channel.bufferedAmountLowThreshold,
      DATA_CHANNEL_BUFFERED_LOW_THRESHOLD_BYTES
    );

    channel.bufferedAmountLowThreshold = threshold;

    const onBufferedAmountLow = (): void => {
      channel.removeEventListener("bufferedamountlow", onBufferedAmountLow);
      trySend();
    };

    channel.addEventListener("bufferedamountlow", onBufferedAmountLow, { once: true });
  };

  trySend();
}
