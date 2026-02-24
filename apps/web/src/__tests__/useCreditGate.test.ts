import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock useCredits — we control what the hook returns so we can test
// useCreditGate logic in isolation without the extension bridge.
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

import { useCreditGate } from "../hooks/useCreditGate";

describe("useCreditGate", () => {
  beforeEach(() => {
    mockRefresh.mockClear();
    mockCreditsReturn = {
      summary: null,
      isLoading: true,
      error: null,
      refresh: mockRefresh
    };
  });

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  it("returns loading state when credits are still loading", () => {
    mockCreditsReturn = {
      summary: null,
      isLoading: true,
      error: null,
      refresh: mockRefresh
    };

    const { result } = renderHook(() => useCreditGate(5000));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.allowed).toBe(false);
    expect(result.current.balance).toBe(0);
    expect(result.current.required).toBe(5000);
    expect(result.current.deficit).toBe(5000);
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

    // Increase content size beyond balance
    rerender({ size: 8000 });

    expect(result.current.allowed).toBe(false);
    expect(result.current.deficit).toBe(3000);
  });
});
