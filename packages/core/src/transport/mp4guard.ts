/**
 * Lightweight pre-validation for ArrayBuffers that are about to be fed to
 * mp4box. Guards against two cheap attack vectors that don't require
 * exploiting parser internals:
 *
 *  1. Non-MP4 payloads (e.g. HTML, executables) passed as video — rejected by
 *     checking the leading ISO BMFF box type.
 *  2. Heap-exhaustion via oversized buffers — rejected by a hard size cap.
 *
 * If either check fails this function throws immediately, before mp4box sees a
 * single byte, so the callers' existing catch/fallback paths handle the error.
 */

/** Maximum single-buffer size accepted by the guard (512 MiB). */
export const MAX_SAFE_BYTES = 512 * 1024 * 1024;

/**
 * Valid leading ISO BMFF / MPEG-4 box types.
 *
 * A conformant MP4 file begins with one of these 4-byte ASCII box types
 * (at offset 4 inside the buffer, after the 4-byte box-size field).
 *
 * `styp` and `emsg` are added for fragmented / DASH streams.
 */
const ALLOWED_BOX_TYPES = new Set([
  "ftyp", // File Type Box — most common first box
  "moov", // Movie Box — full-file MP4
  "mdat", // Media Data Box — rare as first box but valid
  "free", // Free Space Box
  "skip", // Skip Box
  "wide", // Wide Box (QuickTime extension)
  "pdin", // Progressive Download Info
  "uuid", // Extended Box
  "styp", // Segment Type Box (fMP4/DASH)
  "emsg", // Event Message Box (DASH)
]);

/**
 * Assert that `buf` looks like a safe, parseable ISO BMFF buffer.
 *
 * Throws `Error` if:
 * - `buf.byteLength > MAX_SAFE_BYTES`
 * - `buf.byteLength < 8` (cannot read a complete box header)
 * - The 4-byte box-type field at offset 4 is not in `ALLOWED_BOX_TYPES`
 *
 * @param buf - The buffer to validate.
 * @param label - Optional label for error messages (e.g. `"keyframe-aligner"`).
 */
export function assertSafeMp4(buf: ArrayBuffer, label = "mp4guard"): void {
  if (buf.byteLength > MAX_SAFE_BYTES) {
    throw new Error(
      `[${label}] buffer too large: ${buf.byteLength} bytes (max ${MAX_SAFE_BYTES})`
    );
  }
  if (buf.byteLength < 8) {
    throw new Error(
      `[${label}] buffer too small to contain a valid ISO BMFF box header (${buf.byteLength} bytes)`
    );
  }

  const view = new DataView(buf);
  const boxType = String.fromCharCode(
    view.getUint8(4),
    view.getUint8(5),
    view.getUint8(6),
    view.getUint8(7)
  );

  if (!ALLOWED_BOX_TYPES.has(boxType)) {
    throw new Error(
      `[${label}] unexpected leading ISO BMFF box type: "${boxType}" — not a recognised MP4 container`
    );
  }
}
