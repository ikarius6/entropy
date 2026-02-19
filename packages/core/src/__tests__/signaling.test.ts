import { describe, expect, it } from "vitest";

import {
  ENTROPY_SIGNALING_KIND_MAX,
  ENTROPY_SIGNALING_KIND_MIN,
  isEntropySignalingKind
} from "../nostr/signaling";

describe("nostr signaling kinds", () => {
  it("accepts kind values inside the Entropy signaling range", () => {
    expect(isEntropySignalingKind(ENTROPY_SIGNALING_KIND_MIN)).toBe(true);
    expect(isEntropySignalingKind(27182)).toBe(true);
    expect(isEntropySignalingKind(ENTROPY_SIGNALING_KIND_MAX)).toBe(true);
  });

  it("rejects kind values outside the Entropy signaling range", () => {
    expect(isEntropySignalingKind(ENTROPY_SIGNALING_KIND_MIN - 1)).toBe(false);
    expect(isEntropySignalingKind(ENTROPY_SIGNALING_KIND_MAX + 1)).toBe(false);
  });
});
