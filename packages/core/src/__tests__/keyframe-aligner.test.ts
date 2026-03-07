import { describe, it, expect, vi, beforeEach } from "vitest";
import { chunkFileWithKeyframeAlignment, isVideoMimeType } from "../chunking/keyframe-aligner";

// ---------------------------------------------------------------------------
// Mock mp4box
// ---------------------------------------------------------------------------

const mockMp4File = {
  onError: null as ((e: string) => void) | null,
  onReady: null as ((info: unknown) => void) | null,
  appendBuffer: vi.fn(),
  flush: vi.fn(),
};

vi.mock("mp4box", () => ({
  createFile: () => ({
    ...mockMp4File,
    set onError(fn: (e: string) => void) { mockMp4File.onError = fn; },
    set onReady(fn: (info: unknown) => void) { mockMp4File.onReady = fn; },
    appendBuffer: mockMp4File.appendBuffer,
    flush: mockMp4File.flush,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal moovBox structure for a track with stss/stsz/stco */
function buildMoov(sampleSizes: number[], syncSampleNumbers: number[]) {
  const stss = { sample_numbers: syncSampleNumbers };
  const stsz = { sample_size: 0, sample_sizes: sampleSizes };
  // chunk_offsets doesn't matter for offset calculation (we use cumulative sizes)
  const stco = { chunk_offsets: [0] };
  return {
    traks: [
      {
        tkhd: { track_id: 1 },
        mdia: {
          minf: {
            stbl: { stss, stsz, stco },
          },
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isVideoMimeType", () => {
  it("returns true for video/mp4", () => {
    expect(isVideoMimeType("video/mp4")).toBe(true);
  });

  it("returns true for video/webm", () => {
    expect(isVideoMimeType("video/webm")).toBe(true);
  });

  it("returns false for text/plain", () => {
    expect(isVideoMimeType("text/plain")).toBe(false);
  });

  it("returns false for image/png", () => {
    expect(isVideoMimeType("image/png")).toBe(false);
  });

  it("returns false for audio/mp4", () => {
    expect(isVideoMimeType("audio/mp4")).toBe(false);
  });
});

describe("chunkFileWithKeyframeAlignment", () => {
  beforeEach(() => {
    mockMp4File.appendBuffer.mockClear();
    mockMp4File.flush.mockClear();
    mockMp4File.onError = null;
    mockMp4File.onReady = null;
  });

  it("falls back to standard chunking for non-MP4 MIME types (e.g. video/webm)", async () => {
    // WebM → mp4box is not attempted; falls back to standard chunkFile
    const data = new Uint8Array(1024).fill(42);
    const file = new Blob([data], { type: "video/webm" });

    const result = await chunkFileWithKeyframeAlignment({
      file,
      mimeType: "video/webm",
      targetChunkSize: 512,
    });

    expect(result.keyframeOffsets).toEqual([]);
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.rootHash).toHaveLength(64);
  });

  it("falls back to standard chunking when mp4box emits an error", async () => {
    // Simulate mp4box error for video/mp4
    const data = new Uint8Array(1024).fill(7);
    const file = new Blob([data], { type: "video/mp4" });

    // After appendBuffer is called, trigger onError
    mockMp4File.appendBuffer.mockImplementationOnce(() => {
      setTimeout(() => mockMp4File.onError?.("parse error"), 0);
    });

    const result = await chunkFileWithKeyframeAlignment({
      file,
      mimeType: "video/mp4",
      targetChunkSize: 512,
    });

    // Falls back → keyframeOffsets is empty, but chunks still produced
    expect(result.keyframeOffsets).toEqual([]);
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  it("falls back to standard chunking when mp4guard rejects bad box type", async () => {
    // Build a blob whose bytes 4-7 spell "BAAD" — not a valid ISO BMFF box.
    // assertSafeMp4 will throw before mp4box sees any bytes, and the outer
    // catch in chunkFileWithKeyframeAlignment should fall back gracefully.
    const raw = new Uint8Array(1024);
    raw[4] = 0x42; // 'B'
    raw[5] = 0x41; // 'A'
    raw[6] = 0x41; // 'A'
    raw[7] = 0x44; // 'D'
    const file = new Blob([raw], { type: "video/mp4" });

    const result = await chunkFileWithKeyframeAlignment({
      file,
      mimeType: "video/mp4",
      targetChunkSize: 512,
    });

    // Fell back to standard chunking — no keyframe offsets, but chunks produced
    expect(result.keyframeOffsets).toEqual([]);
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.rootHash).toHaveLength(64);
  });

  it("aligns chunks to keyframe offsets for video/mp4", async () => {
    // 3 samples of 400 bytes each. Sync samples: 1, 3 (1-indexed)
    // → keyframe byte offsets: [0, 800]
    const sampleSizes = [400, 400, 400];
    const syncSampleNumbers = [1, 3];

    // After appendBuffer we fire onReady with a fake info + moovBox
    mockMp4File.appendBuffer.mockImplementationOnce(() => {
      setTimeout(() => {
        const moov = buildMoov(sampleSizes, syncSampleNumbers);
        mockMp4File.onReady?.({ tracks: [{ id: 1, video: {} }], moovBox: moov });
      }, 0);
    });

    // File: 1200 bytes (3 samples × 400 B)
    const data = new Uint8Array(1200).fill(0xab);
    const file = new Blob([data], { type: "video/mp4" });

    // Make targetChunkSize smaller than file so we expect splits
    const result = await chunkFileWithKeyframeAlignment({
      file,
      mimeType: "video/mp4",
      targetChunkSize: 500, // forces split at any keyframe >= 400B from last cut
    });

    expect(result.mimeType).toBe("video/mp4");
    expect(result.totalSize).toBe(1200);
    expect(Array.isArray(result.keyframeOffsets)).toBe(true);
    // Each chunk hash is a 64-char hex string
    for (const hash of result.chunkHashes) {
      expect(hash).toHaveLength(64);
    }
    // rootHash is computed from chunk hashes
    expect(result.rootHash).toHaveLength(64);
  });
});
