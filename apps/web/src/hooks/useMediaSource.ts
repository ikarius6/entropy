import { useState, useEffect, useRef } from "react";
import { createTransmuxer } from "@entropy/core";
import type { Transmuxer } from "@entropy/core";

interface UseMediaSourceOptions {
  mimeType: string;
  videoRef: React.RefObject<HTMLVideoElement>;
}

export function useMediaSource({ mimeType, videoRef }: UseMediaSourceOptions) {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);

  const queueRef = useRef<{ index: number; data: ArrayBuffer }[]>([]);
  const isAppendingRef = useRef(false);
  const nextExpectedIndexRef = useRef(0);

  // Transmuxer — created once per hook mount, reset on effect re-run
  const transmuxerRef = useRef<Transmuxer | null>(null);
  /** Effective MIME type after transmuxing init (may differ from prop) */
  const outputMimeTypeRef = useRef<string>(mimeType);
  /** Whether the transmuxer has been initialized with the first chunk */
  const transmuxerInitializedRef = useRef(false);
  /** Queue of chunks waiting for transmuxer init to complete */
  const pendingChunksRef = useRef<{ index: number; data: ArrayBuffer }[]>([]);

  useEffect(() => {
    if (!videoRef.current) return;

    try {
      if (!window.MediaSource) {
        throw new Error("MediaSource Extensions are not supported in this browser.");
      }

      // Create a fresh transmuxer for this stream
      transmuxerRef.current = createTransmuxer();
      transmuxerInitializedRef.current = false;
      pendingChunksRef.current = [];

      const mediaSource = new MediaSource();
      mediaSourceRef.current = mediaSource;

      const url = URL.createObjectURL(mediaSource);
      videoRef.current.src = url;

      mediaSource.addEventListener("sourceopen", () => {
        // We defer creating the SourceBuffer until the first chunk arrives so
        // we know the real outputMimeType after transmuxer.init().
        // Nothing to do here yet.
      });

      return () => {
        if (mediaSource.readyState === "open") {
          try { mediaSource.endOfStream(); } catch { /* ignore */ }
        }
        URL.revokeObjectURL(url);
        transmuxerRef.current?.reset();
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mimeType, videoRef]);

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  const processQueue = () => {
    if (
      !sourceBufferRef.current ||
      isAppendingRef.current ||
      queueRef.current.length === 0
    ) {
      return;
    }

    queueRef.current.sort((a, b) => a.index - b.index);

    const nextChunkIndex = queueRef.current.findIndex(
      (c) => c.index === nextExpectedIndexRef.current
    );

    if (nextChunkIndex !== -1) {
      const chunk = queueRef.current.splice(nextChunkIndex, 1)[0];

      try {
        isAppendingRef.current = true;
        sourceBufferRef.current.appendBuffer(chunk.data);
        nextExpectedIndexRef.current++;
      } catch (err) {
        isAppendingRef.current = false;
        setError(err instanceof Error ? err.message : String(err));
        console.error("Failed to append buffer:", err);
      }
    }
  };

  const enqueueTransmuxed = (index: number, data: ArrayBuffer) => {
    // Skip empty transmux results (segment not yet ready)
    if (data.byteLength === 0) return;
    queueRef.current.push({ index, data });
    processQueue();
  };

  /**
   * Initialize the SourceBuffer using the MIME type returned by the transmuxer.
   * Prepends the init segment (if any) as chunk -1 so it is always first.
   */
  const initializeSourceBuffer = (
    initSegment: ArrayBuffer,
    outputMimeType: string
  ) => {
    const mediaSource = mediaSourceRef.current;
    if (!mediaSource || mediaSource.readyState !== "open") return;

    try {
      if (!MediaSource.isTypeSupported(outputMimeType)) {
        throw new Error(`MIME type "${outputMimeType}" is not supported by MSE.`);
      }

      const sb = mediaSource.addSourceBuffer(outputMimeType);
      sourceBufferRef.current = sb;

      sb.addEventListener("updateend", () => {
        isAppendingRef.current = false;
        processQueue();
      });

      setIsReady(true);

      // Prepend init segment as index -1 (will be first due to sort)
      if (initSegment.byteLength > 0) {
        queueRef.current.push({ index: -1, data: initSegment });
        // Manually bump expected index so regular chunks start at 0
        nextExpectedIndexRef.current = -1;
      }

      processQueue();

      // Flush any chunks that arrived before init was ready
      for (const pending of pendingChunksRef.current) {
        enqueueTransmuxed(pending.index, pending.data);
      }
      pendingChunksRef.current = [];
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Append a raw chunk (as received from the chunk downloader).
   *
   * The first call triggers transmuxer initialization. Subsequent calls
   * transmux and enqueue the resulting fMP4 segment.
   */
  const appendChunk = async (index: number, data: ArrayBuffer) => {
    const transmuxer = transmuxerRef.current;
    if (!transmuxer) return;

    if (!transmuxerInitializedRef.current) {
      // Mark as initialized immediately to avoid double-init on concurrent calls
      transmuxerInitializedRef.current = true;

      try {
        const { initSegment, outputMimeType } = await transmuxer.init(
          data,
          mimeType
        );
        outputMimeTypeRef.current = outputMimeType;

        // Initialize the SourceBuffer now that we know the real MIME type
        initializeSourceBuffer(initSegment, outputMimeType);

        // The first chunk has already been fed to the transmuxer during init —
        // transmux it now (will be a no-op / pass-through in most cases)
        const segment = await transmuxer.transmux(data, index);
        enqueueTransmuxed(index, segment);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    // Buffer chunks that arrive before the SourceBuffer is ready
    if (!sourceBufferRef.current) {
      pendingChunksRef.current.push({ index, data });
      return;
    }

    try {
      const segment = await transmuxer.transmux(data, index);
      enqueueTransmuxed(index, segment);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const bufferedRanges = sourceBufferRef.current
    ? sourceBufferRef.current.buffered
    : null;

  return {
    isReady,
    error,
    appendChunk,
    bufferedRanges,
  };
}
