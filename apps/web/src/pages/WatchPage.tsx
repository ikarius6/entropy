import { useParams } from "react-router-dom";
import { useEntropyStore } from "../stores/entropy-store";
import { useEffect, useState } from "react";
import { useChunkDownload } from "../hooks/useChunkDownload";
import { useChunkBlob } from "../hooks/useChunkBlob";
import { useCreditGate } from "../hooks/useCreditGate";
import { CreditGate } from "../components/CreditGate";
import { VideoPlayer } from "../components/player/VideoPlayer";
import { Server, Download, ShieldCheck, Loader2, Heart, Share2 } from "lucide-react";
import { parseEntropyChunkMapTags, type EntropyChunkMap, type NostrEvent } from "@entropy/core";
import { KINDS } from "../lib/constants";
import { AvatarBadge } from "../components/profile/ProfileHeader";
import { useNostrProfile } from "../hooks/useNostrProfile";
import { useReactions } from "../hooks/useReactions";
import { useReplies } from "../hooks/useReplies";
import { ReplyComposer } from "../components/feed/ReplyComposer";
import { ReplyCard } from "../components/feed/PostCard";

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
  const isVideo = mime.startsWith("video/") || (!isImage && !isAudio && !!chunkMap);

  function handleDownload() {
    if (!blobUrl || !chunkMap) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = chunkMap.title || rootHash || "entropy-file";
    a.click();
  }

  // Interactions Layer
  const { counts: reactionCounts, total: reactionTotal, myReaction, react, isReacting } = useReactions(event?.id || "", event?.pubkey || "");
  const { replies, isLoading: repliesLoading, load: loadReplies, isLoaded: repliesLoaded } = useReplies(event?.id || "");
  const [showComposer, setShowComposer] = useState(false);

  // Auto-load replies when event is resolved
  useEffect(() => {
    if (event?.id) loadReplies();
  }, [event?.id, loadReplies]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center gap-4 border border-dashed border-border rounded-xl p-8 bg-white/5 mx-auto max-w-2xl mt-12">
        <h2 className="text-xl font-bold text-red-400">Error</h2>
        <p className="text-muted max-w-md">{error}</p>
      </div>
    );
  }

  if (!chunkMap && !event) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center gap-4">
        <Loader2 className="animate-spin text-primary" size={48} />
        <p className="text-muted">Resolving content...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full pb-24">
      {/* ─── Main Post Card (unified author + content + media) ─────────── */}
      <div className="panel p-5 flex flex-col gap-3">
        {/* Author header */}
        {event && (
          <div className="flex items-center gap-3">
            <AvatarBadge profile={profile} pubkey={event.pubkey} size="md" />
            <div className="flex flex-col">
              <span className="font-bold text-lg">
                {profile?.name || profile?.displayName || "Anonymous Node"}
              </span>
              <span className="text-muted text-sm font-mono">{event.pubkey.slice(0, 12)}...</span>
            </div>
            <span className="ml-auto text-muted text-sm">
              {event ? new Date(event.created_at * 1000).toLocaleString() : ""}
            </span>
          </div>
        )}

        {/* Text content (description) — shown inline above media like Feed */}
        {event?.content && (
          <div className="text-white/90 whitespace-pre-wrap break-words leading-relaxed text-[15px] mt-1">
            {event.content}
          </div>
        )}

        {/* Media rendering — gated by credits */}
        {isMedia && chunkMap && (
          <CreditGate gate={gate} contentTitle={chunkMap.title} mimeType={chunkMap.mimeType}>
            <div className="mt-1 rounded-xl overflow-hidden border border-border bg-black/40">
              <div className="w-full flex items-center justify-center min-h-[280px] bg-black/60">
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

              {/* Media info footer */}
              <div className="p-3 bg-white/5 border-t border-border flex items-center justify-between gap-4">
                <div className="flex flex-col min-w-0">
                  <span className="font-medium text-sm truncate">{chunkMap.title || "Untitled Media"}</span>
                  <div className="flex items-center gap-3 text-xs text-muted mt-0.5">
                    <span className="flex items-center gap-1"><ShieldCheck size={12} className="text-green-400" /> Verified</span>
                    <span className="flex items-center gap-1"><Server size={12} /> {chunkMap.chunks.length} chunks</span>
                    {chunkMap.mimeType && <span className="font-mono">{chunkMap.mimeType}</span>}
                    <span>{(chunkMap.size / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleDownload}
                    disabled={blobStatus !== "ready" || !gate.allowed}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold bg-primary text-background hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Download size={15} />
                    {!gate.allowed ? "No Credits" : blobStatus === "loading" ? `${Math.round(blobProgress * 100)}%` : "Save"}
                  </button>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold bg-white/5 text-white hover:bg-white/10 transition-colors">
                    <Server size={15} /> Seed
                  </button>
                </div>
              </div>
            </div>
          </CreditGate>
        )}

        {/* Action Bar */}
        {event && (
          <div className="flex items-center gap-1 mt-2 pt-3 border-t border-border/50">
            <button
              onClick={() => react("❤️")}
              disabled={isReacting}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-all ${
                myReaction ? "text-red-400 bg-red-400/10" : "text-muted hover:text-red-400 hover:bg-red-400/10"
              } disabled:opacity-50`}
            >
              <Heart size={16} fill={myReaction ? "currentColor" : "none"} />
              {reactionTotal > 0 && <span className="tabular-nums font-medium">{reactionTotal}</span>}
            </button>

            {Object.entries(reactionCounts).filter(([emoji]) => emoji !== "❤️").sort(([,a], [,b]) => b - a).map(([emoji, count]) => (
              <button key={emoji} onClick={() => react(emoji)} className="flex items-center gap-1 text-sm px-2.5 py-1.5 rounded-lg text-muted hover:bg-white/5 transition-colors">
                {emoji} {count}
              </button>
            ))}

            <button
              onClick={async () => {
                const url = window.location.href;
                if (navigator.share) {
                  try { await navigator.share({ url }); return; } catch {}
                }
                await navigator.clipboard.writeText(url);
              }}
              className="flex items-center gap-1.5 text-sm text-muted hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5 ml-auto"
            >
              <Share2 size={16} /> Share
            </button>
          </div>
        )}
      </div>

      {/* ─── Threaded Replies Section ──────────────────────────────────── */}
      {event && (
        <div className="flex flex-col gap-4">
          <h3 className="text-lg font-bold">Replies {repliesLoaded && replies.length > 0 && <span className="text-muted font-normal text-sm">({replies.length})</span>}</h3>

          <div className="panel p-5 flex flex-col gap-6">
            {(!repliesLoaded || repliesLoading) && (
              <div className="flex items-center gap-2 text-muted text-sm py-4">
                <Loader2 size={16} className="animate-spin" /> Loading thread…
              </div>
            )}

            {repliesLoaded && replies.length === 0 && !showComposer && (
              <div className="text-center py-8 text-muted">
                No replies yet. Be the first to join the conversation!
              </div>
            )}

            <div className="flex flex-col gap-5">
              {replies.map(reply => (
                <div key={reply.id} className="pb-5 border-b border-border/40 last:border-0 last:pb-0">
                  <ReplyCard item={reply} />
                </div>
              ))}
            </div>

            <div className="pt-2">
              {!showComposer ? (
                <button
                  onClick={() => setShowComposer(true)}
                  className="text-primary font-medium hover:underline text-sm"
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
