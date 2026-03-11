import { useState, useCallback, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { Lock, Upload, Share2, Loader2, CheckCircle, AlertCircle, Download } from "lucide-react";
import { SeederTagInput } from "./SeederTagInput";
import { discoverPopularContent } from "@entropy/core";
import type { PopularContent } from "@entropy/core";
import {
  checkLocalChunks,
  delegateSeeding,
  downloadForSeeding,
  subscribeToDownloadForSeedingProgress
} from "../lib/extension-bridge";
import type { DownloadForSeedingProgressPayload } from "../lib/extension-bridge";
import { useEntropyStore } from "../stores/entropy-store";
import type { CreditGateState } from "../hooks/useCreditGate";

interface CreditGateProps {
  gate: CreditGateState;
  contentTitle?: string;
  mimeType?: string;
  children: React.ReactNode;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 50 MB cap on how many bytes we volunteer to seed in one click */
const SEED_CAP_BYTES = 50 * 1024 * 1024;

type SeedPhase =
  | "idle"
  | "discovering"
  | "downloading"
  | "seeding"
  | "done"
  | "error";

interface DownloadProgress {
  currentItem: number;
  totalItems: number;
  downloadedChunks: number;
  totalChunks: number;
  contentTitle?: string;
  /** Phase reported by the extension for the current item */
  itemPhase: DownloadForSeedingProgressPayload["phase"];
}

/**
 * Wraps multimedia content. If the user lacks credits, shows a locked
 * overlay with two seed-to-earn options.
 */
export function CreditGate({ gate, contentTitle, mimeType, children }: CreditGateProps) {
  if (gate.isLoading) {
    return (
      <div className="credit-gate credit-gate--loading">
        <Loader2 className="animate-spin text-primary" size={32} />
        <span className="text-muted text-sm">Checking credits…</span>
      </div>
    );
  }

  if (gate.allowed) {
    return <>{children}</>;
  }

  return (
    <LockedOverlay
      gate={gate}
      contentTitle={contentTitle}
      mimeType={mimeType}
    />
  );
}

interface LockedOverlayProps {
  gate: CreditGateState;
  contentTitle?: string;
  mimeType?: string;
}

function LockedOverlay({ gate, contentTitle, mimeType }: LockedOverlayProps) {
  const [seedPhase, setSeedPhase] = useState<SeedPhase>("idle");
  const [seedError, setSeedError] = useState<string | null>(null);
  const [seededCount, setSeededCount] = useState(0);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [discovered, setDiscovered] = useState<PopularContent[]>([]);
  const [seededItems, setSeededItems] = useState<Array<{ rootHash: string; title: string }>>([]);

  const relayPool = useEntropyStore((s) => s.relayPool);
  const networkTags = useEntropyStore((s) => s.networkTags);
  const cancelledRef = useRef(false);

  const isVideo = mimeType?.startsWith("video/");
  const isImage = mimeType?.startsWith("image/");
  const isAudio = mimeType?.startsWith("audio/");
  const mediaLabel = isVideo ? "video" : isImage ? "image" : isAudio ? "audio" : "content";

  // Subscribe to progress push messages from the extension
  const progressCallbackRef = useRef<((p: DownloadForSeedingProgressPayload) => void) | null>(null);

  useEffect(() => {
    const unsub = subscribeToDownloadForSeedingProgress((p) => {
      progressCallbackRef.current?.(p);
    });
    return unsub;
  }, []);

  const handleSeedNetwork = useCallback(async () => {
    if (!relayPool) {
      setSeedError("No relay connection — open the feed first.");
      setSeedPhase("error");
      return;
    }

    cancelledRef.current = false;
    setSeedPhase("discovering");
    setSeedError(null);
    setProgress(null);
    setDiscovered([]);
    setSeededItems([]);

    try {
      // ── Phase 1: Discover popular content with few seeders ──
      const popular = await discoverPopularContent(relayPool, networkTags, {
        timeoutMs: 8_000,
        seederTimeoutMs: 4_000,
        demandTimeoutMs: 3_000,
        maxCandidates: 30
      });

      if (popular.length === 0) {
        setSeedError("No content found on the network — try again later.");
        setSeedPhase("error");
        return;
      }

      setDiscovered(popular);

      // ── Phase 2: Select items up to SEED_CAP, preferring already-local ──
      const localChecks = await Promise.allSettled(
        popular.map(async (pc) => {
          const result = await checkLocalChunks(pc.chunkMap.chunks);
          return { pc, allLocal: result.local === result.total && result.total > 0 };
        })
      );

      const fullyLocal: PopularContent[] = [];
      const needsDownload: PopularContent[] = [];

      for (const check of localChecks) {
        if (check.status === "fulfilled") {
          if (check.value.allLocal) {
            fullyLocal.push(check.value.pc);
          } else {
            needsDownload.push(check.value.pc);
          }
        }
      }

      const selected: { pc: PopularContent; needsDownload: boolean }[] = [];
      let totalBytes = 0;

      for (const pc of fullyLocal) {
        if (totalBytes >= SEED_CAP_BYTES) break;
        selected.push({ pc, needsDownload: false });
        totalBytes += pc.chunkMap.size;
      }

      for (const pc of needsDownload) {
        if (totalBytes >= SEED_CAP_BYTES) break;
        selected.push({ pc, needsDownload: true });
        totalBytes += pc.chunkMap.size;
      }

      if (selected.length === 0) {
        setSeedError("Could not find seedable content — try again later.");
        setSeedPhase("error");
        return;
      }

      // ── Phase 3: Download & seed via extension (parallel batched) ──
      setSeedPhase("downloading");
      let successCount = 0;

      for (let i = 0; i < selected.length; i++) {
        if (cancelledRef.current) break;

        const { pc, needsDownload: mustDownload } = selected[i];

        setProgress({
          currentItem: i + 1,
          totalItems: selected.length,
          downloadedChunks: 0,
          totalChunks: pc.chunkMap.chunks.length,
          contentTitle: pc.chunkMap.title,
          itemPhase: "downloading"
        });

        if (mustDownload) {
          // Wire up real-time progress from extension push messages
          progressCallbackRef.current = (p) => {
            if (p.rootHash !== pc.chunkMap.rootHash) return;
            setProgress((prev) =>
              prev
                ? { ...prev, downloadedChunks: p.downloadedChunks, totalChunks: p.totalChunks, itemPhase: p.phase }
                : prev
            );
            if (p.phase === "seeding") {
              setSeedPhase("seeding");
            }
          };

          try {
            await downloadForSeeding({
              rootHash: pc.chunkMap.rootHash,
              chunkHashes: pc.chunkMap.chunks,
              chunkSize: pc.chunkMap.chunkSize,
              size: pc.chunkMap.size,
              mimeType: pc.chunkMap.mimeType ?? "",
              title: pc.chunkMap.title,
              gatekeepers: pc.chunkMap.gatekeepers
            });
            successCount++;
            setSeededItems(prev => [...prev, { rootHash: pc.chunkMap.rootHash, title: pc.chunkMap.title ?? "" }]);
          } catch (dlErr) {
            console.warn("[CreditGate] downloadForSeeding failed:", dlErr);
          } finally {
            progressCallbackRef.current = null;
          }
        } else {
          // Already local — just delegate seeding
          await delegateSeeding({
            rootHash: pc.chunkMap.rootHash,
            chunkHashes: pc.chunkMap.chunks,
            size: pc.chunkMap.size,
            chunkSize: pc.chunkMap.chunkSize,
            mimeType: pc.chunkMap.mimeType ?? "",
            title: pc.chunkMap.title
          });
          successCount++;
          setSeededItems(prev => [...prev, { rootHash: pc.chunkMap.rootHash, title: pc.chunkMap.title ?? "" }]);
        }
      }

      if (successCount === 0) {
        setSeedError(
          "Could not download content from peers — they may be offline. Try again later."
        );
        setSeedPhase("error");
        return;
      }

      setSeededCount(successCount);
      setSeedPhase("done");
      void gate.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.toLowerCase().includes("timeout");
      setSeedError(
        isTimeout
          ? "Entropy extension not found — install the browser extension to seed content."
          : msg
      );
      setSeedPhase("error");
    }
  }, [relayPool, networkTags, gate]);

  return (
    <div className="credit-gate credit-gate--locked">
      {/* Blurred background pattern */}
      <div className="credit-gate__backdrop">
        <div className="credit-gate__pattern" />
      </div>

      {/* Lock icon */}
      <div className="credit-gate__icon">
        <Lock size={28} />
      </div>

      {/* Title */}
      <h3 className="credit-gate__title">
        {contentTitle
          ? `"${contentTitle}" requires credits`
          : `This ${mediaLabel} requires credits to view`}
      </h3>

      {/* Credit info */}
      <div className="credit-gate__info">
        <div className="credit-gate__info-row">
          <span className="text-muted">Required:</span>
          <span className="font-mono font-bold">{formatBytes(gate.required)}</span>
        </div>
        <div className="credit-gate__info-row">
          <span className="text-muted">Your balance:</span>
          <span className={`font-mono font-bold ${gate.balance <= 0 ? "text-red-400" : "text-yellow-400"}`}>
            {formatBytes(Math.max(0, gate.balance))}
          </span>
        </div>
        <div className="credit-gate__info-row credit-gate__info-row--deficit">
          <span className="text-muted">Deficit:</span>
          <span className="font-mono font-bold text-red-400">
            −{formatBytes(gate.deficit)}
          </span>
        </div>
      </div>

      {/* Earn credits section */}
      <div className="credit-gate__ad-section">
        <p className="text-sm text-muted mb-3">
          Earn credits by contributing to the network:
        </p>

        {/* Option 1 — Upload own content */}
        <Link to="/publish" className="credit-gate__btn credit-gate__btn--seed">
          <Upload size={16} />
          Upload &amp; Publish Your Content
        </Link>

        <span className="text-xs text-muted my-2">or</span>

        {/* Option 2 — Seed popular network content */}
        {seedPhase === "idle" && (
          <button onClick={() => void handleSeedNetwork()} className="credit-gate__btn credit-gate__btn--ad">
            <Share2 size={16} />
            Seed Popular Content
          </button>
        )}

        {seedPhase === "discovering" && (
          <div className="credit-gate__ad-player">
            <div className="credit-gate__ad-content">
              <Loader2 size={28} className="animate-spin text-primary" />
              <p className="text-sm font-medium mt-2">Discovering popular content…</p>
              <p className="text-xs text-muted mt-1">
                Finding high-demand content with few seeders
              </p>
            </div>
          </div>
        )}

        {seedPhase === "downloading" && progress && (
          <div className="credit-gate__ad-player">
            <div className="credit-gate__ad-content">
              <Download size={28} className="text-primary" />
              <p className="text-sm font-medium mt-2">
                Downloading {progress.currentItem}/{progress.totalItems}
                {progress.contentTitle ? ` — ${progress.contentTitle}` : ""}
              </p>
              <div className="w-full bg-surface rounded-full h-1.5 mt-2">
                <div
                  className="bg-primary h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.round((progress.downloadedChunks / Math.max(progress.totalChunks, 1)) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted mt-1">
                Chunk {progress.downloadedChunks}/{progress.totalChunks}
              </p>
              {discovered.length > 0 && (
                <p className="text-xs text-muted mt-1">
                  Found {discovered.length} items — top pick has {discovered[0].seederCount} seeder{discovered[0].seederCount !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          </div>
        )}

        {seedPhase === "seeding" && (
          <div className="credit-gate__ad-player">
            <div className="credit-gate__ad-content">
              <Loader2 size={28} className="animate-spin text-primary" />
              <p className="text-sm font-medium mt-2">Delegating to your node…</p>
            </div>
          </div>
        )}

        {seedPhase === "done" && (
          <div className="credit-gate__ad-complete">
            <CheckCircle size={24} className="text-green-400" />
            <p className="text-sm font-medium">
              Now seeding {seededCount} popular item{seededCount !== 1 ? "s" : ""}!
            </p>
            <p className="text-xs text-muted">
              Credits will increase as peers download from you.
            </p>

            {/* Tag seeded content — one hidden tag per item */}
            {seededItems.length > 0 && (
              <div className="w-full mt-3 flex flex-col gap-3">
                {seededItems.map((item) => (
                  <div key={item.rootHash} className="flex flex-col gap-1">
                    <span className="text-xs text-muted truncate" title={item.title}>
                      {item.title || item.rootHash.slice(0, 12) + "…"}
                    </span>
                    <SeederTagInput rootHash={item.rootHash} compact />
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => void gate.refresh()}
              className="credit-gate__btn credit-gate__btn--refresh"
            >
              <Loader2 size={16} />
              Refresh Balance
            </button>
          </div>
        )}

        {seedPhase === "error" && (
          <div className="credit-gate__ad-complete">
            <AlertCircle size={24} className="text-red-400" />
            <p className="text-xs text-muted mt-1">{seedError}</p>
            <button
              onClick={() => setSeedPhase("idle")}
              className="credit-gate__btn credit-gate__btn--refresh"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
