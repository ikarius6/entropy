import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUploadPipeline } from "../hooks/useUploadPipeline";

// ---------------------------------------------------------------------------
// Mocks — must not reference top-level variables (vi.mock is hoisted)
// ---------------------------------------------------------------------------

vi.mock("@entropy/core", () => ({
  chunkFile: vi.fn(async (file: Blob) => ({
    rootHash: "root-hash-standard",
    chunkSize: 5 * 1024 * 1024,
    totalSize: file.size,
    mimeType: "text/plain",
    chunkHashes: ["hash-0"],
    chunks: [{ index: 0, hash: "hash-0", size: file.size, data: new Uint8Array(file.size) }],
  })),
  chunkFileWithKeyframeAlignment: vi.fn(async (opts: { file: Blob; mimeType: string }) => ({
    rootHash: "root-hash-video",
    chunkSize: 5 * 1024 * 1024,
    totalSize: opts.file.size,
    mimeType: opts.mimeType,
    chunkHashes: ["kf-hash-0"],
    chunks: [{ index: 0, hash: "kf-hash-0", size: opts.file.size, data: new Uint8Array(opts.file.size) }],
    keyframeOffsets: [0],
  })),
  isVideoMimeType: vi.fn((mime: string) => (mime as string).startsWith("video/")),
  buildEntropyChunkMapEvent: vi.fn(() => ({ kind: 7001, tags: [], content: "" })),
}));

vi.mock("../lib/extension-bridge", () => ({
  storeChunk: vi.fn(async () => undefined),
  delegateSeeding: vi.fn(async () => undefined),
}));

vi.mock("../stores/entropy-store", () => ({
  useEntropyStore: () => ({ pubkey: "test-pub", relayPool: null }),
}));

vi.stubGlobal("nostr", {
  getPublicKey: vi.fn(async () => "test-pub"),
  signEvent: vi.fn(async (event: unknown) => ({
    ...(event as object),
    id: "signed-id",
    sig: "signed-sig",
    pubkey: "test-pub",
  })),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useUploadPipeline", () => {
  it("should initialize with idle state", () => {
    const { result } = renderHook(() => useUploadPipeline());
    expect(result.current.progress.stage).toBe("idle");
    expect(result.current.progress.chunkingProgress).toBe(0);
    expect(result.current.progress.storingProgress).toBe(0);
    expect(result.current.progress.storedChunks).toBe(0);
    expect(result.current.progress.totalChunks).toBe(0);
    expect(result.current.progress.rootHash).toBeNull();
    expect(result.current.progress.error).toBeNull();
  });

  it("should use chunkFileWithKeyframeAlignment for video/mp4 files", async () => {
    const { chunkFileWithKeyframeAlignment, chunkFile } = await import("@entropy/core");
    vi.mocked(chunkFile).mockClear();
    vi.mocked(chunkFileWithKeyframeAlignment).mockClear();

    const { result } = renderHook(() => useUploadPipeline());
    const file = new File(["video-data"], "test.mp4", { type: "video/mp4" });

    await act(async () => {
      await result.current.start(file, "Test Video", "A video file");
    });

    expect(chunkFileWithKeyframeAlignment).toHaveBeenCalledWith({
      file,
      mimeType: "video/mp4",
    });
    expect(chunkFile).not.toHaveBeenCalled();
    expect(result.current.progress.stage).toBe("done");
  });

  it("should use chunkFile for non-video files (text/plain)", async () => {
    const { chunkFileWithKeyframeAlignment, chunkFile } = await import("@entropy/core");
    vi.mocked(chunkFile).mockClear();
    vi.mocked(chunkFileWithKeyframeAlignment).mockClear();

    const { result } = renderHook(() => useUploadPipeline());
    const file = new File(["text data"], "test.txt", { type: "text/plain" });

    await act(async () => {
      await result.current.start(file, "Test Text", "A text file");
    });

    expect(chunkFile).toHaveBeenCalledWith(file);
    expect(chunkFileWithKeyframeAlignment).not.toHaveBeenCalled();
    expect(result.current.progress.stage).toBe("done");
  });

  it("should allow cancellation and reset state", () => {
    const { result } = renderHook(() => useUploadPipeline());

    act(() => {
      result.current.cancel();
    });

    expect(result.current.progress.stage).toBe("idle");
    expect(result.current.progress.rootHash).toBeNull();
  });
});
