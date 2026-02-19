// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PeerStatus = "connecting" | "connected" | "disconnected";

export interface PeerEntry {
  pubkey: string;
  status: PeerStatus;
  connectedAt: number;
  connection: RTCPeerConnection;
}

export type PeerEventType = "peer-connected" | "peer-disconnected";
export type PeerEventCallback = (pubkey: string) => void;

// ---------------------------------------------------------------------------
// PeerManager — pool of WebRTC peer connections
// ---------------------------------------------------------------------------

export class PeerManager {
  private peers = new Map<string, PeerEntry>();
  private listeners = new Map<PeerEventType, Set<PeerEventCallback>>();

  /** Add a peer connection to the pool. */
  addPeer(pubkey: string, connection: RTCPeerConnection): void {
    const entry: PeerEntry = {
      pubkey,
      status: "connecting",
      connectedAt: Date.now(),
      connection
    };

    this.peers.set(pubkey, entry);

    connection.addEventListener("connectionstatechange", () => {
      const state = connection.connectionState;

      if (state === "connected") {
        entry.status = "connected";
        entry.connectedAt = Date.now();
        this.emit("peer-connected", pubkey);
      } else if (state === "disconnected" || state === "failed" || state === "closed") {
        entry.status = "disconnected";
        this.peers.delete(pubkey);
        this.emit("peer-disconnected", pubkey);
      }
    });
  }

  /** Remove a peer from the pool and close the connection. */
  removePeer(pubkey: string): void {
    const entry = this.peers.get(pubkey);

    if (entry) {
      entry.connection.close();
      this.peers.delete(pubkey);
      this.emit("peer-disconnected", pubkey);
    }
  }

  /** Get a peer connection by pubkey. */
  getPeer(pubkey: string): PeerEntry | undefined {
    return this.peers.get(pubkey);
  }

  /** List all active peers. */
  listPeers(): PeerEntry[] {
    return Array.from(this.peers.values());
  }

  /** Get the number of active peers. */
  get size(): number {
    return this.peers.size;
  }

  /** Register an event listener. */
  on(event: PeerEventType, callback: PeerEventCallback): void {
    let set = this.listeners.get(event);

    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }

    set.add(callback);
  }

  /** Remove an event listener. */
  off(event: PeerEventType, callback: PeerEventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  /** Close all peer connections and clear the pool. */
  disconnectAll(): void {
    for (const entry of this.peers.values()) {
      entry.connection.close();
    }

    this.peers.clear();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private emit(event: PeerEventType, pubkey: string): void {
    for (const callback of this.listeners.get(event) ?? []) {
      callback(pubkey);
    }
  }
}
