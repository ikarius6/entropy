import { bytesToHex, hexToBytes } from "../crypto/hash";
import type { StoredChunk } from "../storage/chunk-store";

const MESSAGE_TYPE_CHUNK_REQUEST = 1;
const MESSAGE_TYPE_CHUNK_DATA = 2;
const MESSAGE_TYPE_CHUNK_ERROR = 3;
const MESSAGE_TYPE_CHUNK_DATA_HEADER = 4;

export const MESSAGE_TYPE_CUSTODY_CHALLENGE = 0x05;
export const MESSAGE_TYPE_CUSTODY_PROOF = 0x06;
export const MESSAGE_TYPE_TRANSFER_RECEIPT = 0x07;

const HASH_BYTES = 32;
const REQUEST_BASE_BYTES = 1 + HASH_BYTES + HASH_BYTES;
const RESPONSE_BASE_BYTES = 1 + HASH_BYTES + 4;
const ERROR_BYTES = 1 + HASH_BYTES + 1;
const CHUNK_DATA_HEADER_BYTES = 1 + HASH_BYTES + 4;
const CUSTODY_CHALLENGE_BYTES = 1 + HASH_BYTES + 4 + HASH_BYTES;
const CUSTODY_PROOF_BYTES = 1 + HASH_BYTES + HASH_BYTES;
const TRANSFER_RECEIPT_MIN_BYTES = 1 + HASH_BYTES + 4;

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
export const FRAGMENT_SIZE = 64 * 1024;

/** Maximum bytes a chunk receiver will accept for a single assembled chunk.
 *  Default: 7 MB — covers the 5 MB default chunk size with 20% keyframe
 *  alignment tolerance, plus extra headroom.  Anything above this from a
 *  CHUNK_DATA_HEADER is rejected immediately as a potential memory bomb. */
export const MAX_CHUNK_RECEIVE_BYTES = 7 * 1024 * 1024;

export type ChunkErrorReason = "NOT_FOUND" | "INSUFFICIENT_CREDIT" | "BUSY";

export type ChunkRequestMessage = {
  type: "CHUNK_REQUEST";
  chunkHash: string;
  rootHash: string;
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

export type CustodyChallengeMessage = {
  type: "CUSTODY_CHALLENGE";
  chunkHash: string;
  /** Byte offset at which the nonce is spliced into the full chunk data. */
  injectionOffset: number;
  nonce: string;
};

export type CustodyProofMessage = {
  type: "CUSTODY_PROOF";
  chunkHash: string;
  sliceHash: string;
};

export interface TransferReceiptEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export type TransferReceiptMessage = {
  type: "TRANSFER_RECEIPT";
  chunkHash: string;
  receipt: TransferReceiptEvent;
};

export type ChunkTransferMessage =
  | ChunkRequestMessage
  | ChunkResponseMessage
  | ChunkErrorMessage
  | CustodyChallengeMessage
  | CustodyProofMessage
  | TransferReceiptMessage;

function normalizeHash(hash: string, label: string): string {
  const normalized = hash.trim().toLowerCase();

  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a 32-byte SHA-256 hex string.`);
  }

  return normalized;
}

function assertUint32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} must be a uint32 value.`);
  }
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
  const output = new Uint8Array(REQUEST_BASE_BYTES);

  output[0] = MESSAGE_TYPE_CHUNK_REQUEST;

  let offset = 1;
  offset = writeHash(output, offset, message.chunkHash, "chunkHash");
  writeHash(output, offset, message.rootHash, "rootHash");

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

export function encodeCustodyChallenge(message: CustodyChallengeMessage): ArrayBuffer {
  assertUint32(message.injectionOffset, "injectionOffset");

  const output = new Uint8Array(CUSTODY_CHALLENGE_BYTES);
  const view = new DataView(output.buffer);

  output[0] = MESSAGE_TYPE_CUSTODY_CHALLENGE;

  let offset = 1;
  offset = writeHash(output, offset, message.chunkHash, "chunkHash");
  view.setUint32(offset, message.injectionOffset, false);
  offset += 4;
  writeHash(output, offset, message.nonce, "nonce");

  return output.buffer;
}

