import { createFile } from "mp4box";
import type { ISOFile } from "mp4box";
import { assertSafeMp4, MAX_SAFE_BYTES } from "./mp4guard";

/**
 * A Transmuxer converts raw video chunks to fragmented MP4 (fMP4) segments
 * that MSE SourceBuffer can consume.
 *
 * If the original MIME type is already supported by MSE, the transmuxer acts as
 * a transparent pass-through — no conversion overhead.
 */
export interface Transmuxer {
  /**
   * Initialize the transmuxer with the first chunk of the stream.
   *
   * Returns the fMP4 init segment (ftyp + moov boxes) that must be appended
   * to the SourceBuffer before any media segments, and the MIME type string to
   * use when calling `mediaSource.addSourceBuffer()`.
   *
   * If the original MIME type is already MSE-compatible, `initSegment` will be
   * empty (0 bytes) and `outputMimeType` will equal the original value.
   */
  init(
    firstChunk: ArrayBuffer,
    mimeType: string
  ): Promise<{ initSegment: ArrayBuffer; outputMimeType: string }>;

  /**
   * Transmux one chunk and return an fMP4 media segment (moof + mdat).
   *
   * In pass-through mode returns the original data unchanged.
   */
  transmux(chunk: ArrayBuffer, index: number): Promise<ArrayBuffer>;

  /** Reset internal state so the transmuxer can be reused for a new stream. */
  reset(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isMseSupported(mimeType: string): boolean {
  // MediaSource may not exist in Node / test environments
  if (typeof MediaSource === "undefined") return false;
  return MediaSource.isTypeSupported(mimeType);
}

/**
 * Feed an ArrayBuffer into an mp4box ISOFile and flush, returning the file
 * for further inspection / segment extraction.
 */
function feedMp4box(mp4: ISOFile, data: ArrayBuffer, fileStart: number): void {
  // mp4box requires a `fileStart` property on the buffer
  const buf = data as ArrayBuffer & { fileStart: number };
  buf.fileStart = fileStart;
  mp4.appendBuffer(buf);
  mp4.flush();
}

// ---------------------------------------------------------------------------
// Transmuxer implementation
// ---------------------------------------------------------------------------

interface TransmuxerState {
  passThrough: boolean;
  mp4: ISOFile | null;
  outputMimeType: string;
  /** Accumulated byte offset across all chunks received so far */
  byteOffset: number;
  /** Resolved once moov is available */
  moovReady: Promise<void>;
  resolveMoov: () => void;
}

function createState(): TransmuxerState {
  let resolveMoov!: () => void;
  const moovReady = new Promise<void>((res) => {
    resolveMoov = res;
  });
  return {
    passThrough: false,
    mp4: null,
    outputMimeType: "",
    byteOffset: 0,
    moovReady,
    resolveMoov,
  };
}

export function createTransmuxer(): Transmuxer {
  let state: TransmuxerState = createState();

  // ---- init ----------------------------------------------------------------

  async function init(
    firstChunk: ArrayBuffer,
    mimeType: string
  ): Promise<{ initSegment: ArrayBuffer; outputMimeType: string }> {
    // Pass-through: browser already supports this MIME
    if (isMseSupported(mimeType)) {
      state.passThrough = true;
      state.outputMimeType = mimeType;
      return {
        initSegment: new ArrayBuffer(0),
        outputMimeType: mimeType,
      };
    }

    // Guard: validate the first chunk before handing untrusted bytes to mp4box.
    // If the assertion fails (wrong magic bytes, oversized buffer, etc.) we fall
    // back to pass-through mode so playback can still attempt to proceed.
    try {
      assertSafeMp4(firstChunk, "transmuxer");
    } catch (guardErr) {
      console.warn("[transmuxer] mp4guard rejected first chunk, using pass-through:", guardErr);
      state.passThrough = true;
      state.outputMimeType = mimeType;
      return { initSegment: new ArrayBuffer(0), outputMimeType: mimeType };
    }

    // Transmuxing path: we'll remux to fMP4
    const mp4 = createFile();
    state.mp4 = mp4;

    // We ask mp4box to produce fragmented segments
    mp4.onReady = (info) => {
      try {
        // Set up extraction for all tracks
        for (const track of info.tracks) {
          mp4.setExtractionOptions(track.id, undefined, { nbSamples: 1 });
        }
        mp4.start();
        state.resolveMoov();
      } catch {
        state.resolveMoov();
      }
    };

    // Feed the first chunk so mp4box can parse the moov box
    feedMp4box(mp4, firstChunk, 0);
    state.byteOffset = firstChunk.byteLength;

    // Wait for moov to be parsed (or timeout gracefully)
    await Promise.race([
      state.moovReady,
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error("[transmuxer] moov parse timeout")),
          5000
        )
      ),
    ]);

    // Generate the fMP4 init segment by writing the moov back out.
    // mp4box exposes `getBuffer()` on the internal DataStream after
    // `generateInitSegment()` is called per track.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internalMp4 = mp4 as any;
    let initBuffer: ArrayBuffer = new ArrayBuffer(0);
    try {
      if (typeof internalMp4.generateInitSegment === "function") {
        // mp4box >= 0.5.x API: generateInitSegment(tracks)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const info = (internalMp4.moovBox ?? internalMp4.moov) as any;
        const traks = info?.traks ?? [];
        if (traks.length > 0) {
          initBuffer = internalMp4.generateInitSegment(traks) as ArrayBuffer;
        }
      }
    } catch {
      // If we can't extract init segment, fall back to pass-through
      state.passThrough = true;
      state.outputMimeType = mimeType;
      return { initSegment: new ArrayBuffer(0), outputMimeType: mimeType };
    }

    // Best-effort codec string for fMP4
    state.outputMimeType = 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';

    return {
      initSegment: initBuffer,
      outputMimeType: state.outputMimeType,
    };
  }

  // ---- transmux ------------------------------------------------------------

  async function transmux(
    chunk: ArrayBuffer,
    _index: number
  ): Promise<ArrayBuffer> {
    if (state.passThrough || !state.mp4) {
      // Pass-through: return data unchanged
      return chunk;
    }

    // Guard: reject oversized individual chunks to prevent heap exhaustion.
    if (chunk.byteLength > MAX_SAFE_BYTES) {
      console.warn(
        `[transmuxer] chunk too large (${chunk.byteLength} bytes), dropping`
      );
      return new ArrayBuffer(0);
    }

    return new Promise<ArrayBuffer>((resolve) => {
      const segments: ArrayBuffer[] = [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (state.mp4 as any).onSegment = (
        _id: number,
        _user: unknown,
        buffer: ArrayBuffer
      ) => {
        segments.push(buffer);
      };

      feedMp4box(state.mp4!, chunk, state.byteOffset);
      state.byteOffset += chunk.byteLength;

      // Collect all segments produced synchronously after flush
      if (segments.length === 0) {
        // No segment yet — return empty buffer; caller should handle buffering
        resolve(new ArrayBuffer(0));
      } else if (segments.length === 1) {
        resolve(segments[0]);
      } else {
        // Merge multiple segments
        const total = segments.reduce((acc, s) => acc + s.byteLength, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const seg of segments) {
          merged.set(new Uint8Array(seg), offset);
          offset += seg.byteLength;
        }
        resolve(merged.buffer);
      }
    });
  }

  // ---- reset ---------------------------------------------------------------

  function reset(): void {
    state = createState();
  }

  return { init, transmux, reset };
}
