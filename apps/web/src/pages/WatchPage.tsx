import { useParams } from "react-router-dom";
import { useEntropyStore } from "../stores/entropy-store";
import { useEffect, useState } from "react";
import { useChunkDownload } from "../hooks/useChunkDownload";
import { useChunkBlob } from "../hooks/useChunkBlob";
import { useCreditGate } from "../hooks/useCreditGate";
import { CreditGate } from "../components/CreditGate";
import { VideoPlayer } from "../components/player/VideoPlayer";
import { Server, Download, ShieldCheck, Loader2 } from "lucide-react";
import { parseEntropyChunkMapTags, type EntropyChunkMap, type NostrEvent } from "@entropy/core";
import { KINDS } from "../lib/constants";

export default function WatchPage() {
  const { rootHash } = useParams<{ rootHash: string }>();
  const [chunkMap, setChunkMap] = useState<EntropyChunkMap | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { relayPool, relayUrls, chunkMapCache } = useEntropyStore();

  // Check cache first (populated when events arrive in the feed)
  useEffect(() => {
    if (!rootHash) return;
    const cached = chunkMapCache[rootHash];
    if (cached) {
      console.log(`[WatchPage] found chunkMap in cache for rootHash=${rootHash.slice(0,12)}`);
      setChunkMap(cached);
      setError(null);
    }
  }, [rootHash, chunkMapCache]);

  // Fetch the kind:7001 event directly from relays by x-hash tag
  useEffect(() => {
    if (!rootHash || !relayPool || relayUrls.length === 0) return;
    // Skip relay query if already resolved from cache
    if (chunkMapCache[rootHash]) return;

    setChunkMap(null);
    setError(null);

    console.log(`[WatchPage] subscribing for rootHash=${rootHash} on ${relayUrls.length} relays`);
    let found = false;
    // Note: relays don't index custom tags like #x-hash, so we fetch recent
    // kind:7001 events and filter locally by rootHash.
    const sub = relayPool.subscribe(
      [{ kinds: [KINDS.ENTROPY_CHUNK_MAP], limit: 200 }],
      (event: NostrEvent) => {
        if (found) return;
        const xHashTag = event.tags.find(t => t[0] === "x-hash");
        console.log(`[WatchPage] event id=${event.id.slice(0,8)} x-hash=${xHashTag?.[1]?.slice(0,12)}`);
        if (!xHashTag || xHashTag[1] !== rootHash) return;
        try {
          const parsed = parseEntropyChunkMapTags(event.tags);
          console.log(`[WatchPage] matched chunkMap:`, parsed);
          found = true;
          setChunkMap(parsed);
          sub.unsubscribe();
        } catch (e) {
          console.warn(`[WatchPage] failed to parse event:`, e);
        }
      },
      () => {
        console.log(`[WatchPage] EOSE received, found=${found}`);
        if (!found) {
          setError("Content not found. Make sure you are connected to the right relays.");
        }
      }
    );

    return () => { sub.unsubscribe(); };
  }, [rootHash, relayPool, relayUrls.join(",")]);

  // Credit gate: check balance before initiating any P2P transfer
  const contentSize = chunkMap?.size || 0;
  const gate = useCreditGate(contentSize);

  const {
    status,
    progress,
    downloadedChunks,
    totalChunks,
    start,
    pause,
    error: downloadError
  } = useChunkDownload(gate.allowed ? chunkMap : null);

  // Only start P2P transfer if credit gate allows it
  const { blobUrl, status: blobStatus, error: blobError, progress: blobProgress } = useChunkBlob(
    gate.allowed ? chunkMap : null
  );

  const mime = chunkMap?.mimeType || "";
  const isImage = mime.startsWith("image/");
  const isAudio = mime.startsWith("audio/");
  const isVideo = mime.startsWith("video/") || (!isImage && !isAudio && !!chunkMap);

  function handleDownload() {
    if (!blobUrl || !chunkMap) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = chunkMap.title || rootHash || "entropy-file";
    a.click();
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center gap-4 border border-dashed border-border rounded-xl p-8 bg-white/5">
        <h2 className="text-xl font-bold text-red-400">Error</h2>
        <p className="text-muted max-w-md">{error}</p>
      </div>
    );
  }

  if (!chunkMap) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center gap-4">
        <Loader2 className="animate-spin text-primary" size={48} />
        <p className="text-muted">Resolving content hash...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full">
      {/* Media viewer — gated by credits */}
      <CreditGate gate={gate} contentTitle={chunkMap.title} mimeType={chunkMap.mimeType}>
        <div className="w-full rounded-xl overflow-hidden border border-border bg-black/60 flex items-center justify-center min-h-[300px]">
          {blobStatus === "loading" && (
            <div className="flex flex-col items-center gap-3 py-16">
              <Loader2 className="animate-spin text-primary" size={40} />
              <span className="text-muted text-sm">{Math.round(blobProgress * 100)}% loaded</span>
            </div>
          )}
          {blobStatus === "error" && (
            <div className="text-red-400 text-sm p-8 text-center">{blobError}</div>
          )}
          {blobStatus === "ready" && blobUrl && isImage && (
            <img src={blobUrl} alt={chunkMap.title || "image"} className="max-w-full max-h-[70vh] object-contain" />
          )}
          {blobStatus === "ready" && blobUrl && isAudio && (
            <div className="flex flex-col items-center gap-4 p-8 w-full">
              <div className="text-6xl">🎵</div>
              <audio controls src={blobUrl} className="w-full max-w-lg" autoPlay />
            </div>
          )}
          {blobStatus === "ready" && blobUrl && isVideo && (
            <video controls src={blobUrl} className="w-full max-h-[70vh]" autoPlay />
          )}
        </div>
      </CreditGate>

      <div className="panel grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 flex flex-col gap-4">
          <h1 className="text-2xl font-bold">{chunkMap.title || "Untitled"}</h1>

          <div className="flex items-center gap-4 text-sm text-muted mb-2">
            <span className="flex items-center gap-1.5"><ShieldCheck size={16} className="text-green-400" /> Verified</span>
            <span className="flex items-center gap-1.5"><Server size={16} /> {chunkMap.chunks.length} chunks</span>
            <span className="font-mono bg-white/5 px-2 py-0.5 rounded">{rootHash?.slice(0, 16)}...</span>
          </div>

          {chunkMap.mimeType && (
            <div className="text-sm text-muted">
              <span className="bg-white/5 px-2 py-0.5 rounded font-mono">{chunkMap.mimeType}</span>
              <span className="ml-3">{(chunkMap.size / 1024 / 1024).toFixed(2)} MB</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 justify-start md:border-l md:border-border md:pl-6">
          <button
            onClick={handleDownload}
            disabled={blobStatus !== "ready" || !gate.allowed}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg font-bold bg-primary text-background hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={18} />
            {!gate.allowed ? "Insufficient Credits" : blobStatus === "loading" ? `Loading… ${Math.round(blobProgress * 100)}%` : "Save to Disk"}
          </button>

          <button className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg font-bold bg-white/5 text-white hover:bg-white/10 transition-colors">
            <Server size={18} />
            Seed (Earn Credits)
          </button>
        </div>
      </div>
    </div>
  );
}
