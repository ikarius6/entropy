import { useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { Play, Download, Share2, Server, Loader2, Maximize, X } from "lucide-react";
import type { FeedItem } from "../../types/nostr";
import type { EntropyChunkMap } from "@entropy/core";
import { AvatarBadge } from "../profile/ProfileHeader";
import { useNostrProfile } from "../../hooks/useNostrProfile";
import { useChunkBlob } from "../../hooks/useChunkBlob";
import { useCreditGate } from "../../hooks/useCreditGate";
import { CreditGate } from "../CreditGate";
import { KINDS } from "../../lib/constants";

export function PostCard({ item }: { item: FeedItem }) {
  const { profile } = useNostrProfile(item.pubkey);
  const timeAgo = Math.floor(Date.now() / 1000) - item.created_at;

  const isMedia = item.kind === KINDS.ENTROPY_CHUNK_MAP && !!item.chunkMap;
  const contentSize = isMedia ? (item.chunkMap as EntropyChunkMap).size || 0 : 0;
  const gate = useCreditGate(contentSize);

  // Only start P2P transfer if credit gate allows it
  const { blobUrl, status: blobStatus, progress: blobProgress } = useChunkBlob(
    isMedia && gate.allowed ? item.chunkMap ?? null : null
  );

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  };

  return (
    <div className="panel p-5 flex flex-col gap-3 transition-colors hover:bg-white/[0.02]">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to={`/profile/${item.pubkey}`}>
          <AvatarBadge profile={profile} pubkey={item.pubkey} size="sm" />
        </Link>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Link to={`/profile/${item.pubkey}`} className="font-bold hover:underline">
              {profile?.name || profile?.displayName || "Anonymous Node"}
            </Link>
            <span className="text-muted text-sm font-mono">{item.pubkey.slice(0, 8)}...</span>
            <span className="text-muted text-sm">• {formatTime(timeAgo)}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      {item.content && (
        <div className="text-white/90 whitespace-pre-wrap leading-relaxed mt-1">
          {item.content}
        </div>
      )}

      {/* Media specific rendering — gated by credits */}
      {isMedia && item.chunkMap && (
        <CreditGate gate={gate} contentTitle={item.chunkMap.title} mimeType={item.chunkMap.mimeType}>
          <MediaPost chunkMap={item.chunkMap} blobUrl={blobUrl} blobStatus={blobStatus} blobProgress={blobProgress} />
        </CreditGate>
      )}

      {/* Actions */}
      <PostActions item={item} blobUrl={blobUrl} blobStatus={blobStatus} blobProgress={blobProgress} />
    </div>
  );
}

interface BlobProps {
  blobUrl: string | null;
  blobStatus: string;
  blobProgress: number;
}

