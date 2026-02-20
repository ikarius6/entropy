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
      <div className="flex-1 flex max-w-7xl mx-auto w-full px-6">
        <Sidebar />
        <main className="flex-1 py-6 px-8 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
