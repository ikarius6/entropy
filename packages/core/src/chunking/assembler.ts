import type { ChunkRecord } from "./chunker";
import { toArrayBuffer } from "../crypto/hash";

export type AssemblerInput = ChunkRecord | Uint8Array | ArrayBuffer;

function toBytes(input: AssemblerInput): Uint8Array {
  if (input instanceof Uint8Array) {
    return input;
  }

  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }

  return input.data;
}

function toBlobPart(input: AssemblerInput): ArrayBuffer {
  return toArrayBuffer(toBytes(input));
}

export function assembleChunks(
  chunks: AssemblerInput[],
  mimeType = "application/octet-stream"
): Blob {
  const blobParts = chunks.map((chunk) => toBlobPart(chunk));
  return new Blob(blobParts, { type: mimeType });
}
