import { describe, expect, it } from "vitest";

import {
  TAG_NAME_MAX_LENGTH,
  normalizeTagName,
  validateTagName,
  assertValidTagName
} from "../tags/tag-validation";

describe("normalizeTagName", () => {
  it("trims whitespace and lowercases", () => {
    expect(normalizeTagName("  Música  ")).toBe("música");
  });

  it("collapses multiple internal spaces to one", () => {
    expect(normalizeTagName("rock   and   roll")).toBe("rock and roll");
  });

  it("handles already normalized input", () => {
    expect(normalizeTagName("jazz")).toBe("jazz");
  });
});

describe("validateTagName", () => {
  it("accepts valid simple tags", () => {
    expect(validateTagName("rock")).toEqual({ valid: true, normalized: "rock" });
    expect(validateTagName("música")).toEqual({ valid: true, normalized: "música" });
    expect(validateTagName("en-vivo")).toEqual({ valid: true, normalized: "en-vivo" });
    expect(validateTagName("lo_fi")).toEqual({ valid: true, normalized: "lo_fi" });
  });

  it("accepts single character tags", () => {
    expect(validateTagName("a")).toEqual({ valid: true, normalized: "a" });
    expect(validateTagName("5")).toEqual({ valid: true, normalized: "5" });
  });

  it("accepts tags with accented characters", () => {
    expect(validateTagName("electrónica")).toEqual({ valid: true, normalized: "electrónica" });
    expect(validateTagName("señal")).toEqual({ valid: true, normalized: "señal" });
    expect(validateTagName("ñ")).toEqual({ valid: true, normalized: "ñ" });
  });

  it("accepts two-character tags", () => {
    expect(validateTagName("ab")).toEqual({ valid: true, normalized: "ab" });
    expect(validateTagName("ño")).toEqual({ valid: true, normalized: "ño" });
  });

  it("rejects empty string", () => {
    const result = validateTagName("");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("empty");
  });

  it("rejects whitespace-only string", () => {
    const result = validateTagName("   ");
    expect(result.valid).toBe(false);
  });

  it("rejects tags exceeding max length", () => {
    const long = "a".repeat(TAG_NAME_MAX_LENGTH + 1);
    const result = validateTagName(long);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("maximum length");
  });

  it("accepts tag at exactly max length", () => {
    const exact = "a".repeat(TAG_NAME_MAX_LENGTH);
    expect(validateTagName(exact).valid).toBe(true);
  });

  it("rejects tags with special characters", () => {
    expect(validateTagName("rock!")).toMatchObject({ valid: false });
    expect(validateTagName("@music")).toMatchObject({ valid: false });
    expect(validateTagName("a#b")).toMatchObject({ valid: false });
    expect(validateTagName("test.tag")).toMatchObject({ valid: false });
  });

  it("rejects tags starting or ending with space/hyphen/underscore", () => {
    expect(validateTagName(" rock")).toMatchObject({ valid: true, normalized: "rock" });
    // After trimming, "-rock" starts with hyphen
    expect(validateTagName("-rock")).toMatchObject({ valid: false });
    expect(validateTagName("rock-")).toMatchObject({ valid: false });
    expect(validateTagName("_rock")).toMatchObject({ valid: false });
    expect(validateTagName("rock_")).toMatchObject({ valid: false });
  });

  it("normalizes before validation", () => {
    const result = validateTagName("  ROCK  ");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("rock");
  });
});

describe("assertValidTagName", () => {
  it("returns normalized name for valid tags", () => {
    expect(assertValidTagName("Rock")).toBe("rock");
  });

  it("throws for invalid tags", () => {
    expect(() => assertValidTagName("")).toThrow();
    expect(() => assertValidTagName("!!!")).toThrow();
  });
});