function MediaPost({ chunkMap, blobUrl, blobStatus, blobProgress }: { chunkMap: EntropyChunkMap } & BlobProps) {
  const [expanded, setExpanded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const sizeMB = (chunkMap.size / (1024 * 1024)).toFixed(1);
  const numChunks = chunkMap.chunks?.length || 0;
  const mime: string = chunkMap.mimeType || "";
  const isImage = mime.startsWith("image/");
  const isAudio = mime.startsWith("audio/");
  const isVideo = mime.startsWith("video/") || (!isImage && !isAudio);

  const handlePlay = useCallback(() => {
    if (blobStatus !== "ready" || !videoRef.current) return;
    setExpanded(true);
    videoRef.current.play().catch(() => {});
  }, [blobStatus]);

  const handleCollapse = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    setExpanded(false);
  }, []);

  const metaBadges = (
    <div className="flex gap-2">
      <div className="px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-md text-xs font-mono border border-white/10">
        {sizeMB} MB
      </div>
      <div className="px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-md text-xs font-mono border border-white/10 flex items-center gap-1">
        <Server size={12} />
        {numChunks} chunks
      </div>
    </div>
  );

  function handleDownload() {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = chunkMap.title || "entropy-file";
    a.click();
  }

  return (
    <div className="mt-2 rounded-xl overflow-hidden border border-border bg-black/40">
      {isImage ? (
        <div className="relative group">
          <div className="w-full max-h-[480px] overflow-hidden flex items-center justify-center bg-black/60 min-h-[200px]">
            {blobStatus === "loading" && (
              <Loader2 className="animate-spin text-primary" size={32} />
            )}
            {blobStatus === "ready" && blobUrl && (
              <img src={blobUrl} alt={chunkMap.title || "image"} className="max-w-full max-h-[480px] object-contain" />
            )}
            {blobStatus === "error" && (
              <span className="text-muted text-sm">Failed to load image</span>
            )}
          </div>
          <div className="absolute bottom-3 left-3">{metaBadges}</div>
        </div>
      ) : isAudio ? (
        <div className="p-4 bg-gradient-to-br from-panel to-background flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="text-3xl">🎵</div>
            <span className="font-medium">{chunkMap.title || "Audio"}</span>
          </div>
          {blobUrl && <audio controls src={blobUrl} className="w-full" />}
          {blobStatus === "loading" && <Loader2 className="animate-spin text-primary" size={20} />}
          <div>{metaBadges}</div>
        </div>
      ) : isVideo ? (
        <div className="relative group cursor-pointer" onClick={!expanded ? handlePlay : undefined}>
          {/* Loading / error states (no blob yet) */}
          {blobStatus === "loading" && (
            <div className="aspect-video bg-gradient-to-br from-panel to-background flex flex-col items-center justify-center">
              <Loader2 className="animate-spin text-primary" size={40} />
              <span className="text-muted text-xs mt-2">{Math.round(blobProgress * 100)}% loaded</span>
            </div>
          )}
          {blobStatus === "error" && (
            <div className="aspect-video bg-gradient-to-br from-panel to-background flex items-center justify-center">
              <span className="text-red-400 text-sm">Failed to load video</span>
            </div>
          )}

          {/* Video element — always mounted when blob is ready; browser shows first frame as preview */}
          {blobUrl && (
            <video
              ref={videoRef}
              src={blobUrl}
              preload="metadata"
              controls={expanded}
              muted={!expanded}
              className="w-full max-h-[480px] bg-black"
            />
          )}

          {/* Play button overlay (collapsed state) */}
          {blobUrl && !expanded && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
              <button className="w-16 h-16 rounded-full bg-primary/90 text-background flex items-center justify-center transform group-hover:scale-110 transition-transform shadow-lg shadow-primary/20">
                <Play fill="currentColor" size={24} className="ml-1" />
              </button>
            </div>
          )}

          {/* Controls overlay (expanded state) */}
          {expanded && (
            <div className="absolute top-3 right-3 z-10 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <Link
                to={`/watch/${chunkMap.rootHash}`}
                className="p-1.5 rounded-md bg-black/60 backdrop-blur-md border border-white/10 text-white/80 hover:text-white hover:bg-black/80 transition-colors"
                title="Open full page"
                onClick={(e) => e.stopPropagation()}
              >
                <Maximize size={14} />
              </Link>
              <button
                onClick={(e) => { e.stopPropagation(); handleCollapse(); }}
                className="p-1.5 rounded-md bg-black/60 backdrop-blur-md border border-white/10 text-white/80 hover:text-white hover:bg-black/80 transition-colors"
                title="Collapse"
              >
                <X size={14} />
              </button>
            </div>
          )}

          <div className="absolute bottom-3 left-3 z-10 pointer-events-none">{metaBadges}</div>
        </div>
      ) : null}

      {/* Footer Info */}
      <div className="p-3 bg-white/5 border-t border-border flex items-center justify-between">
        <div>
          <span className="font-medium text-sm">{chunkMap.title || "Untitled Media"}</span>
          <span className="text-xs text-muted font-mono truncate block mt-0.5" title={chunkMap.rootHash}>
            hash: {chunkMap.rootHash.slice(0, 12)}...
          </span>
        </div>
        <button
          onClick={handleDownload}
          disabled={blobStatus !== "ready"}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-white transition-colors px-2 py-1 rounded border border-border hover:border-white/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {blobStatus === "loading" ? (
            <><Loader2 size={12} className="animate-spin" />{Math.round(blobProgress * 100)}%</>
          ) : (
            <><Download size={12} />Save</>
          )}
        </button>
      </div>
    </div>
  );
}

function PostActions({ item, blobUrl, blobStatus, blobProgress }: { item: FeedItem } & BlobProps) {
  const isMedia = item.kind === KINDS.ENTROPY_CHUNK_MAP;

  function handleDownload() {
    if (!blobUrl || !item.chunkMap) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = item.chunkMap.title || item.chunkMap.rootHash.slice(0, 12);
    a.click();
  }

  return (
    <div className="flex items-center gap-4 mt-2 pt-3 border-t border-border/50">
      {isMedia && item.chunkMap && (
        <>
          <Link
            to={`/watch/${item.chunkMap.rootHash}`}
            className="flex items-center gap-2 text-sm text-muted hover:text-white transition-colors"
          >
            <Maximize size={16} />
            Full Page
          </Link>
          <button
            onClick={handleDownload}
            disabled={blobStatus !== "ready"}
            className="flex items-center gap-2 text-sm text-muted hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {blobStatus === "loading" ? (
              <><Loader2 size={16} className="animate-spin" />{Math.round(blobProgress * 100)}%</>
            ) : (
              <><Download size={16} />Download</>
            )}
          </button>
          <button className="flex items-center gap-2 text-sm text-muted hover:text-green-400 transition-colors" title="Seed this content to earn credits">
            <Server size={16} />
            Seed
          </button>
        </>
      )}
      
      <button className="flex items-center gap-2 text-sm text-muted hover:text-white transition-colors ml-auto">
        <Share2 size={16} />
        Share
      </button>
    </div>
  );
}
