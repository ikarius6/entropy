import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock useEntropyStore — controls pubkey, relayPool, relayUrls
// ---------------------------------------------------------------------------

type EventCallback = (event: {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
  sig: string;
}) => void;

let mockPubkey: string | null = null;
let mockRelayUrls: string[] = [];
const mockUnsubscribe = vi.fn();
let mockSubscribeCallback: EventCallback | null = null;

const mockSubscribe = vi.fn(
  (
    _filters: unknown[],
    onEvent: EventCallback,
    _onEose?: () => void
  ) => {
    mockSubscribeCallback = onEvent;
    return { id: "test-sub", unsubscribe: mockUnsubscribe };
  }
);

const mockRelayPool = {
  subscribe: mockSubscribe,
  publish: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock("../stores/entropy-store", () => ({
  useEntropyStore: () => ({
    pubkey: mockPubkey,
    relayPool: mockRelayUrls.length > 0 ? mockRelayPool : null,
    relayUrls: mockRelayUrls,
  }),
}));

import { useContentTags } from "../hooks/useContentTags";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTagVoteEvent(
  pubkey: string,
  rootHash: string,
  tagName: string,
  createdAt = Math.floor(Date.now() / 1000)
) {
  return {
    id: `evt-${pubkey}-${tagName}`,
    pubkey,
    kind: 37001,
    created_at: createdAt,
    content: "",
    tags: [
      ["d", rootHash],
      ["t", "entropy"],
      ["x-hash", rootHash],
      ["entropy-tag", tagName],
    ],
    sig: "fake-sig",
  };
}

function emitEvent(
  pubkey: string,
  rootHash: string,
  tagName: string,
  createdAt?: number
) {
  if (!mockSubscribeCallback) throw new Error("No subscription active");
  act(() => {
    mockSubscribeCallback!(makeTagVoteEvent(pubkey, rootHash, tagName, createdAt));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useContentTags", () => {
  beforeEach(() => {
    mockPubkey = "my-pubkey";
    mockRelayUrls = ["wss://relay.test"];
    mockSubscribeCallback = null;
    mockSubscribe.mockClear();
    mockUnsubscribe.mockClear();
  });

  // ── Basic subscription ────────────────────────────────────────────

  it("returns empty state when rootHash is null", () => {
    const { result } = renderHook(() => useContentTags(null));

    expect(result.current.tags).toEqual([]);
    expect(result.current.userTagged).toBe(false);
    expect(result.current.userTag).toBeNull();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it("subscribes to kind:37001 with #d filter for the rootHash", () => {
    renderHook(() => useContentTags("root-abc"));

    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    const filters = mockSubscribe.mock.calls[0][0];
    expect(filters).toEqual([
      { kinds: [37001], "#d": ["root-abc"], limit: 200 },
    ]);
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useContentTags("root-abc"));

    expect(mockUnsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  // ── Tag aggregation ───────────────────────────────────────────────

  it("aggregates a single tag vote", () => {
    const { result } = renderHook(() => useContentTags("root-abc"));

    emitEvent("peer-1", "root-abc", "music");

    expect(result.current.tags).toHaveLength(1);
    expect(result.current.tags[0].name).toBe("music");
    expect(result.current.tags[0].counter).toBe(1);
  });

  it("aggregates multiple voters for the same tag", () => {
    const { result } = renderHook(() => useContentTags("root-abc"));

    emitEvent("peer-1", "root-abc", "music");
    emitEvent("peer-2", "root-abc", "music");
    emitEvent("peer-3", "root-abc", "music");

    expect(result.current.tags).toHaveLength(1);
    expect(result.current.tags[0].name).toBe("music");
    expect(result.current.tags[0].counter).toBe(3);
  });

  it("aggregates different tags separately", () => {
    const { result } = renderHook(() => useContentTags("root-abc"));

    emitEvent("peer-1", "root-abc", "music");
    emitEvent("peer-2", "root-abc", "electronic");
    emitEvent("peer-3", "root-abc", "music");

    expect(result.current.tags).toHaveLength(2);

    const music = result.current.tags.find((t) => t.name === "music");
    const electronic = result.current.tags.find((t) => t.name === "electronic");

    expect(music?.counter).toBe(2);
    expect(electronic?.counter).toBe(1);
  });

  // ── Deduplication (parameterized replaceable) ─────────────────────

  it("keeps only the latest vote per pubkey (replaceable dedup)", () => {
    const { result } = renderHook(() => useContentTags("root-abc"));

    // Same peer votes twice — second vote replaces first
    emitEvent("peer-1", "root-abc", "music");
    emitEvent("peer-1", "root-abc", "electronic");

    expect(result.current.tags).toHaveLength(1);
    expect(result.current.tags[0].name).toBe("electronic");
    expect(result.current.tags[0].counter).toBe(1);
  });

  // ── User detection ────────────────────────────────────────────────

  it("detects when the current user has tagged", () => {
    const { result } = renderHook(() => useContentTags("root-abc"));

    emitEvent("my-pubkey", "root-abc", "lo-fi");

    expect(result.current.userTagged).toBe(true);
    expect(result.current.userTag).toBe("lo-fi");
  });

  it("reports userTagged=false when only other peers tagged", () => {
    const { result } = renderHook(() => useContentTags("root-abc"));

    emitEvent("peer-1", "root-abc", "music");
    emitEvent("peer-2", "root-abc", "electronic");

    expect(result.current.userTagged).toBe(false);
    expect(result.current.userTag).toBeNull();
  });

  it("updates userTag when user changes their vote (replaceable)", () => {
    const { result } = renderHook(() => useContentTags("root-abc"));

    emitEvent("my-pubkey", "root-abc", "music");
    expect(result.current.userTag).toBe("music");

    emitEvent("my-pubkey", "root-abc", "ambient");
    expect(result.current.userTag).toBe("ambient");
  });

  // ── Malformed events ──────────────────────────────────────────────

  it("skips events without entropy-tag", () => {
    const { result } = renderHook(() => useContentTags("root-abc"));

    // Emit a malformed event with no entropy-tag
    act(() => {
      mockSubscribeCallback!({
        id: "bad-event",
        pubkey: "peer-1",
        kind: 37001,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: [
          ["d", "root-abc"],
          ["t", "entropy"],
        ],
        sig: "fake",
      });
    });

    expect(result.current.tags).toEqual([]);
  });

  it("skips events missing the d-tag entirely", () => {
    const { result } = renderHook(() => useContentTags("root-abc"));

    act(() => {
      mockSubscribeCallback!({
        id: "bad-event-2",
        pubkey: "peer-1",
        kind: 37001,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: [["entropy-tag", "music"]],
        sig: "fake",
      });
    });

    // Should be skipped (parseTagVoteTags throws → caught)
    expect(result.current.tags).toEqual([]);
  });

  // ── No relay pool ─────────────────────────────────────────────────

  it("does not subscribe when relayPool is null", () => {
    mockRelayUrls = [];

    const { result } = renderHook(() => useContentTags("root-abc"));

    expect(mockSubscribe).not.toHaveBeenCalled();
    expect(result.current.tags).toEqual([]);
  });

  // ── Re-subscription on rootHash change ────────────────────────────

  it("resets and re-subscribes when rootHash changes", () => {
    const { result, rerender } = renderHook(
      ({ hash }: { hash: string | null }) => useContentTags(hash),
      { initialProps: { hash: "root-abc" } }
    );

    emitEvent("peer-1", "root-abc", "music");
    expect(result.current.tags).toHaveLength(1);

    // Change rootHash — should reset
    rerender({ hash: "root-xyz" });

    expect(result.current.tags).toEqual([]);
    expect(mockUnsubscribe).toHaveBeenCalled();
    // New subscription started
    expect(mockSubscribe).toHaveBeenCalledTimes(2);
  });
});