export function decodeCustodyChallenge(buffer: ArrayBuffer): CustodyChallengeMessage {
  const input = new Uint8Array(buffer);

  if (input.byteLength < CUSTODY_CHALLENGE_BYTES) {
    throw new Error("Custody challenge message is truncated.");
  }

  if (input[0] !== MESSAGE_TYPE_CUSTODY_CHALLENGE) {
    throw new Error(`Expected custody challenge message type ${MESSAGE_TYPE_CUSTODY_CHALLENGE}.`);
  }

  let offset = 1;
  const chunkHashResult = readHash(input, offset);
  offset = chunkHashResult.nextOffset;

  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const injectionOffset = view.getUint32(offset, false);
  offset += 4;
  const nonceResult = readHash(input, offset);

  return {
    type: "CUSTODY_CHALLENGE",
    chunkHash: chunkHashResult.hash,
    injectionOffset,
    nonce: nonceResult.hash
  };
}

export function encodeCustodyProof(message: CustodyProofMessage): ArrayBuffer {
  const output = new Uint8Array(CUSTODY_PROOF_BYTES);
  output[0] = MESSAGE_TYPE_CUSTODY_PROOF;

  let offset = 1;
  offset = writeHash(output, offset, message.chunkHash, "chunkHash");
  writeHash(output, offset, message.sliceHash, "sliceHash");

  return output.buffer;
}

export function decodeCustodyProof(buffer: ArrayBuffer): CustodyProofMessage {
  const input = new Uint8Array(buffer);

  if (input.byteLength < CUSTODY_PROOF_BYTES) {
    throw new Error("Custody proof message is truncated.");
  }

  if (input[0] !== MESSAGE_TYPE_CUSTODY_PROOF) {
    throw new Error(`Expected custody proof message type ${MESSAGE_TYPE_CUSTODY_PROOF}.`);
  }

  let offset = 1;
  const chunkHashResult = readHash(input, offset);
  offset = chunkHashResult.nextOffset;
  const sliceHashResult = readHash(input, offset);

  return {
    type: "CUSTODY_PROOF",
    chunkHash: chunkHashResult.hash,
    sliceHash: sliceHashResult.hash
  };
}

export function encodeTransferReceipt(message: TransferReceiptMessage): ArrayBuffer {
  const json = JSON.stringify(message.receipt);
  const jsonBytes = new TextEncoder().encode(json);
  const output = new Uint8Array(TRANSFER_RECEIPT_MIN_BYTES + jsonBytes.byteLength);
  const view = new DataView(output.buffer);

  output[0] = MESSAGE_TYPE_TRANSFER_RECEIPT;

  let offset = 1;
  offset = writeHash(output, offset, message.chunkHash, "chunkHash");

  view.setUint32(offset, jsonBytes.byteLength, false);
  offset += 4;
  output.set(jsonBytes, offset);

  return output.buffer;
}

