import { Link } from "react-router-dom";
import { useEntropyStore } from "../../stores/entropy-store";

interface TopBarProps {
  onConnect: () => Promise<void>;
  connectError: string | null;
  isConnecting?: boolean;
}

export function TopBar({ onConnect, connectError, isConnecting }: TopBarProps) {
  const { pubkey } = useEntropyStore();
  
  return (
    <header className="app-topbar sticky top-0 z-20">
      <div className="app-frame flex h-full items-center justify-between px-4 md:px-6">
        <Link to="/" className="flex items-center gap-3 text-inherit no-underline">
          <img src="/logo.svg" alt="Entropy logo" className="h-8 w-8" />
          <div className="flex flex-col leading-none">
            <span className="text-[1.05rem] font-semibold tracking-tight">Entropy</span>
            <span className="text-[0.72rem] text-muted">p2p network</span>
          </div>
        </Link>

        <div className="flex items-center gap-4">
        {pubkey ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-1.5 text-sm">
            <div className="h-2 w-2 rounded-full bg-accent"></div>
            <span className="font-mono text-[0.8rem] text-muted">{pubkey.slice(0, 8)}...</span>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={onConnect}
              disabled={isConnecting}
              className="button-secondary px-4 py-2 text-sm"
            >
              {isConnecting ? "Connecting..." : "Connect Extension"}
            </button>
            {connectError && (
              <span className="text-xs text-red-400 max-w-[220px] truncate" title={connectError}>
                {connectError}
              </span>
            )}
          </div>
        )}
        </div>
      </div>
    </header>
  );
}
