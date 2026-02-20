import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUploadPipeline } from "../hooks/useUploadPipeline";

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

  it("should transition states during upload (mocked)", async () => {
    const { result } = renderHook(() => useUploadPipeline());
    const file = new File(["test data"], "test.txt", { type: "text/plain" });

    // Start the upload
    let promise: Promise<void>;
    await act(async () => {
      promise = result.current.start(file, "Test Title", "Test Desc");
      await new Promise(r => setTimeout(r, 600)); // chunking
      await new Promise(r => setTimeout(r, 600)); // hashing
      await new Promise(r => setTimeout(r, 2500)); // storing
      await new Promise(r => setTimeout(r, 600)); // delegating
      await new Promise(r => setTimeout(r, 600)); // publishing
    });

    expect(result.current.progress.stage).toBe("done");
    expect(result.current.progress.error).toBeNull();
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
