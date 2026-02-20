import { Link } from "react-router-dom";
import { Play, Download, Share2, Server, Loader2 } from "lucide-react";
import type { FeedItem } from "../../types/nostr";
import { AvatarBadge } from "../profile/ProfileHeader";
import { useNostrProfile } from "../../hooks/useNostrProfile";
import { useChunkBlob } from "../../hooks/useChunkBlob";
import { KINDS } from "../../lib/constants";

export function PostCard({ item }: { item: FeedItem }) {
  const { profile } = useNostrProfile(item.pubkey);
  const timeAgo = Math.floor(Date.now() / 1000) - item.created_at;
  const { blobUrl, status: blobStatus, progress: blobProgress } = useChunkBlob(
    item.kind === KINDS.ENTROPY_CHUNK_MAP ? item.chunkMap ?? null : null
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
      <div className="text-white/90 whitespace-pre-wrap leading-relaxed mt-1">
        {item.content}
      </div>

      {/* Media specific rendering */}
      {item.kind === KINDS.ENTROPY_CHUNK_MAP && item.chunkMap && (
        <MediaPost chunkMap={item.chunkMap} blobUrl={blobUrl} blobStatus={blobStatus} blobProgress={blobProgress} />
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

function MediaPost({ chunkMap, blobUrl, blobStatus, blobProgress }: { chunkMap: any } & BlobProps) {
  const sizeMB = (chunkMap.size / (1024 * 1024)).toFixed(1);
  const numChunks = chunkMap.chunks?.length || 0;
  const mime: string = chunkMap.mimeType || "";
  const isImage = mime.startsWith("image/");
  const isAudio = mime.startsWith("audio/");

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
      ) : (
        <div className="aspect-video bg-gradient-to-br from-panel to-background flex flex-col items-center justify-center relative group cursor-pointer">
          <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors" />
          <Link
            to={`/watch/${chunkMap.rootHash}`}
            className="w-16 h-16 rounded-full bg-primary/90 text-background flex items-center justify-center relative z-10 transform group-hover:scale-110 transition-transform shadow-lg shadow-primary/20"
          >
            <Play fill="currentColor" size={24} className="ml-1" />
          </Link>
          <div className="absolute bottom-3 left-3 z-10">{metaBadges}</div>
        </div>
      )}

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
            className="flex items-center gap-2 text-sm text-primary hover:text-accent transition-colors font-medium"
          >
            <Play size={16} />
            Watch
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