export function decodeTransferReceipt(buffer: ArrayBuffer): TransferReceiptMessage {
  const input = new Uint8Array(buffer);

  if (input.byteLength < TRANSFER_RECEIPT_MIN_BYTES) {
    throw new Error("Transfer receipt message is truncated.");
  }

  if (input[0] !== MESSAGE_TYPE_TRANSFER_RECEIPT) {
    throw new Error(`Expected transfer receipt message type ${MESSAGE_TYPE_TRANSFER_RECEIPT}.`);
  }

  let offset = 1;
  const chunkHashResult = readHash(input, offset);
  offset = chunkHashResult.nextOffset;

  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const jsonLength = view.getUint32(offset, false);
  offset += 4;

  const endOffset = offset + jsonLength;

  if (endOffset > input.byteLength) {
    throw new Error("Transfer receipt message has an invalid JSON payload length.");
  }

  const jsonStr = new TextDecoder().decode(input.subarray(offset, endOffset));
  const receipt = JSON.parse(jsonStr) as TransferReceiptEvent;

  if (
    typeof receipt.id !== "string" ||
    typeof receipt.pubkey !== "string" ||
    typeof receipt.sig !== "string" ||
    typeof receipt.kind !== "number" ||
    !Array.isArray(receipt.tags)
  ) {
    throw new Error("Transfer receipt JSON is malformed.");
  }

  return {
    type: "TRANSFER_RECEIPT",
    chunkHash: chunkHashResult.hash,
    receipt
  };
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

    return {
      type: "CHUNK_REQUEST",
      chunkHash: chunkHashResult.hash,
      rootHash: rootHashResult.hash
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

  if (type === MESSAGE_TYPE_CUSTODY_CHALLENGE) {
    return decodeCustodyChallenge(buffer);
  }

  if (type === MESSAGE_TYPE_CUSTODY_PROOF) {
    return decodeCustodyProof(buffer);
  }

  if (type === MESSAGE_TYPE_TRANSFER_RECEIPT) {
    return decodeTransferReceipt(buffer);
  }

  throw new Error(`Unknown chunk transfer message type: ${type}.`);
}

export interface ChunkReceiver {
  receive(buffer: ArrayBuffer): ChunkTransferMessage | null;
}

export function createChunkReceiver(maxBytes: number = MAX_CHUNK_RECEIVE_BYTES): ChunkReceiver {
  let accumulating = false;
  let targetChunkHash = "";
  let totalLength = 0;
  let receivedLength = 0;
  let fragments: Uint8Array[] = [];

  return {
    receive(buffer: ArrayBuffer): ChunkTransferMessage | null {
      if (accumulating) {
        const frag = new Uint8Array(buffer);
        fragments.push(frag);
        receivedLength += frag.byteLength;

        if (receivedLength >= totalLength) {
          const assembled = new Uint8Array(totalLength);
          let offset = 0;
          for (const f of fragments) {
            const toCopy = Math.min(f.byteLength, totalLength - offset);
            assembled.set(f.subarray(0, toCopy), offset);
            offset += toCopy;
          }

          const result: ChunkResponseMessage = {
            type: "CHUNK_DATA",
            chunkHash: targetChunkHash,
            data: assembled.buffer
          };

          accumulating = false;
          targetChunkHash = "";
          totalLength = 0;
          receivedLength = 0;
          fragments = [];

          return result;
        }

        return null;
      }

      const input = new Uint8Array(buffer);

      if (input.byteLength < 1) {
        throw new Error("Chunk transfer message cannot be empty.");
      }

      if (input[0] === MESSAGE_TYPE_CHUNK_DATA_HEADER) {
        if (input.byteLength < CHUNK_DATA_HEADER_BYTES) {
          throw new Error("Chunk data header message is truncated.");
        }

        const hashResult = readHash(input, 1);
        const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
        const declaredLength = view.getUint32(1 + HASH_BYTES, false);

        if (declaredLength > maxBytes) {
          throw new Error(
            `Chunk data header declares ${declaredLength} bytes, ` +
            `exceeding the receiver limit of ${maxBytes} bytes.`
          );
        }

        totalLength = declaredLength;
        targetChunkHash = hashResult.hash;
        receivedLength = 0;
        fragments = [];
        accumulating = true;

        return null;
      }

      return decodeChunkTransferMessage(buffer);
    }
  };
}

function encodeChunkDataHeader(chunkHash: string, totalDataLength: number): ArrayBuffer {
  const output = new Uint8Array(CHUNK_DATA_HEADER_BYTES);
  const view = new DataView(output.buffer);

  output[0] = MESSAGE_TYPE_CHUNK_DATA_HEADER;
  writeHash(output, 1, chunkHash, "chunkHash");
  view.setUint32(1 + HASH_BYTES, totalDataLength, false);

  return output.buffer;
}

export function sendChunkOverDataChannel(channel: RTCDataChannel, chunk: StoredChunk): void {
  if (channel.readyState !== "open") {
    throw new Error("Data channel must be open to send chunks.");
  }

  const data = new Uint8Array(chunk.data);
  const messages: ArrayBuffer[] = [];

  if (data.byteLength <= FRAGMENT_SIZE) {
    messages.push(encodeChunkResponse({
      type: "CHUNK_DATA",
      chunkHash: chunk.hash,
      data: chunk.data
    }));
  } else {
    messages.push(encodeChunkDataHeader(chunk.hash, data.byteLength));

    let offset = 0;
    while (offset < data.byteLength) {
      const end = Math.min(offset + FRAGMENT_SIZE, data.byteLength);
      messages.push(data.slice(offset, end).buffer);
      offset = end;
    }
  }

  let index = 0;

  const sendNext = (): void => {
    while (index < messages.length) {
      if (channel.readyState !== "open") {
        return;
      }

      if (channel.bufferedAmount > MAX_DATA_CHANNEL_BUFFERED_AMOUNT_BYTES) {
        channel.bufferedAmountLowThreshold = Math.max(
          channel.bufferedAmountLowThreshold,
          DATA_CHANNEL_BUFFERED_LOW_THRESHOLD_BYTES
        );
        channel.addEventListener("bufferedamountlow", () => sendNext(), { once: true });
        return;
      }

      channel.send(messages[index]);
      index++;
    }
  };

  sendNext();
}
