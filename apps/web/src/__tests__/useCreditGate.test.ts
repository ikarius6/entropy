import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock useCredits
// ---------------------------------------------------------------------------

const mockRefresh = vi.fn(async () => {});

let mockCreditsReturn: {
  summary: { balance: number; totalUploaded: number; totalDownloaded: number; ratio: number | null; entryCount: number } | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

vi.mock("../hooks/useCredits", () => ({
  useCredits: () => mockCreditsReturn
}));

// ---------------------------------------------------------------------------
// Mock useEntropyStore — controls the current user pubkey
// ---------------------------------------------------------------------------

let mockMyPubkey: string | null = null;

vi.mock("../stores/entropy-store", () => ({
  useEntropyStore: (selector: (s: { pubkey: string | null }) => unknown) =>
    selector({ pubkey: mockMyPubkey })
}));

// ---------------------------------------------------------------------------
// Mock checkLocalChunks bridge call
// ---------------------------------------------------------------------------

let mockCheckLocalResult: { total: number; local: number; localBytes: number } = { total: 0, local: 0, localBytes: 0 };
let mockCheckLocalShouldReject = false;

vi.mock("../lib/extension-bridge", () => ({
  checkLocalChunks: vi.fn(() =>
    mockCheckLocalShouldReject
      ? Promise.reject(new Error("bridge timeout"))
      : Promise.resolve(mockCheckLocalResult)
  )
}));

import { useCreditGate } from "../hooks/useCreditGate";

describe("useCreditGate", () => {
  beforeEach(() => {
    mockRefresh.mockClear();
    mockMyPubkey = null;
    mockCheckLocalShouldReject = false;
    mockCheckLocalResult = { total: 0, local: 0, localBytes: 0 };
    mockCreditsReturn = {
      summary: null,
      isLoading: true,
      error: null,
      refresh: mockRefresh
    };
  });

  // ---------------------------------------------------------------------------
  // Backward-compatible number overload
  // ---------------------------------------------------------------------------

  it("returns loading state when credits are still loading (number overload)", () => {
    const { result } = renderHook(() => useCreditGate(5000));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.allowed).toBe(false);
    expect(result.current.balance).toBe(0);
    expect(result.current.required).toBe(5000);
    expect(result.current.deficit).toBe(5000);
    expect(result.current.bypassReason).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Allowed — sufficient balance
  // ---------------------------------------------------------------------------

  it("allows download when balance >= content size", () => {
    mockCreditsReturn = {
      summary: { balance: 10000, totalUploaded: 10000, totalDownloaded: 0, ratio: null, entryCount: 1 },
      isLoading: false,
      error: null,
      refresh: mockRefresh
    };

    const { result } = renderHook(() => useCreditGate(5000));

    expect(result.current.allowed).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.balance).toBe(10000);
    expect(result.current.required).toBe(5000);
    expect(result.current.deficit).toBe(0);
    expect(result.current.bypassReason).toBeNull();
  });

  it("allows download when balance exactly equals content size", () => {
    mockCreditsReturn = {
      summary: { balance: 5000, totalUploaded: 5000, totalDownloaded: 0, ratio: null, entryCount: 1 },
      isLoading: false,
      error: null,
      refresh: mockRefresh
    };

    const { result } = renderHook(() => useCreditGate(5000));

    expect(result.current.allowed).toBe(true);
    expect(result.current.deficit).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Blocked — insufficient balance
  // ---------------------------------------------------------------------------

  it("blocks download when balance < content size", () => {
    mockCreditsReturn = {
      summary: { balance: 3000, totalUploaded: 5000, totalDownloaded: 2000, ratio: 2.5, entryCount: 2 },
      isLoading: false,
      error: null,
      refresh: mockRefresh
    };

    const { result } = renderHook(() => useCreditGate(5000));

    expect(result.current.allowed).toBe(false);
    expect(result.current.balance).toBe(3000);
    expect(result.current.required).toBe(5000);
    expect(result.current.deficit).toBe(2000);
  });

  it("blocks download when balance is zero", () => {
    mockCreditsReturn = {
      summary: { balance: 0, totalUploaded: 1000, totalDownloaded: 1000, ratio: 1, entryCount: 2 },
      isLoading: false,
      error: null,
      refresh: mockRefresh
    };

    const { result } = renderHook(() => useCreditGate(1));

    expect(result.current.allowed).toBe(false);
    expect(result.current.deficit).toBe(1);
  });

  it("blocks download when balance is negative", () => {
    mockCreditsReturn = {
      summary: { balance: -500, totalUploaded: 100, totalDownloaded: 600, ratio: 0.167, entryCount: 2 },
      isLoading: false,
      error: null,
      refresh: mockRefresh
    };

    const { result } = renderHook(() => useCreditGate(1000));

    expect(result.current.allowed).toBe(false);
    expect(result.current.balance).toBe(-500);
    expect(result.current.deficit).toBe(1500);
  });

  // ---------------------------------------------------------------------------
  // Zero-size content
  // ---------------------------------------------------------------------------

  it("allows zero-size content (non-media) even with zero balance", () => {
    mockCreditsReturn = {
      summary: { balance: 0, totalUploaded: 0, totalDownloaded: 0, ratio: null, entryCount: 0 },
      isLoading: false,
      error: null,
      refresh: mockRefresh
    };

    const { result } = renderHook(() => useCreditGate(0));

    expect(result.current.allowed).toBe(true);
    expect(result.current.deficit).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Error state
  // ---------------------------------------------------------------------------

  it("propagates error from useCredits", () => {
    mockCreditsReturn = {
      summary: null,
      isLoading: false,
      error: "Extension not connected",
      refresh: mockRefresh
    };

    const { result } = renderHook(() => useCreditGate(5000));

    expect(result.current.error).toBe("Extension not connected");
    expect(result.current.allowed).toBe(false);
    expect(result.current.isLoading).toBe(true); // no summary → treated as loading
  });

  // ---------------------------------------------------------------------------
  // Refresh passthrough
  // ---------------------------------------------------------------------------

  it("exposes refresh function from useCredits", () => {
    mockCreditsReturn = {
      summary: { balance: 100, totalUploaded: 100, totalDownloaded: 0, ratio: null, entryCount: 1 },
      isLoading: false,
      error: null,
      refresh: mockRefresh
    };

    const { result } = renderHook(() => useCreditGate(50));

    expect(result.current.refresh).toBe(mockRefresh);
  });

  // ---------------------------------------------------------------------------
  // Content size changes
  // ---------------------------------------------------------------------------

  it("re-evaluates gate when content size changes", () => {
    mockCreditsReturn = {
      summary: { balance: 5000, totalUploaded: 5000, totalDownloaded: 0, ratio: null, entryCount: 1 },
      isLoading: false,
      error: null,
      refresh: mockRefresh
    };

    const { result, rerender } = renderHook(
      ({ size }) => useCreditGate(size),
      { initialProps: { size: 3000 } }
    );

    expect(result.current.allowed).toBe(true);
    expect(result.current.deficit).toBe(0);

    rerender({ size: 8000 });

    expect(result.current.allowed).toBe(false);
    expect(result.current.deficit).toBe(3000);
  });

  // ---------------------------------------------------------------------------
  // Owner bypass — own content is always free
  // ---------------------------------------------------------------------------

  it("bypasses gate for own content even with zero balance", () => {
    mockMyPubkey = "my-pubkey-abc";
    mockCreditsReturn = {
      summary: { balance: 0, totalUploaded: 0, totalDownloaded: 0, ratio: null, entryCount: 0 },
      isLoading: false,
      error: null,
      refresh: mockRefresh
    };

    const { result } = renderHook(() =>
      useCreditGate({ contentSizeBytes: 10_000_000, authorPubkey: "my-pubkey-abc" })
    );

    expect(result.current.allowed).toBe(true);
    expect(result.current.bypassReason).toBe("owner");
    expect(result.current.deficit).toBe(0);
  });

  it("does NOT bypass for different author pubkey", () => {
    mockMyPubkey = "my-pubkey-abc";
    mockCreditsReturn = {
      summary: { balance: 0, totalUploaded: 0, totalDownloaded: 0, ratio: null, entryCount: 0 },
      isLoading: false,
      error: null,
      refresh: mockRefresh
    };

    const { result } = renderHook(() =>
      useCreditGate({ contentSizeBytes: 5000, authorPubkey: "other-pubkey-xyz" })
    );

    expect(result.current.allowed).toBe(false);
    expect(result.current.bypassReason).toBeNull();
  });

  it("does NOT bypass when myPubkey is null (not logged in)", () => {
    mockMyPubkey = null;
    mockCreditsReturn = {
      summary: { balance: 0, totalUploaded: 0, totalDownloaded: 0, ratio: null, entryCount: 0 },
      isLoading: false,
      error: null,
      refresh: mockRefresh
    };

    const { result } = renderHook(() =>
      useCreditGate({ contentSizeBytes: 5000, authorPubkey: "some-pubkey" })
    );

    expect(result.current.allowed).toBe(false);
    expect(result.current.bypassReason).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Local bypass — all chunks cached locally
  // ---------------------------------------------------------------------------

  it("bypasses gate when all chunks are locally cached", async () => {
    mockMyPubkey = "different-user";
    mockCheckLocalResult = { total: 3, local: 3, localBytes: 15000 };
    mockCreditsReturn = {
      summary: { balance: 0, totalUploaded: 0, totalDownloaded: 0, ratio: null, entryCount: 0 },
      isLoading: false,
      error: null,
      refresh: mockRefresh
    };

    const { result } = renderHook(() =>
      useCreditGate({
        contentSizeBytes: 15000,
        authorPubkey: "other-author",
        chunkHashes: ["hash-a", "hash-b", "hash-c"]
      })
    );

    // Wait for async checkLocalChunks to resolve
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.allowed).toBe(true);
    expect(result.current.bypassReason).toBe("local");
  });

  it("does NOT bypass when only some chunks are local", async () => {
    mockMyPubkey = "different-user";
    mockCheckLocalResult = { total: 3, local: 1, localBytes: 5000 };
    mockCreditsReturn = {
      summary: { balance: 0, totalUploaded: 0, totalDownloaded: 0, ratio: null, entryCount: 0 },
      isLoading: false,
      error: null,
      refresh: mockRefresh
    };

    const { result } = renderHook(() =>
      useCreditGate({
        contentSizeBytes: 15000,
        authorPubkey: "other-author",
        chunkHashes: ["hash-a", "hash-b", "hash-c"]
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.allowed).toBe(false);
    expect(result.current.bypassReason).toBeNull();
  });

  it("falls back to credit check when local check fails", async () => {
    mockMyPubkey = "different-user";
    mockCheckLocalShouldReject = true;
    mockCreditsReturn = {
      summary: { balance: 20000, totalUploaded: 20000, totalDownloaded: 0, ratio: null, entryCount: 1 },
      isLoading: false,
      error: null,
      refresh: mockRefresh
    };

    const { result } = renderHook(() =>
      useCreditGate({
        contentSizeBytes: 15000,
        authorPubkey: "other-author",
        chunkHashes: ["hash-a", "hash-b"]
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Falls back to balance check — 20000 >= 15000
    expect(result.current.allowed).toBe(true);
    expect(result.current.bypassReason).toBeNull();
  });
});
