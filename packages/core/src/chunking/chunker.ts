import { sha256Hex, toArrayBuffer } from "../crypto/hash";
import { computeMerkleRoot } from "./merkle";

export const DEFAULT_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;

export type BinaryInput = Blob | ArrayBuffer | ArrayBufferView;

export interface ChunkRecord {
  index: number;
  hash: string;
  size: number;
  data: Uint8Array;
}

export interface ChunkMapData {
  rootHash: string;
  chunkSize: number;
  totalSize: number;
  mimeType: string;
  chunkHashes: string[];
}

export interface ChunkingResult extends ChunkMapData {
  chunks: ChunkRecord[];
}

function toBlob(input: BinaryInput): Blob {
  if (input instanceof Blob) {
    return input;
  }

  return new Blob([toArrayBuffer(input)]);
}

export function estimateChunkCount(totalSize: number, chunkSize = DEFAULT_CHUNK_SIZE_BYTES): number {
  if (totalSize <= 0) {
    return 0;
  }

  return Math.ceil(totalSize / chunkSize);
}

export async function chunkFile(
  input: BinaryInput,
  chunkSize = DEFAULT_CHUNK_SIZE_BYTES
): Promise<ChunkingResult> {
  if (chunkSize <= 0) {
    throw new Error("chunkSize must be greater than zero.");
  }

  const blob = toBlob(input);
  const chunks: ChunkRecord[] = [];

  for (let offset = 0, index = 0; offset < blob.size; offset += chunkSize, index += 1) {
    const chunkBuffer = await blob.slice(offset, offset + chunkSize).arrayBuffer();
    const data = new Uint8Array(chunkBuffer);
    const hash = await sha256Hex(data);

    chunks.push({
      index,
      hash,
      size: data.byteLength,
      data
    });
  }

  const chunkHashes = chunks.map((chunk) => chunk.hash);
  const rootHash = await computeMerkleRoot(chunkHashes);

  return {
    rootHash,
    chunkSize,
    totalSize: blob.size,
    mimeType: blob.type || "application/octet-stream",
    chunkHashes,
    chunks
  };
}
