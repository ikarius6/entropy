import { ReactNode, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { useNostrIdentity } from "../../hooks/useNostrIdentity";
import { useEntropyStore } from "../../stores/entropy-store";
import { DEFAULT_RELAY_URLS } from "../../lib/constants";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { connect, error, isConnecting } = useNostrIdentity();
  const { initRelays, relayPool } = useEntropyStore();

  useEffect(() => {
    if (!relayPool) {
      console.log("[AppLayout] initializing relay pool:", DEFAULT_RELAY_URLS);
      initRelays(DEFAULT_RELAY_URLS);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-background text-white flex flex-col">
      <TopBar onConnect={connect} connectError={error} isConnecting={isConnecting} />
      <div className="app-frame flex-1 w-full px-4 md:px-6">
        <div className="flex h-full flex-col md:flex-row md:gap-8">
        <Sidebar />
          <main className="min-w-0 flex-1 py-6 md:py-8 md:pr-2">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
