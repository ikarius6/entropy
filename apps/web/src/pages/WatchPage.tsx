import { useParams, Link } from "react-router-dom";
import { useEntropyStore } from "../stores/entropy-store";
import { useEffect, useState } from "react";
import { useChunkDownload } from "../hooks/useChunkDownload";
import { useChunkBlob } from "../hooks/useChunkBlob";
import { useCreditGate } from "../hooks/useCreditGate";
import { CreditGate } from "../components/CreditGate";
import { VideoPlayer } from "../components/player/VideoPlayer";
import { Server, Download, ShieldCheck, Loader2, Heart, Share2, Repeat2, ShieldAlert, FileDown } from "lucide-react";
import { SeederTagInput } from "../components/SeederTagInput";
import { parseEntropyChunkMapTags, type EntropyChunkMap, type NostrEvent } from "@entropy/core";
import { KINDS } from "../lib/constants";
import { AvatarBadge } from "../components/profile/ProfileHeader";
import { useNostrProfile } from "../hooks/useNostrProfile";
import { useReactions } from "../hooks/useReactions";
import { useRepost } from "../hooks/useRepost";
import { useReplies } from "../hooks/useReplies";
import { ReplyComposer } from "../components/feed/ReplyComposer";
import { ReplyCard } from "../components/feed/PostCard";
import { SmartContent } from "../components/feed/SmartContent";

