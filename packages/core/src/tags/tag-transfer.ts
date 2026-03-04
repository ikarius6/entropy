/**
 * Binary encode/decode for TAG_UPDATE messages over WebRTC DataChannel.
 *
 * TAG_UPDATE (type=0x08)
 * ┌──────┬──────────────┬────────────┬──────────────────────────────────┐
 * │ 0x08 │ root_hash    │ tag_count  │ tag_entries[]                    │
 * │ 1B   │ 32B (SHA256) │ 1B (u8)    │ variable                         │
 * └──────┴──────────────┴────────────┴──────────────────────────────────┘
 *
 * Each tag_entry:
 * ┌───────────┬──────────────┬──────────────┬───────────────────────┐
 * │ name_len  │ name (UTF-8) │ counter      │ updatedAt             │
 * │ 1B (u8)   │ ≤20B         │ 4B (u32)     │ 4B (u32, epoch secs)  │
 * └───────────┴──────────────┴──────────────┴───────────────────────┘
 */

import { bytesToHex, hexToBytes } from "../crypto/hash";
import type { ContentTag } from "./content-tags";

export const MESSAGE_TYPE_TAG_UPDATE = 0x08;

const HASH_BYTES = 32;
const TAG_UPDATE_HEADER_BYTES = 1 + HASH_BYTES + 1; // type + rootHash + tagCount

export interface TagUpdateMessage {
  type: "TAG_UPDATE";
  rootHash: string;
  tags: ContentTag[];
}

function normalizeHash(hash: string): string {
  const normalized = hash.trim().toLowerCase();

  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("rootHash must be a 32-byte SHA-256 hex string.");
  }

  return normalized;
}

export function encodeTagUpdate(message: TagUpdateMessage): ArrayBuffer {
  const rootHashHex = normalizeHash(message.rootHash);
  const rootHashBytes = hexToBytes(rootHashHex);

  if (message.tags.length > 255) {
    throw new Error("TAG_UPDATE supports at most 255 tags per message.");
  }

  const encoder = new TextEncoder();
  const encodedNames: Uint8Array[] = [];
  let totalPayloadSize = TAG_UPDATE_HEADER_BYTES;

  for (const tag of message.tags) {
    const nameBytes = encoder.encode(tag.name);

    if (nameBytes.byteLength > 255) {
      throw new Error(`Tag name "${tag.name}" exceeds 255 bytes when UTF-8 encoded.`);
    }

    encodedNames.push(nameBytes);
    totalPayloadSize += 1 + nameBytes.byteLength + 4 + 4; // nameLen + name + counter + updatedAt
  }

  const output = new Uint8Array(totalPayloadSize);
  const view = new DataView(output.buffer);

  output[0] = MESSAGE_TYPE_TAG_UPDATE;
  output.set(rootHashBytes, 1);
  output[1 + HASH_BYTES] = message.tags.length;

  let offset = TAG_UPDATE_HEADER_BYTES;

  for (let i = 0; i < message.tags.length; i++) {
    const tag = message.tags[i];
    const nameBytes = encodedNames[i];

    output[offset] = nameBytes.byteLength;
    offset += 1;

    output.set(nameBytes, offset);
    offset += nameBytes.byteLength;

    view.setUint32(offset, tag.counter >>> 0, false);
    offset += 4;

    view.setUint32(offset, tag.updatedAt >>> 0, false);
    offset += 4;
  }

  return output.buffer;
}

export function decodeTagUpdate(buffer: ArrayBuffer): TagUpdateMessage {
  const input = new Uint8Array(buffer);

  if (input.byteLength < TAG_UPDATE_HEADER_BYTES) {
    throw new Error("TAG_UPDATE message is truncated.");
  }

  if (input[0] !== MESSAGE_TYPE_TAG_UPDATE) {
    throw new Error(`Expected TAG_UPDATE message type ${MESSAGE_TYPE_TAG_UPDATE}, got ${input[0]}.`);
  }

  const rootHash = bytesToHex(input.subarray(1, 1 + HASH_BYTES));
  const tagCount = input[1 + HASH_BYTES];

  const decoder = new TextDecoder();
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const tags: ContentTag[] = [];

  let offset = TAG_UPDATE_HEADER_BYTES;

  for (let i = 0; i < tagCount; i++) {
    if (offset >= input.byteLength) {
      throw new Error("TAG_UPDATE message is truncated while reading tag entries.");
    }

    const nameLen = input[offset];
    offset += 1;

    if (offset + nameLen + 8 > input.byteLength) {
      throw new Error("TAG_UPDATE tag entry is truncated.");
    }

    const name = decoder.decode(input.subarray(offset, offset + nameLen));
    offset += nameLen;

    const counter = view.getUint32(offset, false);
    offset += 4;

    const updatedAt = view.getUint32(offset, false);
    offset += 4;

    tags.push({ name, counter, updatedAt });
  }

  return { type: "TAG_UPDATE", rootHash, tags };
}

export function isTagUpdateMessage(buffer: ArrayBuffer): boolean {
  const input = new Uint8Array(buffer);
  return input.byteLength >= 1 && input[0] === MESSAGE_TYPE_TAG_UPDATE;
}
