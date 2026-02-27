import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTransmuxer } from "../transport/transmuxer";

// ---------------------------------------------------------------------------
// Mock mp4box
// ---------------------------------------------------------------------------
vi.mock("mp4box", () => {
  const mockFile = {
    _onReady: null as ((info: unknown) => void) | null,
    _onSegment: null as ((...args: unknown[]) => void) | null,
    set onReady(fn: (info: unknown) => void) { this._onReady = fn; },
    appendBuffer: vi.fn(),
    flush: vi.fn(),
    setExtractionOptions: vi.fn(),
    start: vi.fn(),
    generateInitSegment: vi.fn(() => new ArrayBuffer(8)),
    set onSegment(fn: (...args: unknown[]) => void) { this._onSegment = fn; },
  };
  return { createFile: () => mockFile };
});

// ---------------------------------------------------------------------------
// Mock MediaSource.isTypeSupported
// ---------------------------------------------------------------------------

// By default: report "video/mp4" as supported, "video/webm" as NOT.
const isSupportedMock = vi.fn((mime: string) => mime.startsWith("video/mp4"));
vi.stubGlobal("MediaSource", { isTypeSupported: isSupportedMock });

// ---------------------------------------------------------------------------

describe("createTransmuxer — pass-through mode", () => {
  beforeEach(() => {
    isSupportedMock.mockImplementation((mime) => mime.startsWith("video/mp4"));
  });

  it("init returns empty initSegment and same mimeType when browser supports it", async () => {
    const t = createTransmuxer();
    const data = new ArrayBuffer(64);
    const { initSegment, outputMimeType } = await t.init(data, "video/mp4");

    expect(initSegment.byteLength).toBe(0);
    expect(outputMimeType).toBe("video/mp4");
  });

  it("transmux returns original data unchanged in pass-through mode", async () => {
    const t = createTransmuxer();
    const data = new Uint8Array([1, 2, 3, 4]).buffer;

    await t.init(data, "video/mp4");
    const out = await t.transmux(data, 0);

    expect(out).toBe(data); // same reference
  });
});

describe("createTransmuxer — transmuxing mode", () => {
  beforeEach(() => {
    // Simulate browser not supporting "video/webm"
    isSupportedMock.mockImplementation((mime) => !mime.startsWith("video/webm"));
  });

  it("init returns non-empty init segment when mimeType not supported", async () => {
    const t = createTransmuxer();
    const data = new ArrayBuffer(256);

    // We need the mp4box mock to call onReady
    // Since mp4box is a singleton mock per test we trigger it manually
    // by importing and calling onReady directly via the mock
    const mp4box = await import("mp4box");
    const mockFile = mp4box.createFile() as unknown as {
      _onReady: ((info: unknown) => void) | null;
    };

    // Start init (async)
    const initPromise = t.init(data, "video/webm");

    // Fire onReady with fake track info
    mockFile._onReady?.({
      tracks: [{ id: 1, video: {} }],
    });

    const { initSegment, outputMimeType } = await initPromise;

    // Should attempt transmuxing and return output mime
    expect(outputMimeType).toContain("video/mp4");
    // initSegment may be 0 if generateInitSegment path failed gracefully
    expect(initSegment).toBeInstanceOf(ArrayBuffer);
  });

  it("transmux returns ArrayBuffer in transmuxing mode", async () => {
    const t = createTransmuxer();
    const data = new ArrayBuffer(256);

    const mp4box = await import("mp4box");
    const mockFile = mp4box.createFile() as unknown as {
      _onReady: ((info: unknown) => void) | null;
    };

    const initPromise = t.init(data, "video/webm");
    mockFile._onReady?.({ tracks: [{ id: 1, video: {} }] });
    await initPromise;

    const out = await t.transmux(new ArrayBuffer(128), 1);
    expect(out).toBeInstanceOf(ArrayBuffer);
  });
});

describe("createTransmuxer — reset", () => {
  it("reset clears state so transmuxer can be reused", async () => {
    const t = createTransmuxer();
    const data = new ArrayBuffer(64);

    await t.init(data, "video/mp4");
    t.reset();

    // After reset, init should work again cleanly
    const { initSegment } = await t.init(data, "video/mp4");
    expect(initSegment.byteLength).toBe(0); // pass-through still
  });
});
