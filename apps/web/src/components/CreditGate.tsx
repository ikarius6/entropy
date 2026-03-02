import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Lock, Upload, Share2, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { parseEntropyChunkMapTags, ENTROPY_TAG } from "@entropy/core";
import type { NostrEvent, EntropyChunkMap, RelayPool } from "@entropy/core";
import { checkLocalChunks, delegateSeeding } from "../lib/extension-bridge";
import { useEntropyStore } from "../stores/entropy-store";
import { KINDS } from "../lib/constants";
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

/** Fetch additional kind:7001 chunk maps from relays using a one-shot subscription (EOSE-based). */
function fetchChunkMapsFromRelays(
  relayPool: RelayPool,
  timeoutMs = 5000
): Promise<EntropyChunkMap[]> {
  return new Promise((resolve) => {
    const maps: EntropyChunkMap[] = [];

    const sub = relayPool.subscribe(
      [{ kinds: [KINDS.ENTROPY_CHUNK_MAP], [`#t`]: [ENTROPY_TAG], limit: 20 }],
      (event: NostrEvent) => {
        try {
          maps.push(parseEntropyChunkMapTags(event.tags));
        } catch {
          // skip malformed events
        }
      },
      () => {
        // EOSE — we have the initial batch, stop here
        sub.unsubscribe();
        resolve(maps);
      }
    );

    // Safety timeout in case EOSE never fires
    setTimeout(() => {
      sub.unsubscribe();
      resolve(maps);
    }, timeoutMs);
  });
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
  const [seedState, setSeedState] = useState<"idle" | "seeding" | "done" | "error">("idle");
  const [seedError, setSeedError] = useState<string | null>(null);
  const [seededCount, setSeededCount] = useState(0);

  const chunkMapCache = useEntropyStore((s) => s.chunkMapCache);
  const relayPool = useEntropyStore((s) => s.relayPool);

  const isVideo = mimeType?.startsWith("video/");
  const isImage = mimeType?.startsWith("image/");
  const isAudio = mimeType?.startsWith("audio/");
  const mediaLabel = isVideo ? "video" : isImage ? "image" : isAudio ? "audio" : "content";

  const handleSeedNetwork = useCallback(async () => {
    if (!relayPool) {
      setSeedError("No relay connection — open the feed first.");
      setSeedState("error");
      return;
    }

    setSeedState("seeding");
    setSeedError(null);

    try {
      // 1. Start with chunk maps already seen in the feed
      let candidates = Object.values(chunkMapCache);

      // 2. If few maps in cache, also fetch from relays (EOSE-based, 5s cap)
      const cachedCount = candidates.length;
      if (cachedCount < 10) {
        const fetched = await fetchChunkMapsFromRelays(relayPool);
        const seen = new Set(candidates.map((m) => m.rootHash));
        for (const m of fetched) {
          if (!seen.has(m.rootHash)) {
            candidates.push(m);
            seen.add(m.rootHash);
          }
        }
      }

      if (candidates.length === 0) {
        setSeedError("No content found to seed — browse the feed first or try again later.");
        setSeedState("error");
        return;
      }

      // 3. Filter to ONLY chunk maps whose chunks are fully stored locally.
      //    DELEGATE_SEEDING requires the extension to already have the data.
      const localChecks = await Promise.allSettled(
        candidates.map(async (map) => {
          const result = await checkLocalChunks(map.chunks);
          return { map, result };
        })
      );

      const localMaps = localChecks
        .filter(
          (r): r is PromiseFulfilledResult<{ map: EntropyChunkMap; result: { total: number; local: number; localBytes: number } }> =>
            r.status === "fulfilled" && r.value.result.local === r.value.result.total && r.value.result.total > 0
        )
        .map((r) => r.value.map);

      if (localMaps.length === 0) {
        setSeedError(
          "Your node hasn't cached these chunks locally yet. " +
          "Download some content first — once it's in your node's storage, " +
          "you can seed it to earn credits."
        );
        setSeedState("error");
        return;
      }

      // 4. Shuffle and pick up to the 50 MB cap
      const shuffled = [...localMaps].sort(() => Math.random() - 0.5);
      const selected: EntropyChunkMap[] = [];
      let totalBytes = 0;
      for (const map of shuffled) {
        if (totalBytes >= SEED_CAP_BYTES) break;
        selected.push(map);
        totalBytes += map.size;
      }

      // 5. Delegate — extension already has these chunks, so no IndexedDB error
      await Promise.all(
        selected.map((map) =>
          delegateSeeding({
            rootHash: map.rootHash,
            chunkHashes: map.chunks,
            size: map.size,
            chunkSize: map.chunkSize,
            mimeType: map.mimeType ?? "",
            title: map.title,
          })
        )
      );

      setSeededCount(selected.length);
      setSeedState("done");
      void gate.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.toLowerCase().includes("timeout");
      setSeedError(
        isTimeout
          ? "Entropy extension not found — install the browser extension to seed content."
          : msg
      );
      setSeedState("error");
    }
  }, [chunkMapCache, relayPool, gate]);

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

        {/* Option 2 — Seed network content */}
        {seedState === "idle" && (
          <button onClick={() => void handleSeedNetwork()} className="credit-gate__btn credit-gate__btn--ad">
            <Share2 size={16} />
            Seed Content from the Network
          </button>
        )}

        {seedState === "seeding" && (
          <div className="credit-gate__ad-player">
            <div className="credit-gate__ad-content">
              <Loader2 size={28} className="animate-spin text-primary" />
              <p className="text-sm font-medium mt-2">Finding content to seed…</p>
              <p className="text-xs text-muted mt-1">
                Fetching chunk maps and delegating to your node
              </p>
            </div>
          </div>
        )}

        {seedState === "done" && (
          <div className="credit-gate__ad-complete">
            <CheckCircle size={24} className="text-green-400" />
            <p className="text-sm font-medium">
              Now seeding {seededCount} item{seededCount !== 1 ? "s" : ""}!
            </p>
            <p className="text-xs text-muted">
              Credits will increase as peers download from you.
            </p>
            <button
              onClick={() => void gate.refresh()}
              className="credit-gate__btn credit-gate__btn--refresh"
            >
              <Loader2 size={16} />
              Refresh Balance
            </button>
          </div>
        )}

        {seedState === "error" && (
          <div className="credit-gate__ad-complete">
            <AlertCircle size={24} className="text-red-400" />
            <p className="text-xs text-muted mt-1">{seedError}</p>
            <button
              onClick={() => setSeedState("idle")}
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
