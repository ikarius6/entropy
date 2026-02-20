import { useState, useEffect, useRef } from "react";
import { type EntropyChunkMap, ChunkDownloader } from "@entropy/core";
import { useEntropyStore } from "../stores/entropy-store";

export function useChunkDownload(chunkMap: EntropyChunkMap | null) {
  const { pubkey, relayPool } = useEntropyStore();
  
  const [status, setStatus] = useState<"idle" | "connecting" | "downloading" | "complete" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [downloadedChunks, setDownloadedChunks] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  const downloaderRef = useRef<ChunkDownloader | null>(null);

  useEffect(() => {
    return () => {
      if (downloaderRef.current) {
        downloaderRef.current.cancel();
      }
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

    // Mocking PeerManager and SignalingChannel for now
    const mockPeerManager = {
      addPeer: () => {},
      removePeer: () => {},
      getPeer: () => ({ connection: new RTCPeerConnection() }),
      listPeers: () => [],
      size: 0,
      on: () => {},
      off: () => {},
      disconnectAll: () => {}
    } as any;

    const mockSignalingChannel = {
      start: () => {},
      stop: () => {},
      sendOffer: async () => {},
      sendAnswer: async () => {},
      sendIceCandidate: async () => {},
      onMessage: () => {}
    } as any;

    try {
      downloaderRef.current = new ChunkDownloader({
        chunkMap,
        peerManager: mockPeerManager,
        signalingChannel: mockSignalingChannel,
        myPubkey: pubkey,
        relayPool,
        maxConcurrent: 3,
        onChunkReceived: (index, data) => {
          // This would be triggered by actual downloads
        },
        onProgress: (downloaded, total) => {
          setDownloadedChunks(downloaded);
          setProgress(downloaded / total);
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
        }
      });

      downloaderRef.current.start();
      
      // MOCK: Simulate downloading for Phase 4 UI implementation
      let count = 0;
      const total = chunkMap.chunks.length;
      
      const interval = setInterval(() => {
        count++;
        setDownloadedChunks(count);
        setProgress(count / total);
        setStatus("downloading");
        
        if (count >= total) {
          clearInterval(interval);
          setStatus("complete");
        }
      }, 500);

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
    cancel
  };
}
