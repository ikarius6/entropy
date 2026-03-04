import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock getChunk bridge call — tracks how many times it's invoked
// ---------------------------------------------------------------------------

const mockGetChunk = vi.fn();

vi.mock("../lib/extension-bridge", () => ({
  getChunk: (...args: unknown[]) => mockGetChunk(...args)
}));

vi.mock("@entropy/core", () => ({
  assembleChunks: vi.fn((buffers: ArrayBuffer[], mime: string) =>
    new Blob(buffers, { type: mime })
  )
}));

import { useChunkBlob } from "../hooks/useChunkBlob";
import type { EntropyChunkMap } from "@entropy/core";

// jsdom does not implement URL.createObjectURL / revokeObjectURL
let blobCounter = 0;
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => `blob:test/${++blobCounter}`;
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => {};
}

function makeChunkMap(overrides: Partial<EntropyChunkMap> = {}): EntropyChunkMap {
  return {
    rootHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    chunks: ["chunk-hash-0"],
    size: 900_000,
    chunkSize: 1_048_576,
    mimeType: "image/jpeg",
    gatekeepers: ["gk-pubkey-1"],
    title: "test-image",
    ...overrides
  };
}

function makeChunkResponse(hash: string, index: number, size: number) {
  return {
    hash,
    rootHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    index,
    data: new Array(size).fill(0)
  };
}

// Clear module-level deduplication map between tests by re-importing
// (vi.resetModules would handle this but we also need to clear the mock)

describe("useChunkBlob", () => {
  beforeEach(() => {
    mockGetChunk.mockReset();
    // Default: return a valid chunk response
    mockGetChunk.mockImplementation(async (payload: { hash: string }) =>
      makeChunkResponse(payload.hash, 0, 900_000)
    );
  });

  // ---------------------------------------------------------------------------
  // Basic functionality
  // ---------------------------------------------------------------------------

  it("returns idle state when chunkMap is null", () => {
    const { result } = renderHook(() => useChunkBlob(null));

    expect(result.current.status).toBe("idle");
    expect(result.current.blobUrl).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.progress).toBe(0);
  });

  it("fetches chunks and produces a blob URL", async () => {
    const cm = makeChunkMap();

    const { result } = renderHook(() => useChunkBlob(cm));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.blobUrl).toBeTruthy();
    expect(result.current.progress).toBe(1);
    expect(mockGetChunk).toHaveBeenCalledTimes(1);
  });

  it("sets error state when a chunk is not found", async () => {
    mockGetChunk.mockResolvedValue(null);
    const cm = makeChunkMap();

    const { result } = renderHook(() => useChunkBlob(cm));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toContain("not found");
  });

  // ---------------------------------------------------------------------------
  // REGRESSION: deduplication prevents double GET_CHUNK on StrictMode re-fire
  // ---------------------------------------------------------------------------

  it("REGRESSION: concurrent renders for the same rootHash only send GET_CHUNK once", async () => {
    // This simulates what happens under React StrictMode: the effect fires twice
    // for the same rootHash. The module-level inflightBlobLoads Map should ensure
    // only one GET_CHUNK request is sent.
    const cm = makeChunkMap();

    // Render two hooks concurrently with the same chunkMap
    const { result: r1 } = renderHook(() => useChunkBlob(cm));
    const { result: r2 } = renderHook(() => useChunkBlob(cm));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // Both hooks should complete successfully
    expect(r1.current.status).toBe("ready");
    expect(r2.current.status).toBe("ready");

    // But getChunk should only have been called ONCE (deduplicated)
    expect(mockGetChunk).toHaveBeenCalledTimes(1);
  });

  it("different rootHashes are NOT deduplicated (independent fetches)", async () => {
    const cm1 = makeChunkMap({
      rootHash: "aaaa" + "00".repeat(28),
      chunks: ["hash-a"]
    });
    const cm2 = makeChunkMap({
      rootHash: "bbbb" + "00".repeat(28),
      chunks: ["hash-b"]
    });

    const { result: r1 } = renderHook(() => useChunkBlob(cm1));
    const { result: r2 } = renderHook(() => useChunkBlob(cm2));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(r1.current.status).toBe("ready");
    expect(r2.current.status).toBe("ready");

    // Two different rootHashes → two independent fetches
    expect(mockGetChunk).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------------------
  // Multi-chunk content
  // ---------------------------------------------------------------------------

  it("fetches all chunks for multi-chunk content", async () => {
    const cm = makeChunkMap({
      chunks: ["hash-0", "hash-1", "hash-2"],
      size: 3_000_000
    });

    mockGetChunk.mockImplementation(async (payload: { hash: string }) => {
      const index = parseInt(payload.hash.split("-")[1]);
      return makeChunkResponse(payload.hash, index, 1_000_000);
    });

    const { result } = renderHook(() => useChunkBlob(cm));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(result.current.status).toBe("ready");
    expect(mockGetChunk).toHaveBeenCalledTimes(3);
  });
});
