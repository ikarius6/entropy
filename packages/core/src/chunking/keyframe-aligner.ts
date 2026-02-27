import { createFile } from "mp4box";
import { sha256Hex } from "../crypto/hash";
import { computeMerkleRoot } from "./merkle";
import { chunkFile, DEFAULT_CHUNK_SIZE_BYTES } from "./chunker";
import type { ChunkRecord, ChunkingResult } from "./chunker";

export interface KeyframeAlignedChunkingOptions {
  file: Blob;
  /** default: 5 MB */
  targetChunkSize?: number;
  mimeType: string;
}

export interface AlignedChunkResult extends ChunkingResult {
  /** Byte offset in the original file where each keyframe starts */
  keyframeOffsets: number[];
}

/** Returns true for MIME types that represent video content */
export function isVideoMimeType(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

/**
 * Parse an MP4 Blob with mp4box and resolve with the byte offset of each
 * sync sample (IDR / keyframe) in the first video track.
 *
 * Rejects if the file is not a valid MP4 or has no video track with an stss box.
 */
function extractKeyframeOffsets(file: Blob): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const mp4 = createFile();

    mp4.onError = (err: string) => reject(new Error(`mp4box error: ${err}`));

    mp4.onReady = (info) => {
      try {
        // Find first video track
        const videoTrack = info.tracks.find(
          (t) => t.video !== undefined && t.video !== null
        );
        if (!videoTrack) {
          reject(new Error("No video track found in MP4 file"));
          return;
        }

        // Access the underlying trak box to reach stss (sync sample table)
        // mp4box exposes moov.traks[] on the internal movie object
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const movie = (mp4 as any).moovBox ?? (mp4 as any).moov;
        if (!movie) {
          reject(new Error("Could not access moov box"));
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const traks: any[] = movie.traks ?? [];
        const trak = traks.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (t: any) =>
            t.tkhd?.track_id === videoTrack.id &&
            t.mdia?.minf?.stbl?.stss != null
        );

        if (!trak) {
          reject(new Error("Video track has no sync sample table (stss)"));
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stss = trak.mdia.minf.stbl.stss as { sample_numbers: number[] };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stsz = trak.mdia.minf.stbl.stsz as {
          sample_sizes: number[];
          sample_size: number;
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stco: { chunk_offsets: number[] } =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          trak.mdia.minf.stbl.stco ?? trak.mdia.minf.stbl.co64;

        if (!stsz || !stco) {
          reject(new Error("Missing stsz or stco box in video track"));
          return;
        }

        // Build cumulative byte offset for each sample (1-indexed → 0-indexed)
        const sampleSizes: number[] =
          stsz.sample_size > 0
            ? new Array(stsz.sample_sizes.length).fill(stsz.sample_size)
            : stsz.sample_sizes;

        // stss.sample_numbers are 1-indexed sample numbers
        // We can derive the byte offset by summing the sizes of all preceding samples.
        let cumOffset = 0;
        const sampleOffsets: number[] = [0];
        for (let i = 0; i < sampleSizes.length - 1; i++) {
          cumOffset += sampleSizes[i];
          sampleOffsets.push(cumOffset);
        }

        const keyframeOffsets = stss.sample_numbers
          .map((sampleNum) => sampleOffsets[sampleNum - 1] ?? 0)
          .filter((off): off is number => off !== undefined)
          .sort((a, b) => a - b);

        resolve(keyframeOffsets);
      } catch (e) {
        reject(e);
      }
    };

    // Feed the entire file into mp4box in one shot
    file.arrayBuffer().then((ab) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ab as any).fileStart = 0;
      mp4.appendBuffer(ab as ArrayBuffer & { fileStart: number });
      mp4.flush();
    }).catch(reject);
  });
}

/**
 * Chunk a video file aligning chunk boundaries to keyframes.
 *
 * Each chunk starts at a keyframe offset so that MSE can seek to any chunk
 * without needing previous chunks. Falls back to standard `chunkFile` if
 * the file is not a parseable MP4 or has no sync sample table.
 */
export async function chunkFileWithKeyframeAlignment(
  options: KeyframeAlignedChunkingOptions
): Promise<AlignedChunkResult> {
  const { file, targetChunkSize = DEFAULT_CHUNK_SIZE_BYTES, mimeType } = options;

  // Tolerance: allow chunks up to 20% larger/smaller than target
  const maxChunkSize = targetChunkSize * 1.2;

  let keyframeOffsets: number[] = [];

  // Only attempt MP4 keyframe extraction for MP4-like MIME types
  if (
    mimeType === "video/mp4" ||
    mimeType === "video/quicktime" ||
    mimeType === "video/x-m4v"
  ) {
    try {
      keyframeOffsets = await extractKeyframeOffsets(file);
    } catch (err) {
      // Non-fatal: fall back to standard chunking
      console.warn("[keyframe-aligner] Could not extract keyframes, using standard chunking:", err);
    }
  }

  // If we got no keyframe offsets (non-MP4 or parse failed), use standard chunking
  if (keyframeOffsets.length === 0) {
    const result = await chunkFile(file, targetChunkSize);
    return { ...result, keyframeOffsets: [] };
  }

  // Build chunk boundary list: start a new chunk at keyframes that are
  // at least (targetChunkSize * 0.8) bytes from the previous boundary,
  // or force a cut if we've accumulated more than maxChunkSize bytes.
  const boundaries: number[] = [0];
  let lastBoundary = 0;

  for (const kfOffset of keyframeOffsets) {
    if (kfOffset <= lastBoundary) continue; // skip offsets before current boundary

    const accumulated = kfOffset - lastBoundary;
    if (accumulated >= targetChunkSize * 0.8 || accumulated >= maxChunkSize) {
      boundaries.push(kfOffset);
      lastBoundary = kfOffset;
    }
  }
  // Always include EOF
  if (boundaries[boundaries.length - 1] < file.size) {
    boundaries.push(file.size);
  }

  // Slice file at boundaries and hash each chunk
  const chunks: ChunkRecord[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    const chunkBuffer = await file.slice(start, end).arrayBuffer();
    const data = new Uint8Array(chunkBuffer);
    const hash = await sha256Hex(data);
    chunks.push({ index: i, hash, size: data.byteLength, data });
  }

  const chunkHashes = chunks.map((c) => c.hash);
  const rootHash = await computeMerkleRoot(chunkHashes);

  return {
    rootHash,
    chunkSize: targetChunkSize,
    totalSize: file.size,
    mimeType,
    chunkHashes,
    chunks,
    keyframeOffsets,
  };
}
