import { useState, useEffect } from "react";
import { getChunk } from "../lib/extension-bridge";
import { assembleChunks } from "@entropy/core";
import type { EntropyChunkMap } from "@entropy/core";

export type ChunkBlobStatus = "idle" | "loading" | "ready" | "error";

export interface UseChunkBlobResult {
  blobUrl: string | null;
  status: ChunkBlobStatus;
  error: string | null;
  progress: number;
}

/**
 * Retrieves all chunks for a given EntropyChunkMap from the extension's
 * IndexedDB store, assembles them into a Blob, and returns an object URL.
 */
export function useChunkBlob(chunkMap: EntropyChunkMap | null): UseChunkBlobResult {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ChunkBlobStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!chunkMap) return;

    let cancelled = false;
    let createdUrl: string | null = null;

    async function load() {
      if (!chunkMap) return;
      setStatus("loading");
      setError(null);
      setProgress(0);

      try {
        const total = chunkMap.chunks.length;
        const buffers: ArrayBuffer[] = new Array(total);
        console.log(`[useChunkBlob] loading ${total} chunk(s) for rootHash=${chunkMap.rootHash.slice(0,12)}… mime=${chunkMap.mimeType}`);
        console.log(`[useChunkBlob] gatekeepers:`, chunkMap.gatekeepers);

        for (let i = 0; i < total; i++) {
          if (cancelled) return;
          const hash = chunkMap.chunks[i];
          const payload = { hash, rootHash: chunkMap.rootHash, gatekeepers: chunkMap.gatekeepers };
          console.log(`[useChunkBlob] GET_CHUNK ${i + 1}/${total} payload:`, JSON.stringify(payload).slice(0, 200));
          const result = await getChunk(payload, 30_000);
          console.log(`[useChunkBlob] result for chunk ${i}:`, result ? `ok, ${result.data.length} bytes` : 'null (not in store)');

          if (!result) {
            throw new Error(`Chunk ${i} (${hash.slice(0, 8)}…) not found in local store.`);
          }

          buffers[result.index] = new Uint8Array(result.data).buffer;
          setProgress((i + 1) / total);
        }

        if (cancelled) return;

        const blob = assembleChunks(buffers, chunkMap.mimeType || "application/octet-stream");
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
        setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus("error");
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [chunkMap?.rootHash]);

  return { blobUrl, status, error, progress };
}
