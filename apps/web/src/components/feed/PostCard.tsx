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
import { SmartContent } from "./SmartContent";

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

  const actionBaseClass = "inline-flex items-center gap-1.5 rounded-md border border-transparent px-2.5 py-1.5 text-sm transition-colors";

  return (
    <div className="panel flex flex-col gap-3 px-5 py-4">
      {/* Repost header */}
      {isRepost && (
        <div className="-mb-1 flex items-center gap-2 text-xs text-muted">
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
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Link to={`/profile/${displayItem.pubkey}`} className="text-[0.96rem] font-semibold hover:underline">
              {profile?.name || profile?.displayName || "Anonymous Node"}
            </Link>
            <span className="font-mono text-[0.76rem] text-muted">{displayItem.pubkey.slice(0, 8)}...</span>
            <Link to={isMedia && displayItem.chunkMap ? `/watch/${displayItem.chunkMap.rootHash}` : `/watch/${displayItem.id}`} className="text-sm text-muted hover:underline">• {formatTime(timeAgo)}</Link>
          </div>
        </div>
      </div>

      {/* Content */}
      {displayItem.content && (
        <div className="mt-1">
          <SmartContent content={displayItem.content} />
        </div>
      )}

      {/* Media specific rendering — gated by credits */}
      {isMedia && displayItem.chunkMap && (
        <CreditGate gate={gate} contentTitle={displayItem.chunkMap.title} mimeType={displayItem.chunkMap.mimeType}>
          <MediaPost chunkMap={displayItem.chunkMap} blobUrl={blobUrl} blobStatus={blobStatus} blobProgress={blobProgress} />
        </CreditGate>
      )}

      {/* Action bar */}
      <div className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-3">

        {/* ❤️ Like */}
        <button
          onClick={() => { react("❤️"); emitSignal("like"); }}
          disabled={isReacting}
          title={myReaction ? `You reacted ${myReaction}` : "Like"}
          className={`${actionBaseClass} ${
            myReaction
              ? "border-red-400/20 bg-red-400/10 text-red-400"
              : "text-muted hover:border-border hover:bg-white/[0.03] hover:text-red-400"
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
              className="inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-1.5 text-xs text-muted transition-colors hover:border-border hover:bg-white/[0.03] hover:text-main"
            >
              {emoji} {count}
            </button>
          ))}

        {/* 💬 Replies */}
        <button
          onClick={toggleReplies}
          title={showReplies ? "Hide replies" : "Show replies"}
          className={`${actionBaseClass} ${
            showReplies
              ? "border-primary/25 bg-primary/10 text-primary"
              : "text-muted hover:border-border hover:bg-white/[0.03] hover:text-main"
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
          className={`${actionBaseClass} ${
            reposted
              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-400"
              : "text-muted hover:border-border hover:bg-white/[0.03] hover:text-emerald-400"
          } disabled:opacity-50`}
        >
          <Repeat2 size={15} />
          {repostBusy ? "…" : repostCount > 0 ? <span className="tabular-nums">{repostCount}</span> : null}
        </button>

        {/* Full Page link */}
        <Link
          to={isMedia && displayItem.chunkMap ? `/watch/${displayItem.chunkMap.rootHash}` : `/watch/${displayItem.id}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-transparent px-2.5 py-1.5 text-sm text-muted transition-colors hover:border-border hover:bg-white/[0.03] hover:text-main"
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
            className="inline-flex items-center gap-1.5 rounded-md border border-transparent px-2.5 py-1.5 text-sm text-muted transition-colors hover:border-border hover:bg-white/[0.03] hover:text-orange-400"
          >
            <EyeOff size={15} />
          </button>
        )}

        {/* Share */}
        <button
          onClick={handleShare}
          className={`ml-auto inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
            shareFeedback
              ? "border-green-400/20 bg-green-400/10 text-green-400"
              : "border-transparent text-muted hover:border-border hover:bg-white/[0.03] hover:text-main"
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
        <div className="surface-subtle mt-1 flex flex-col gap-3 px-4 py-4">
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
              className="text-left py-1 text-sm text-muted transition-colors hover:text-primary"
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
      <div className="surface-subtle flex items-center gap-2 px-3 py-2 text-xs text-muted">
        <Loader2 size={12} className="animate-spin" />
        <span>Loading original post…</span>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="surface-subtle flex items-center gap-2 px-3 py-2 text-xs text-muted">
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
      className="surface-subtle group block px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <CornerUpLeft size={12} className="text-muted flex-shrink-0" />
        <AvatarBadge profile={profile} pubkey={event.pubkey} size="sm" />
        <span className="text-xs font-semibold text-surface/80 transition-colors group-hover:text-main">
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
    <div className="flex flex-col gap-2 px-3 py-3">
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
        <div className="ml-9 text-sm">
          <SmartContent content={item.content} compact />
        </div>
      )}

      <div className="ml-9">
        <button
          onClick={() => react("❤️")}
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
            myReaction ? "border-red-400/20 bg-red-400/10 text-red-400" : "border-transparent text-muted hover:border-border hover:bg-white/[0.03] hover:text-red-400"
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
      className="inline-flex items-center gap-1.5 rounded-md border border-transparent px-2.5 py-1.5 text-sm text-muted transition-colors hover:border-border hover:bg-white/[0.03] hover:text-main disabled:opacity-40 disabled:cursor-not-allowed"
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
      <div className="rounded-md border border-border bg-inverted/55 px-2.5 py-1 text-xs font-mono text-surface/85">
        {sizeMB} MB
      </div>
    </div>
  );

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-border bg-inverted/35">
      {isImage ? (
        <div className="relative group">
          <div className="flex min-h-[200px] w-full max-h-[480px] items-center justify-center overflow-hidden bg-inverted/55">
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
        <div className="flex flex-col gap-3 bg-panel px-4 py-4">
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
            <div className="aspect-video flex flex-col items-center justify-center bg-panel">
              <Loader2 className="animate-spin text-primary" size={40} />
              <span className="text-muted text-xs mt-2">{Math.round(blobProgress * 100)}% loaded</span>
            </div>
          )}
          {blobStatus === "error" && (
            <div className="aspect-video flex items-center justify-center bg-panel">
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
              className="w-full max-h-[480px] bg-inverted"
            />
          )}
          {blobUrl && !expanded && (
            <div className="absolute inset-0 flex items-center justify-center bg-inverted/20 transition-colors group-hover:bg-inverted/35">
              <button className="flex h-14 w-14 items-center justify-center rounded-md border border-surface/12 bg-inverted/65 text-main transition-colors group-hover:bg-inverted/80">
                <Play fill="currentColor" size={24} className="ml-1" />
              </button>
            </div>
          )}
          {expanded && (
            <div className="absolute right-3 top-3 z-10 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
              <Link
                to={`/watch/${chunkMap.rootHash}`}
                className="rounded-md border border-surface/10 bg-inverted/65 p-1.5 text-surface/80 transition-colors hover:bg-inverted/80 hover:text-main"
                title="Open full page"
                onClick={(e) => e.stopPropagation()}
              >
                <Maximize size={14} />
              </Link>
              <button
                onClick={(e) => { e.stopPropagation(); handleCollapse(); }}
                className="rounded-md border border-surface/10 bg-inverted/65 p-1.5 text-surface/80 transition-colors hover:bg-inverted/80 hover:text-main"
                title="Collapse"
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div className="absolute bottom-3 left-3 z-10 pointer-events-none">{metaBadges}</div>
        </div>
      ) : null}

      <div className="border-t border-border bg-white/[0.03] p-3">
        <span className="text-sm font-medium">{chunkMap.title || "Untitled Media"}</span>
        <span className="mt-0.5 block truncate font-mono text-xs text-muted" title={chunkMap.rootHash}>
          hash: {chunkMap.rootHash.slice(0, 12)}...
        </span>
      </div>
    </div>
  );
}