export default function WatchPage() {
  const { rootHash } = useParams<{ rootHash: string }>();
  const [event, setEvent] = useState<NostrEvent | null>(null);
  const [chunkMap, setChunkMap] = useState<EntropyChunkMap | null>(null);
  const [authorPubkey, setAuthorPubkey] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const { relayPool, relayUrls, chunkMapCache } = useEntropyStore();
  const { profile } = useNostrProfile(authorPubkey || null);

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

  // Fetch the kind:7001 event directly from relays by x-hash tag, OR fetch kind:1 if it's an ID
  useEffect(() => {
    if (!rootHash || !relayPool || relayUrls.length === 0) return;

    let found = false;
    // We can confidently render video from cache right away, but we STILL need to
    // query the relay to get the actual `NostrEvent` for its `id` and `created_at` 
    // to map Reactions and Replies correctly.

    const sub = relayPool.subscribe(
      [
        { ids: [rootHash] }, // Try as a normal event ID first (e.g. text post)
        { kinds: [KINDS.ENTROPY_CHUNK_MAP], limit: 500 } // Broad fetch — client-side x-hash match below
      ],
      (ev: NostrEvent) => {
        if (found) return;

        // 1. Direct ID match (e.g., a text post)
        if (ev.id === rootHash) {
          found = true;
          setEvent(ev);
          setAuthorPubkey(ev.pubkey);
          if (ev.kind === KINDS.ENTROPY_CHUNK_MAP) {
            try { setChunkMap(parseEntropyChunkMapTags(ev.tags)); } catch {}
          }
          sub.unsubscribe();
          return;
        }

        // 2. Hash match (a media post)
        const xHashTag = ev.tags.find(t => t[0] === "x-hash");
        if (xHashTag && xHashTag[1] === rootHash) {
          try {
            const parsed = parseEntropyChunkMapTags(ev.tags);
            found = true;
            setEvent(ev);
            setChunkMap(parsed);
            setAuthorPubkey(ev.pubkey);
            sub.unsubscribe();
          } catch (e) {
            console.warn(`[WatchPage] failed to parse event:`, e);
          }
        }
      },
      () => {
        if (!found && !chunkMapCache[rootHash!]) {
          setError("Content not found. Make sure you are connected to the right relays.");
        }
      }
    );

    return () => { sub.unsubscribe(); };
  }, [rootHash, relayPool, relayUrls.join(",")]);

  const isMedia = event?.kind === KINDS.ENTROPY_CHUNK_MAP || !!chunkMap;
  
  // Credit gate: check balance before initiating any P2P transfer (only applies to media)
  const contentSize = chunkMap?.size || 0;
  const chunkHashes = chunkMap?.chunks;
  const gate = useCreditGate({
    contentSizeBytes: contentSize,
    authorPubkey,
    chunkHashes,
  });

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
  const isPdf = mime === "application/pdf";
  const isVideo = mime.startsWith("video/");
  const isUnknown = !isImage && !isAudio && !isPdf && !isVideo && !!chunkMap;

  function handleDownload() {
    if (!blobUrl || !chunkMap) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = chunkMap.title || rootHash || "entropy-file";
    a.click();
  }

  // Interactions Layer
  const { counts: reactionCounts, total: reactionTotal, myReaction, react, isReacting } = useReactions(event?.id || "", event?.pubkey || "");
  const { reposted, isBusy: repostBusy, count: repostCount, toggle: toggleRepost } = useRepost(event?.id || "");
  const { replies, isLoading: repliesLoading, load: loadReplies, isLoaded: repliesLoaded } = useReplies(event?.id || "");
  const [showComposer, setShowComposer] = useState(false);
  const actionBaseClass = "inline-flex items-center gap-1.5 rounded-md border border-transparent px-3 py-1.5 text-sm transition-colors";

  // Auto-load replies when event is resolved
  useEffect(() => {
    if (event?.id) loadReplies();
  }, [event?.id, loadReplies]);

  if (error) {
    return (
      <div className="empty-state mx-auto mt-12 flex min-h-[40vh] max-w-2xl flex-col items-center justify-center gap-4 px-8 py-10 text-center">
        <h2 className="text-lg font-semibold text-red-400">Error</h2>
        <p className="max-w-md text-sm text-muted">{error}</p>
      </div>
    );
  }

  if (!chunkMap && !event) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
        <Loader2 className="animate-spin text-primary" size={48} />
        <p className="text-sm text-muted">Resolving content...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[60rem] flex-col gap-6 pb-24">
      {/* ─── Main Post Card (unified author + content + media) ─────────── */}
      <div className="panel flex flex-col gap-4 px-5 py-4 md:px-6">
        {/* Author header */}
        {event && (
          <div className="flex items-start gap-3">
            <AvatarBadge profile={profile} pubkey={event.pubkey} size="md" />
            <div className="min-w-0 flex flex-1 flex-col gap-1">
              <Link to={`/profile/${event.pubkey}`} className="text-[1.05rem] font-semibold tracking-tight hover:underline">
                {profile?.name || profile?.displayName || "Anonymous Node"}
              </Link>
              <span className="font-mono text-[0.78rem] text-muted">{event.pubkey.slice(0, 12)}...</span>
            </div>
            <span className="text-right text-sm text-muted">
              {event ? new Date(event.created_at * 1000).toLocaleString() : ""}
            </span>
          </div>
        )}

        {/* Text content (description) — shown inline above media like Feed */}
        {event?.content && (
          <div className="mt-1 text-[15px]">
            <SmartContent content={event.content} />
          </div>
        )}

        {/* Media rendering — gated by credits */}
        {isMedia && chunkMap && (
          <CreditGate gate={gate} contentTitle={chunkMap.title} mimeType={chunkMap.mimeType}>
            <div className="mt-1 overflow-hidden rounded-md border border-border bg-inverted/35">
              <div className="flex min-h-[280px] w-full items-center justify-center bg-inverted/55">
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
                  <div className="flex w-full flex-col items-center gap-4 p-8">
                    <div className="text-6xl">🎵</div>
                    <audio controls src={blobUrl} className="w-full max-w-lg" autoPlay />
                  </div>
                )}
                {blobStatus === "ready" && blobUrl && isVideo && (
                  <video controls src={blobUrl} className="w-full max-h-[70vh]" autoPlay />
                )}
                {blobStatus === "ready" && blobUrl && isPdf && (
                  <object
                    data={blobUrl}
                    type="application/pdf"
                    className="h-[70vh] w-full"
                  >
                    <div className="flex flex-col items-center justify-center gap-3 py-10">
                      <span className="text-muted text-sm">PDF preview not supported in this browser.</span>
                      <a
                        href={blobUrl}
                        download={chunkMap.title || rootHash || "entropy-file"}
                        className="inline-flex items-center gap-2 rounded-md border border-border bg-white/[0.04] px-4 py-2 text-sm font-medium text-main transition-colors hover:bg-white/[0.08]"
                      >
                        <Download size={15} /> Download PDF
                      </a>
                    </div>
                  </object>
                )}
                {isUnknown && blobStatus !== "loading" && blobStatus !== "error" && (
                  <div className="flex flex-col items-center gap-4 px-6 py-10">
                    <FileDown size={48} className="text-muted" />
                    <span className="text-sm font-medium text-main">
                      {chunkMap.title || "Downloadable file"}
                    </span>
                    <span className="font-mono text-xs text-muted">{mime || "Unknown type"} · {(chunkMap.size / 1024 / 1024).toFixed(2)} MB</span>
                    {blobStatus === "ready" && blobUrl && (
                      <a
                        href={blobUrl}
                        download={chunkMap.title || rootHash || "entropy-file"}
                        className="inline-flex items-center gap-2 rounded-md border border-border bg-white/[0.04] px-5 py-2.5 text-sm font-medium text-main transition-colors hover:bg-white/[0.08]"
                      >
                        <Download size={15} /> Download file
                      </a>
                    )}
                    <div className="mt-1 flex items-start gap-2 rounded-md border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs leading-relaxed text-amber-300/90">
                      <ShieldAlert size={16} className="mt-0.5 flex-shrink-0" />
                      <span>
                        Be careful when downloading files from unknown sources.
                        Only open files you trust — they may contain harmful content.
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Media info footer */}
              <div className="flex items-center justify-between gap-4 border-t border-border bg-white/[0.03] p-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{chunkMap.title || "Untitled Media"}</span>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <span className="flex items-center gap-1"><ShieldCheck size={12} className="text-green-400" /> Verified</span>
                    <span className="flex items-center gap-1"><Server size={12} /> {chunkMap.chunks.length} chunks</span>
                    {chunkMap.mimeType && <span className="font-mono">{chunkMap.mimeType}</span>}
                    <span>{(chunkMap.size / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                </div>
                <div className="shrink-0">
                  <button
                    onClick={handleDownload}
                    disabled={blobStatus !== "ready" || !gate.allowed}
                    className="button-primary px-3 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Download size={15} />
                    {!gate.allowed ? "No Credits" : blobStatus === "loading" ? `${Math.round(blobProgress * 100)}%` : "Save"}
                  </button>
                </div>
              </div>

              {/* Seeder tag input — visible after full download */}
              {blobStatus === "ready" && (
                <div className="border-t border-border bg-white/[0.02] px-3 py-2.5">
                  <SeederTagInput rootHash={chunkMap.rootHash} />
                </div>
              )}
            </div>
          </CreditGate>
        )}

        {/* Action Bar */}
        {event && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-3">
            <button
              onClick={() => react("❤️")}
              disabled={isReacting}
              className={`${actionBaseClass} ${
                myReaction ? "border-red-400/20 bg-red-400/10 text-red-400" : "text-muted hover:border-border hover:bg-white/[0.03] hover:text-red-400"
              } disabled:opacity-50`}
            >
              <Heart size={16} fill={myReaction ? "currentColor" : "none"} />
              {reactionTotal > 0 && <span className="tabular-nums">{reactionTotal}</span>}
            </button>

            {Object.entries(reactionCounts).filter(([emoji]) => emoji !== "❤️").sort(([,a], [,b]) => b - a).map(([emoji, count]) => (
              <button key={emoji} onClick={() => react(emoji)} className="inline-flex items-center gap-1 rounded-md border border-transparent px-2.5 py-1.5 text-sm text-muted transition-colors hover:border-border hover:bg-white/[0.03] hover:text-main">
                {emoji} {count}
              </button>
            ))}

            {/* 🔁 Repost */}
            <button
              onClick={() => {
                if (repostBusy || !event) return;
                toggleRepost({
                  id: event.id,
                  pubkey: event.pubkey,
                  kind: event.kind,
                  content: event.content,
                  created_at: event.created_at,
                  tags: event.tags,
                });
              }}
              disabled={repostBusy}
              title={reposted ? "Undo repost" : "Repost"}
              className={`${actionBaseClass} ${
                reposted
                  ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-400"
                  : "text-muted hover:border-border hover:bg-white/[0.03] hover:text-emerald-400"
              } disabled:opacity-50`}
            >
              <Repeat2 size={16} />
              {repostBusy ? "…" : repostCount > 0 ? <span className="tabular-nums">{repostCount}</span> : null}
            </button>

            <button
              onClick={async () => {
                const url = window.location.href;
                if (navigator.share) {
                  try { await navigator.share({ url }); return; } catch {}
                }
                await navigator.clipboard.writeText(url);
              }}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-transparent px-3 py-1.5 text-sm text-muted transition-colors hover:border-border hover:bg-white/[0.03] hover:text-main"
            >
              <Share2 size={16} /> Share
            </button>
          </div>
        )}
      </div>

      {/* ─── Threaded Replies Section ──────────────────────────────────── */}
      {event && (
        <div className="flex flex-col gap-4">
          <h3 className="text-[1.05rem] font-semibold">Replies {repliesLoaded && replies.length > 0 && <span className="text-sm font-normal text-muted">({replies.length})</span>}</h3>

          <div className="panel flex flex-col gap-5 px-5 py-4">
            {(!repliesLoaded || repliesLoading) && (
              <div className="flex items-center gap-2 text-muted text-sm py-4">
                <Loader2 size={16} className="animate-spin" /> Loading thread…
              </div>
            )}

            {repliesLoaded && replies.length === 0 && !showComposer && (
              <div className="empty-state py-8 text-center text-sm text-muted">
                No replies yet. Be the first to join the conversation!
              </div>
            )}

            <div className="flex flex-col gap-5">
              {replies.map(reply => (
                <div key={reply.id} className="border-b border-border/40 pb-5 last:border-0 last:pb-0">
                  <ReplyCard item={reply} />
                </div>
              ))}
            </div>

            <div className="pt-2">
              {!showComposer ? (
                <button
                  onClick={() => setShowComposer(true)}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  + Write a reply…
                </button>
              ) : (
                <ReplyComposer
                  replyTo={{
                    rootId: event.tags.find(t => t[0] === "e" && t[3] === "root")?.[1] ?? event.id,
                    parentId: event.id,
                    authorPubkey: event.pubkey
                  }}
                  onReplied={() => {
                    setShowComposer(false);
                    loadReplies();
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
