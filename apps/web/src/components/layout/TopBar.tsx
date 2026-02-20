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
    <header className="h-16 border-b border-border flex items-center justify-between px-6 sticky top-0 bg-background/80 backdrop-blur-md z-10">
      <Link to="/" className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center font-bold text-background">
          E
        </div>
        <span className="font-bold text-xl tracking-tight">Entropy</span>
      </Link>
      
      <div className="flex items-center gap-4">
        {pubkey ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-panel border border-border text-sm">
            <div className="w-2 h-2 rounded-full bg-accent"></div>
            <span className="font-mono text-muted">{pubkey.slice(0, 8)}...</span>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={onConnect}
              disabled={isConnecting}
              className="px-4 py-1.5 text-sm bg-primary/10 text-primary hover:bg-primary/20 rounded-full transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
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
    </header>
  );
}
