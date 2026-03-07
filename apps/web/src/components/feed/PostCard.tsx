import { useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { Play, Download, Share2, Loader2, Maximize, X, Heart, MessageCircle, ChevronUp, Check, EyeOff, Repeat2, CornerUpLeft } from "lucide-react";
import type { FeedItem } from "../../types/nostr";
import type { EntropyChunkMap, ContentTag, UserSignalType } from "@entropy/core";
import { AvatarBadge } from "../profile/ProfileHeader";
import { useNostrProfile } from "../../hooks/useNostrProfile";
import { useChunkBlob } from "../../hooks/useChunkBlob";
import { useCreditGate } from "../../hooks/useCreditGate";
import { CreditGate } from "../CreditGate";
import { KINDS } from "../../lib/constants";
import { useReactions } from "../../hooks/useReactions";
import { useReplies } from "../../hooks/useReplies";
import { useRepost } from "../../hooks/useRepost";
import { useEvent } from "../../hooks/useEvent";
import { ReplyComposer } from "./ReplyComposer";

/** Build a shareable URL pointing to this Entropy instance. */
function postUrl(item: FeedItem): string {
  const base = window.location.origin;
  if (item.chunkMap?.rootHash) {
    return `${base}/watch/${item.chunkMap.rootHash}`;
  }
  return `${base}/watch/${item.id}`;
}

/** Share via Web Share API, fall back to clipboard. */
async function sharePost(item: FeedItem) {
  const url = postUrl(item);
  const text = item.content
    ? `${item.content.slice(0, 120)}${item.content.length > 120 ? "\u2026" : ""}`
    : "Check out this post on Entropy";
  if (navigator.share) {
    try {
      await navigator.share({ title: "Entropy", text, url });
      return;
    } catch { /* user cancelled — fall through */ }
  }
  await navigator.clipboard.writeText(url);
}

interface PostCardProps {
  item: FeedItem;
  onSignal?: (contentTags: ContentTag[], signal: UserSignalType) => void;
  /** Called to remove this item from the parent feed (e.g. after undoing a repost) */
  onRemoveItem?: (eventId: string) => void;
}

export function PostCard({ item, onSignal, onRemoveItem }: PostCardProps) {
  // For reposts, the display item is the inner reposted event
  const isRepost = item.kind === KINDS.REPOST && !!item.repostedEvent;
  const displayItem = isRepost ? item.repostedEvent! : item;

  const { profile: repostProfile } = useNostrProfile(isRepost ? item.pubkey : null);
  const { profile } = useNostrProfile(displayItem.pubkey);
  const timeAgo = Math.floor(Date.now() / 1000) - displayItem.created_at;

  const isMedia = displayItem.kind === KINDS.ENTROPY_CHUNK_MAP && !!displayItem.chunkMap;
  const contentSize = isMedia ? (displayItem.chunkMap as EntropyChunkMap).size || 0 : 0;
  const chunkHashes = isMedia ? (displayItem.chunkMap as EntropyChunkMap).chunks : undefined;
  const gate = useCreditGate({
    contentSizeBytes: contentSize,
    authorPubkey: displayItem.pubkey,
    chunkHashes,
  });

  // Only start P2P transfer if credit gate allows it
  const { blobUrl, status: blobStatus, progress: blobProgress } = useChunkBlob(
    isMedia && gate.allowed ? displayItem.chunkMap ?? null : null
  );

  // Reactions (always-on, lightweight)
  const { counts: reactionCounts, total: reactionTotal, myReaction, react, isReacting } = useReactions(displayItem.id, displayItem.pubkey);

  // Replies (lazy — only loads on demand)
  const { replies, isLoading: repliesLoading, load: loadReplies, isLoaded: repliesLoaded } = useReplies(displayItem.id);
  const [showReplies, setShowReplies] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [shareFeedback, setShareFeedback] = useState(false);

  // Repost (stateful — queries relay for existing reposts)
  const { reposted, isBusy: repostBusy, count: repostCount, toggle: toggleRepost } = useRepost(displayItem.id);

  const toggleReplies = () => {
    if (!showReplies && !repliesLoaded) {
      loadReplies();
    }
    setShowReplies((v) => !v);
    if (!showReplies) setShowComposer(false);
  };

  // Extract content tags from the chunk map (if any) for signal emission
  const contentTags: ContentTag[] = isMedia && displayItem.chunkMap
    ? (displayItem.chunkMap as EntropyChunkMap).entropyTags ?? []
    : [];

  const emitSignal = (signal: UserSignalType) => {
    if (onSignal && contentTags.length > 0) {
      onSignal(contentTags, signal);
    }
  };

  const handleShare = async () => {
    await sharePost(displayItem);
    emitSignal("share");
    setShareFeedback(true);
    setTimeout(() => setShareFeedback(false), 2000);
  };

  const handleRepost = async () => {
    if (repostBusy) return;
    const wasReposted = reposted;
    await toggleRepost(displayItem);
    // If we just undid a repost and this card IS the repost event, remove it from the feed
    if (wasReposted && isRepost && onRemoveItem) {
      onRemoveItem(item.id);
    }
  };

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  };

  // NIP-10 root id for reply threading
  const rootId = displayItem.tags.find(t => t[0] === "e" && t[3] === "root")?.[1] ?? displayItem.id;

  const replyContext = {
    rootId,
    parentId: displayItem.id,
    authorPubkey: displayItem.pubkey,
  };

  return (
    <div className="panel p-5 flex flex-col gap-3 transition-colors hover:bg-white/[0.02]">
      {/* Repost header */}
      {isRepost && (
        <div className="flex items-center gap-2 text-muted text-xs -mb-1">
          <Repeat2 size={13} />
          <Link to={`/profile/${item.pubkey}`} className="hover:underline font-medium">
            {repostProfile?.name || repostProfile?.displayName || item.pubkey.slice(0, 8) + "…"}
          </Link>
          <span>reposted</span>
        </div>
      )}

      {/* Reply context: quoted parent post */}
      {item.isReply && item.replyToId && (
        <QuotedParent eventId={item.replyToId} />
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to={`/profile/${displayItem.pubkey}`}>
          <AvatarBadge profile={profile} pubkey={displayItem.pubkey} size="sm" />
        </Link>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Link to={`/profile/${displayItem.pubkey}`} className="font-bold hover:underline">
              {profile?.name || profile?.displayName || "Anonymous Node"}
            </Link>
            <span className="text-muted text-sm font-mono">{displayItem.pubkey.slice(0, 8)}...</span>
            <span className="text-muted text-sm">• {formatTime(timeAgo)}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      {displayItem.content && (
        <div className="text-white/90 whitespace-pre-wrap break-words leading-relaxed mt-1">
          {displayItem.content}
        </div>
      )}

      {/* Media specific rendering — gated by credits */}
      {isMedia && displayItem.chunkMap && (
        <CreditGate gate={gate} contentTitle={displayItem.chunkMap.title} mimeType={displayItem.chunkMap.mimeType}>
          <MediaPost chunkMap={displayItem.chunkMap} blobUrl={blobUrl} blobStatus={blobStatus} blobProgress={blobProgress} />
        </CreditGate>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-1 mt-1 pt-3 border-t border-border/50">

        {/* ❤️ Like */}
        <button
          onClick={() => { react("❤️"); emitSignal("like"); }}
          disabled={isReacting}
          title={myReaction ? `You reacted ${myReaction}` : "Like"}
          className={`flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg transition-all ${
            myReaction
              ? "text-red-400 bg-red-400/10"
              : "text-muted hover:text-red-400 hover:bg-red-400/10"
          } disabled:opacity-50`}
        >
          <Heart size={15} fill={myReaction ? "currentColor" : "none"} />
          {reactionTotal > 0 && <span className="tabular-nums">{reactionTotal}</span>}
        </button>

        {/* Emoji reactions summary (top 3) */}
        {Object.entries(reactionCounts)
          .filter(([emoji]) => emoji !== "❤️")
          .sort(([, a], [, b]) => b - a)
          .slice(0, 2)
          .map(([emoji, count]) => (
            <button
              key={emoji}
              onClick={() => react(emoji)}
              className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg text-muted hover:bg-white/5 transition-colors"
            >
              {emoji} {count}
            </button>
          ))}

        {/* 💬 Replies */}
        <button
          onClick={toggleReplies}
          title={showReplies ? "Hide replies" : "Show replies"}
          className={`flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg transition-all ${
            showReplies
              ? "text-primary bg-primary/10"
              : "text-muted hover:text-white hover:bg-white/5"
          }`}
        >
          {showReplies ? <ChevronUp size={15} /> : <MessageCircle size={15} />}
          {repliesLoaded && replies.length > 0
            ? <span className="tabular-nums">{replies.length}</span>
            : null}
          {!repliesLoaded ? "Replies" : replies.length === 0 ? "Reply" : ""}
        </button>

        {/* 🔁 Repost */}
        <button
          onClick={handleRepost}
          disabled={repostBusy}
          title={reposted ? "Undo repost" : "Repost"}
          className={`flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg transition-all ${
            reposted
              ? "text-emerald-400 bg-emerald-400/10"
              : "text-muted hover:text-emerald-400 hover:bg-emerald-400/10"
          } disabled:opacity-50`}
        >
          <Repeat2 size={15} />
          {repostBusy ? "…" : repostCount > 0 ? <span className="tabular-nums">{repostCount}</span> : null}
        </button>

        {/* Full Page link */}
        <Link
          to={isMedia && displayItem.chunkMap ? `/watch/${displayItem.chunkMap.rootHash}` : `/watch/${displayItem.id}`}
          className="flex items-center gap-1.5 text-sm text-muted hover:text-white transition-colors px-2.5 py-1.5 rounded-lg hover:bg-white/5 ml-1"
        >
          <Maximize size={15} />
          Full Page
        </Link>

        {/* Media-specific download */}
        {isMedia && displayItem.chunkMap && (
          <DownloadButton blobUrl={blobUrl} blobStatus={blobStatus} blobProgress={blobProgress} chunkMap={displayItem.chunkMap} />
        )}

        {/* Not interested */}
        {contentTags.length > 0 && (
          <button
            onClick={() => emitSignal("not_interested")}
            title="Not interested in this type of content"
            className="flex items-center gap-1.5 text-sm text-muted hover:text-orange-400 hover:bg-orange-400/10 px-2.5 py-1.5 rounded-lg transition-all"
          >
            <EyeOff size={15} />
          </button>
        )}

        {/* Share */}
        <button
          onClick={handleShare}
          className={`flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg transition-all ml-auto ${
            shareFeedback
              ? "text-green-400 bg-green-400/10"
              : "text-muted hover:text-white hover:bg-white/5"
          }`}
        >
          {shareFeedback ? (
            <><Check size={15} /> Copied!</>
          ) : (
            <><Share2 size={15} /> Share</>
          )}
        </button>
      </div>

      {/* Replies section (lazy) */}
      {showReplies && (
        <div className="flex flex-col gap-3 mt-1 pl-4 border-l-2 border-border/40">
          {repliesLoading && (
            <div className="flex items-center gap-2 text-muted text-sm py-2">
              <Loader2 size={15} className="animate-spin" /> Loading replies…
            </div>
          )}

          {repliesLoaded && replies.length === 0 && !showComposer && (
            <p className="text-muted text-sm py-1">No replies yet.</p>
          )}

          {/* Existing replies (use a lightweight inline card) */}
          {replies.map((reply) => (
            <ReplyCard key={reply.id} item={reply} />
          ))}

          {/* Reply composer toggle */}
          {!showComposer ? (
            <button
              onClick={() => setShowComposer(true)}
              className="text-sm text-muted hover:text-primary transition-colors text-left py-1"
            >
              + Write a reply…
            </button>
          ) : (
            <ReplyComposer
              replyTo={replyContext}
              onReplied={() => {
                setShowComposer(false);
                // Re-load to show the new reply
                loadReplies();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Quoted parent post (shown above replies for context) ─────────────────────

function QuotedParent({ eventId }: { eventId: string }) {
  const { event, isLoading } = useEvent(eventId);
  const { profile } = useNostrProfile(event?.pubkey ?? null);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted text-xs py-2 px-3 rounded-lg bg-white/[0.03] border border-border/40">
        <Loader2 size={12} className="animate-spin" />
        <span>Loading original post…</span>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex items-center gap-2 text-muted text-xs py-2 px-3 rounded-lg bg-white/[0.03] border border-border/40">
        <CornerUpLeft size={12} />
        <span>Replying to a post</span>
      </div>
    );
  }

  const displayName = profile?.name || profile?.displayName || event.pubkey.slice(0, 8) + "…";
  const truncatedContent = event.content.length > 280
    ? event.content.slice(0, 280) + "…"
    : event.content;

  return (
    <Link
      to={`/watch/${eventId}`}
      className="block rounded-lg bg-white/[0.03] border border-border/40 px-3 py-2.5 hover:bg-white/[0.05] transition-colors group"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <CornerUpLeft size={12} className="text-muted flex-shrink-0" />
        <AvatarBadge profile={profile} pubkey={event.pubkey} size="sm" />
        <span className="text-xs font-semibold text-white/80 group-hover:text-white transition-colors">
          {displayName}
        </span>
        <span className="text-muted text-xs font-mono">{event.pubkey.slice(0, 6)}…</span>
      </div>
      {truncatedContent && (
        <p className="text-xs text-muted leading-relaxed ml-5 line-clamp-3">
          {truncatedContent}
        </p>
      )}
    </Link>
  );
}

// ─── Lightweight reply card (no recursion to a avoid deep nesting) ────────────

export function ReplyCard({ item }: { item: FeedItem }) {
  const { profile } = useNostrProfile(item.pubkey);
  const timeAgo = Math.floor(Date.now() / 1000) - item.created_at;
  const { total: reactionTotal, myReaction, react } = useReactions(item.id, item.pubkey);

  const formatTime = (s: number) => {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Link to={`/profile/${item.pubkey}`}>
          <AvatarBadge profile={profile} pubkey={item.pubkey} size="sm" />
        </Link>
        <Link to={`/profile/${item.pubkey}`} className="font-semibold text-sm hover:underline">
          {profile?.name || profile?.displayName || "Anonymous Node"}
        </Link>
        <span className="text-muted text-xs font-mono">{item.pubkey.slice(0, 6)}…</span>
        <span className="text-muted text-xs">• {formatTime(timeAgo)}</span>
      </div>

      {item.content && (
        <div className="text-white/85 text-sm whitespace-pre-wrap break-words leading-relaxed ml-9">
          {item.content}
        </div>
      )}

      <div className="ml-9">
        <button
          onClick={() => react("❤️")}
          className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-all ${
            myReaction ? "text-red-400" : "text-muted hover:text-red-400"
          }`}
        >
          <Heart size={12} fill={myReaction ? "currentColor" : "none"} />
          {reactionTotal > 0 && reactionTotal}
        </button>
      </div>
    </div>
  );
}

// ─── Download button (extracted to keep PostCard JSX tidy) ────────────────────

function DownloadButton({ blobUrl, blobStatus, blobProgress, chunkMap }: {
  blobUrl: string | null;
  blobStatus: string;
  blobProgress: number;
  chunkMap: EntropyChunkMap;
}) {
  const handleDownload = () => {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = chunkMap.title || chunkMap.rootHash.slice(0, 12);
    a.click();
  };

  return (
    <button
      onClick={handleDownload}
      disabled={blobStatus !== "ready"}
      className="flex items-center gap-1.5 text-sm text-muted hover:text-white transition-colors px-2.5 py-1.5 rounded-lg hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {blobStatus === "loading" ? (
        <><Loader2 size={15} className="animate-spin" />{Math.round(blobProgress * 100)}%</>
      ) : (
        <><Download size={15} />Download</>
      )}
    </button>
  );
}

// ─── Kept from original ────────────────────────────────────────────────────────

interface BlobProps {
  blobUrl: string | null;
  blobStatus: string;
  blobProgress: number;
}

function MediaPost({ chunkMap, blobUrl, blobStatus, blobProgress }: { chunkMap: EntropyChunkMap } & BlobProps) {
  const [expanded, setExpanded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const sizeMB = (chunkMap.size / (1024 * 1024)).toFixed(1);
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
    </div>
  );

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
          {blobUrl && !expanded && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
              <button className="w-16 h-16 rounded-full bg-primary/90 text-background flex items-center justify-center transform group-hover:scale-110 transition-transform shadow-lg shadow-primary/20">
                <Play fill="currentColor" size={24} className="ml-1" />
              </button>
            </div>
          )}
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

      <div className="p-3 bg-white/5 border-t border-border">
        <span className="font-medium text-sm">{chunkMap.title || "Untitled Media"}</span>
        <span className="text-xs text-muted font-mono truncate block mt-0.5" title={chunkMap.rootHash}>
          hash: {chunkMap.rootHash.slice(0, 12)}...
        </span>
      </div>
    </div>
  );
}
