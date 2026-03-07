import { describe, it, expect } from "vitest";
import { assertSafeMp4, MAX_SAFE_BYTES } from "../transport/mp4guard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an ArrayBuffer whose bytes 4-7 spell `boxType` (ASCII). */
function makeBoxBuffer(size: number, boxType: string): ArrayBuffer {
  const buf = new ArrayBuffer(size);
  if (size >= 8) {
    const view = new DataView(buf);
    for (let i = 0; i < 4; i++) {
      view.setUint8(4 + i, boxType.charCodeAt(i));
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("assertSafeMp4", () => {
  it("throws when buffer is smaller than 8 bytes", () => {
    const buf = new ArrayBuffer(4);
    expect(() => assertSafeMp4(buf)).toThrow("buffer too small");
  });

  it("passes for ftyp leading box", () => {
    expect(() => assertSafeMp4(makeBoxBuffer(64, "ftyp"))).not.toThrow();
  });

  it("passes for moov leading box", () => {
    expect(() => assertSafeMp4(makeBoxBuffer(64, "moov"))).not.toThrow();
  });

  it('throws for unknown leading box type "AAAA"', () => {
    expect(() => assertSafeMp4(makeBoxBuffer(64, "AAAA"))).toThrow(
      'unexpected leading ISO BMFF box type: "AAAA"'
    );
  });

  it("throws when buffer exceeds MAX_SAFE_BYTES", () => {
    expect(MAX_SAFE_BYTES).toBe(512 * 1024 * 1024);
    // Allocating 512 MiB + 1 in a unit test is impractical.
    // The size check fires before DataView creation, so a duck-typed object
    // with the right byteLength is sufficient to exercise the guard.
    const fakeBuf = { byteLength: MAX_SAFE_BYTES + 1 } as unknown as ArrayBuffer;
    expect(() => assertSafeMp4(fakeBuf)).toThrow("buffer too large");
  });

  it("passes for all recognised ISO BMFF box types", () => {
    const types = ["ftyp", "moov", "mdat", "free", "skip", "wide", "pdin", "uuid", "styp", "emsg"];
    for (const t of types) {
      expect(() => assertSafeMp4(makeBoxBuffer(16, t)), `box type "${t}" should pass`).not.toThrow();
    }
  });

  it("includes custom label in error messages", () => {
    const buf = new ArrayBuffer(4);
    expect(() => assertSafeMp4(buf, "my-caller")).toThrow("[my-caller]");
  });
});
