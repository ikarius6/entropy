import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Lock, Upload, Tv, Coins, Loader2, CheckCircle } from "lucide-react";
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

/**
 * Wraps multimedia content. If the user lacks credits, shows a locked
 * overlay with an ad placeholder and options to earn credits instead
 * of starting the P2P transfer.
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
  const [adState, setAdState] = useState<"idle" | "watching" | "complete">("idle");
  const [adProgress, setAdProgress] = useState(0);

  const isVideo = mimeType?.startsWith("video/");
  const isImage = mimeType?.startsWith("image/");
  const isAudio = mimeType?.startsWith("audio/");

  const mediaLabel = isVideo ? "video" : isImage ? "image" : isAudio ? "audio" : "content";

  const handleWatchAd = useCallback(() => {
    setAdState("watching");
    setAdProgress(0);
  }, []);

  // Simulate ad playback (15 seconds countdown)
  useEffect(() => {
    if (adState !== "watching") return;

    const AD_DURATION_MS = 15_000;
    const TICK_MS = 100;
    let elapsed = 0;

    const interval = setInterval(() => {
      elapsed += TICK_MS;
      setAdProgress(Math.min(elapsed / AD_DURATION_MS, 1));

      if (elapsed >= AD_DURATION_MS) {
        clearInterval(interval);
        setAdState("complete");
        // After ad completes, refresh credits — the extension would have
        // granted bonus credits via the ad callback in a real implementation.
        // For now we just refresh to pick up any seeding credits earned.
        void gate.refresh();
      }
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [adState, gate]);

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

      {/* Ad section */}
      <div className="credit-gate__ad-section">
        {adState === "idle" && (
          <>
            <p className="text-sm text-muted mb-3">
              Earn credits by watching a short ad or seeding content to the network.
            </p>
            <button onClick={handleWatchAd} className="credit-gate__btn credit-gate__btn--ad">
              <Tv size={18} />
              Watch Ad to Earn Credits
            </button>
          </>
        )}

        {adState === "watching" && (
          <div className="credit-gate__ad-player">
            <div className="credit-gate__ad-player-inner">
              {/* Simulated ad content */}
              <div className="credit-gate__ad-content">
                <Coins size={40} className="text-yellow-400 animate-pulse" />
                <p className="text-sm font-medium mt-2">Sponsor Message</p>
                <p className="text-xs text-muted mt-1">
                  Support the Entropy network — credits incoming…
                </p>
              </div>
              {/* Progress bar */}
              <div className="credit-gate__ad-progress-track">
                <div
                  className="credit-gate__ad-progress-fill"
                  style={{ width: `${Math.round(adProgress * 100)}%` }}
                />
              </div>
              <span className="text-xs text-muted mt-1">
                {Math.ceil((1 - adProgress) * 15)}s remaining
              </span>
            </div>
          </div>
        )}

        {adState === "complete" && (
          <div className="credit-gate__ad-complete">
            <CheckCircle size={24} className="text-green-400" />
            <p className="text-sm font-medium">Ad complete!</p>
            <p className="text-xs text-muted">
              Credits are being applied. If the content doesn't unlock,
              try seeding more content to earn additional credits.
            </p>
            <button onClick={() => void gate.refresh()} className="credit-gate__btn credit-gate__btn--refresh">
              <Loader2 size={16} />
              Refresh Credits
            </button>
          </div>
        )}
      </div>

      {/* Alternative: seed content */}
      <div className="credit-gate__earn-alt">
        <span className="text-xs text-muted">or</span>
        <Link to="/upload" className="credit-gate__btn credit-gate__btn--seed">
          <Upload size={16} />
          Upload & Seed Content to Earn Credits
        </Link>
      </div>
    </div>
  );
}
