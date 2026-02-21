export const ENTROPY_CHUNK_MAP_KIND = 7001;

export type NostrTag = string[];

export interface EntropyChunkMap {
  rootHash: string;
  chunks: string[];
  size: number;
  chunkSize: number;
  mimeType?: string;
  title?: string;
  gatekeepers?: string[];
}

const FALLBACK_CHUNK_SIZE = 5 * 1024 * 1024;

export const ENTROPY_TAG = "entropy";

export function buildEntropyChunkMapTags(chunkMap: EntropyChunkMap): NostrTag[] {
  const tags: NostrTag[] = [
    ["t", ENTROPY_TAG],
    ["x-hash", chunkMap.rootHash],
    ["size", String(chunkMap.size)],
    ["chunk-size", String(chunkMap.chunkSize)]
  ];

  if (chunkMap.mimeType) {
    tags.push(["mime", chunkMap.mimeType]);
  }

  if (chunkMap.title) {
    tags.push(["title", chunkMap.title]);
  }

  for (const [index, chunkHash] of chunkMap.chunks.entries()) {
    tags.push(["chunk", chunkHash, String(index)]);
  }

  for (const gatekeeper of chunkMap.gatekeepers ?? []) {
    tags.push(["gatekeeper", gatekeeper]);
  }

  return tags;
}

export function parseEntropyChunkMapTags(tags: NostrTag[]): EntropyChunkMap {
  let rootHash = "";
  let size = 0;
  let chunkSize = FALLBACK_CHUNK_SIZE;
  let mimeType: string | undefined;
  let title: string | undefined;
  const chunks: Array<{ index: number; hash: string }> = [];
  const gatekeepers: string[] = [];

  for (const tag of tags) {
    const [name, value, third] = tag;

    switch (name) {
      case "x-hash":
        rootHash = value ?? "";
        break;
      case "size":
        size = Number(value ?? 0);
        break;
      case "chunk-size":
        chunkSize = Number(value ?? FALLBACK_CHUNK_SIZE);
        break;
      case "mime":
        mimeType = value;
        break;
      case "title":
        title = value;
        break;
      case "chunk":
        if (value) {
          chunks.push({
            hash: value,
            index: Number(third ?? chunks.length)
          });
        }
        break;
      case "gatekeeper":
        if (value) {
          gatekeepers.push(value);
        }
        break;
      default:
        break;
    }
  }

  if (!rootHash) {
    throw new Error("Entropy chunk map is missing the x-hash tag.");
  }

  const orderedChunks = chunks
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.hash);

  return {
    rootHash,
    chunks: orderedChunks,
    size: Number.isFinite(size) ? size : 0,
    chunkSize: Number.isFinite(chunkSize) ? chunkSize : FALLBACK_CHUNK_SIZE,
    mimeType,
    title,
    gatekeepers
  };
}
