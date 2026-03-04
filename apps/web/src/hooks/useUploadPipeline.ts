import { useState } from "react";
import {
  chunkFile,
  chunkFileWithKeyframeAlignment,
  isVideoMimeType,
  buildEntropyChunkMapEvent,
  normalizeTagName,
  validateTagName,
} from "@entropy/core";
import type { EntropyChunkMap } from "@entropy/core";
import { storeChunk, delegateSeeding, tagContent } from "../lib/extension-bridge";
import { useEntropyStore } from "../stores/entropy-store";

export type UploadStage =
  | "idle"
  | "chunking"
  | "hashing"
  | "storing"
  | "delegating"
  | "publishing"
  | "done"
  | "error";

export interface UploadProgress {
  stage: UploadStage;
  chunkingProgress: number;   // 0..1
  storingProgress: number;    // 0..1
  storedChunks: number;
  totalChunks: number;
  rootHash: string | null;
  error: string | null;
}

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent(event: object): Promise<object>;
    };
  }
}

const IDLE_PROGRESS: UploadProgress = {
  stage: "idle",
  chunkingProgress: 0,
  storingProgress: 0,
  storedChunks: 0,
  totalChunks: 0,
  rootHash: null,
  error: null,
};

export function useUploadPipeline() {
  const { pubkey, relayPool } = useEntropyStore();
  const [progress, setProgress] = useState<UploadProgress>(IDLE_PROGRESS);

  const start = async (file: File, title: string, description: string, initialTag?: string) => {
    try {
      setProgress({ ...IDLE_PROGRESS, stage: "chunking", error: null });

      // 1. Chunk + hash: use keyframe-aligned chunking for video to enable smooth MSE streaming
      console.log("[upload] chunking file:", file.name, file.size);
      const result = isVideoMimeType(file.type)
        ? await chunkFileWithKeyframeAlignment({ file, mimeType: file.type })
        : await chunkFile(file);
      console.log("[upload] chunking done, rootHash:", result.rootHash, "chunks:", result.chunks.length);

      setProgress(p => ({
        ...p,
        stage: "storing",
        chunkingProgress: 1,
        totalChunks: result.chunks.length,
        rootHash: result.rootHash,
      }));

      // 2. Store each chunk in the extension
      for (let i = 0; i < result.chunks.length; i++) {
        const chunk = result.chunks[i];
        console.log(`[upload] storing chunk ${i + 1}/${result.chunks.length} hash=${chunk.hash}`);
        await storeChunk({
          hash: chunk.hash,
          rootHash: result.rootHash,
          index: chunk.index,
          data: Array.from(chunk.data),
        });
        setProgress(p => ({
          ...p,
          storedChunks: i + 1,
          storingProgress: (i + 1) / result.chunks.length,
        }));
      }

      // 3. Delegate seeding to extension
      setProgress(p => ({ ...p, stage: "delegating" }));
      // Build initial entropy-tags from the user-provided tag (if valid)
      const entropyTags = (() => {
        if (!initialTag) return undefined;
        const validation = validateTagName(initialTag);
        if (!validation.valid || !validation.normalized) return undefined;
        const now = Math.floor(Date.now() / 1000);
        return [{ name: validation.normalized, counter: 1, updatedAt: now }];
      })();

      const chunkMap: EntropyChunkMap = {
        rootHash: result.rootHash,
        chunks: result.chunkHashes,
        size: result.totalSize,
        chunkSize: result.chunkSize,
        mimeType: result.mimeType,
        title: title || file.name,
        gatekeepers: pubkey ? [pubkey] : [],
        entropyTags,
      };
      console.log("[upload] delegating seeding for rootHash:", result.rootHash);
      await delegateSeeding({
        rootHash: result.rootHash,
        chunkHashes: result.chunkHashes,
        size: result.totalSize,
        chunkSize: result.chunkSize,
        mimeType: result.mimeType,
        title: title || file.name,
      });

      // 4. Build and sign the Nostr kind:7001 event via NIP-07
      setProgress(p => ({ ...p, stage: "publishing" }));
      const draft = buildEntropyChunkMapEvent({
        chunkMap,
        content: description || title || file.name,
      });

      if (!window.nostr) {
        throw new Error("NIP-07 signer not available. Is the Entropy extension enabled?");
      }

      console.log("[upload] signing event via NIP-07...");
      const signed = await window.nostr.signEvent(draft);
      console.log("[upload] signed event:", signed);

      // 5. Publish to all connected relays
      if (relayPool) {
        relayPool.publish(signed as Parameters<typeof relayPool.publish>[0]);
        console.log("[upload] published to relay pool");
      } else {
        console.warn("[upload] no relayPool connected — event signed but not published to relays");
      }

      // Tag content in extension for local persistence and P2P propagation
      if (initialTag) {
        try {
          const normalized = normalizeTagName(initialTag);
          await tagContent(result.rootHash, normalized);
          console.log("[upload] tagged content:", normalized);
        } catch (tagErr) {
          console.warn("[upload] failed to tag content:", tagErr);
        }
      }

      setProgress(p => ({ ...p, stage: "done" }));
    } catch (err) {
      console.error("[upload] pipeline error:", err);
      setProgress(p => ({
        ...p,
        stage: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    }
  };

  const cancel = () => {
    setProgress(IDLE_PROGRESS);
  };

  return { progress, start, cancel };
}
