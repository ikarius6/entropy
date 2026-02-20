import { useState, useEffect, useRef } from "react";

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

  useEffect(() => {
    if (!videoRef.current) return;

    try {
      // Check if MediaSource is supported
      if (!window.MediaSource) {
        throw new Error("MediaSource Extensions are not supported in this browser.");
      }

      const mediaSource = new MediaSource();
      mediaSourceRef.current = mediaSource;

      const url = URL.createObjectURL(mediaSource);
      videoRef.current.src = url;

      mediaSource.addEventListener("sourceopen", () => {
        try {
          if (!MediaSource.isTypeSupported(mimeType)) {
            throw new Error(`MIME type ${mimeType} is not supported.`);
          }

          const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
          sourceBufferRef.current = sourceBuffer;

          sourceBuffer.addEventListener("updateend", () => {
            isAppendingRef.current = false;
            processQueue();
          });

          setIsReady(true);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });

      return () => {
        if (mediaSource.readyState === "open") {
          mediaSource.endOfStream();
        }
        URL.revokeObjectURL(url);
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [mimeType, videoRef]);

  const processQueue = () => {
    if (!sourceBufferRef.current || isAppendingRef.current || queueRef.current.length === 0) {
      return;
    }

    // Sort queue by index to ensure order
    queueRef.current.sort((a, b) => a.index - b.index);

    // Get the next chunk if it matches what we expect
    const nextChunkIndex = queueRef.current.findIndex(c => c.index === nextExpectedIndexRef.current);
    
    if (nextChunkIndex !== -1) {
      const chunk = queueRef.current.splice(nextChunkIndex, 1)[0];
      
      try {
        isAppendingRef.current = true;
        sourceBufferRef.current.appendBuffer(chunk.data);
        nextExpectedIndexRef.current++;
      } catch (err) {
        isAppendingRef.current = false;
        setError(err instanceof Error ? err.message : String(err));
        // Put it back on error? For MSE usually an error means we need to reset
        console.error("Failed to append buffer:", err);
      }
    }
  };

  const appendChunk = (index: number, data: ArrayBuffer) => {
    queueRef.current.push({ index, data });
    processQueue();
  };

  const bufferedRanges = sourceBufferRef.current ? sourceBufferRef.current.buffered : null;

  return {
    isReady,
    error,
    appendChunk,
    bufferedRanges,
  };
}
