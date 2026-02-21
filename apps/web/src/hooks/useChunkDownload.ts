import { useState, useEffect, useRef } from "react";
import {
  type EntropyChunkMap,
  ChunkDownloader,
  PeerManager,
  SignalingChannel,
} from "@entropy/core";
import { useEntropyStore } from "../stores/entropy-store";

export function useChunkDownload(chunkMap: EntropyChunkMap | null) {
  const { pubkey, relayPool } = useEntropyStore();

  const [status, setStatus] = useState<"idle" | "connecting" | "downloading" | "complete" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [downloadedChunks, setDownloadedChunks] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const downloaderRef = useRef<ChunkDownloader | null>(null);
  const peerManagerRef = useRef<PeerManager | null>(null);
  const signalingChannelRef = useRef<SignalingChannel | null>(null);

  useEffect(() => {
    return () => {
      downloaderRef.current?.cancel();
      peerManagerRef.current?.disconnectAll();
    };
  }, []);

  const start = () => {
    if (!chunkMap || !pubkey || !relayPool) {
      setStatus("error");
      setError("Missing required context (chunkMap, pubkey, or relayPool)");
      return;
    }

    setStatus("connecting");
    setError(null);
    setProgress(0);
    setDownloadedChunks(0);

    // Create real instances of PeerManager and SignalingChannel from @entropy/core
    const peerManager = new PeerManager();
    const signalingChannel = new SignalingChannel(relayPool);

    peerManagerRef.current = peerManager;
    signalingChannelRef.current = signalingChannel;

    try {
      downloaderRef.current = new ChunkDownloader({
        chunkMap,
        peerManager,
        signalingChannel,
        myPubkey: pubkey,
        relayPool,
        maxConcurrent: 3,
        onChunkReceived: (_index, _data) => {
          // Chunk received and verified — could store in local IndexedDB for re-seeding
        },
        onProgress: (downloaded, total) => {
          setDownloadedChunks(downloaded);
          setProgress(total > 0 ? downloaded / total : 0);
          setStatus("downloading");
        },
        onComplete: () => {
          setStatus("complete");
          setProgress(1);
          setDownloadedChunks(chunkMap.chunks.length);
        },
        onError: (err) => {
          setStatus("error");
          setError(err.message);
        },
      });

      downloaderRef.current.start();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const pause = () => {
    if (downloaderRef.current) {
      downloaderRef.current.pause();
      setStatus("idle");
    }
  };

  const cancel = () => {
    if (downloaderRef.current) {
      downloaderRef.current.cancel();
      setStatus("idle");
      setProgress(0);
      setDownloadedChunks(0);
    }
  };

  const getChunk = (index: number): ArrayBuffer | null => {
    return downloaderRef.current?.getChunk(index) || null;
  };

  const hasChunk = (index: number): boolean => {
    return downloaderRef.current?.hasChunk(index) || false;
  };

  return {
    status,
    progress,
    downloadedChunks,
    totalChunks: chunkMap?.chunks.length || 0,
    error,
    getChunk,
    hasChunk,
    start,
    pause,
    cancel,
  };
}
