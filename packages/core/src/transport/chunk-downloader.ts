import type { EntropyChunkMap } from "../nostr/nip-entropy";
import type { PeerManager } from "./peer-manager";
import type { RelayPool } from "../nostr/client";
import type { SignalingChannel, SignalingMessage } from "./signaling-channel";
import { createRtcConfiguration } from "./nat-traversal";
import {
  encodeChunkRequest,
  createChunkReceiver,
  type ChunkRequestMessage,
} from "./chunk-transfer";
import { sha256Hex } from "../crypto/hash";
import { discoverSeeders } from "./seeder-discovery";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_CHANNEL_LABEL = "entropy";
const REQUEST_TIMEOUT_MS = 15_000;
const PEER_CONNECT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChunkDownloadOptions {
  chunkMap: EntropyChunkMap;
  peerManager: PeerManager;
  signalingChannel: SignalingChannel;
  myPubkey: string;
  relayPool: RelayPool;
  discoverPeers?: (rootHash: string) => Promise<string[]>;
  maxConcurrent?: number;
  isPeerBanned?: (peerPubkey: string) => boolean | Promise<boolean>;
  onPeerTransferSuccess?: (peerPubkey: string, bytes: number) => void | Promise<void>;
  onPeerFailedVerification?: (peerPubkey: string) => void | Promise<void>;
  onChunkReceived?: (index: number, data: ArrayBuffer) => void;
  onProgress?: (downloaded: number, total: number) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

// ---------------------------------------------------------------------------
// ChunkDownloader
// ---------------------------------------------------------------------------

export class ChunkDownloader {
  private readonly chunkMap: EntropyChunkMap;
  private readonly peerManager: PeerManager;
  private readonly signalingChannel: SignalingChannel;
  private readonly myPubkey: string;
  private readonly relayPool: RelayPool;
  private readonly discoverPeers: (rootHash: string) => Promise<string[]>;
  private readonly maxConcurrent: number;
  private readonly isPeerBanned?: (peerPubkey: string) => boolean | Promise<boolean>;
  private readonly onPeerTransferSuccess?: (peerPubkey: string, bytes: number) => void | Promise<void>;
  private readonly onPeerFailedVerification?: (peerPubkey: string) => void | Promise<void>;

  private readonly onChunkReceived?: (index: number, data: ArrayBuffer) => void;
  private readonly onProgress?: (downloaded: number, total: number) => void;
  private readonly onComplete?: () => void;
  private readonly onError?: (error: Error) => void;

  private downloadedChunks = new Map<number, ArrayBuffer>();
  private pendingChunks: number[] = [];
  private inFlightChunks = new Map<number, { peerId: string; timestamp: number }>();

  /** peerId → open DataChannel */
  private dataChannels = new Map<string, RTCDataChannel>();

  private isRunning = false;
  private isPaused = false;
  private connectedPeers = new Set<string>();

  /** Reverse lookup: chunkHash → chunk index (for incoming data messages) */
  private hashToIndex = new Map<string, number>();

  private cleanupSignaling: (() => void) | null = null;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  /** Track whether remote description has been set per peer, and buffer early ICE candidates */
  private remoteDescSet = new Set<string>();
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();

  constructor(options: ChunkDownloadOptions) {
    this.chunkMap = options.chunkMap;
    this.peerManager = options.peerManager;
    this.signalingChannel = options.signalingChannel;
    this.myPubkey = options.myPubkey;
    this.relayPool = options.relayPool;
    this.discoverPeers =
      options.discoverPeers ??
      ((rootHash: string) => discoverSeeders(this.relayPool, rootHash));
    this.maxConcurrent = options.maxConcurrent || 3;
    this.isPeerBanned = options.isPeerBanned;
    this.onPeerTransferSuccess = options.onPeerTransferSuccess;
    this.onPeerFailedVerification = options.onPeerFailedVerification;

    this.onChunkReceived = options.onChunkReceived;
    this.onProgress = options.onProgress;
    this.onComplete = options.onComplete;
    this.onError = options.onError;

    // Build lookup tables
    for (let i = 0; i < this.chunkMap.chunks.length; i++) {
      this.pendingChunks.push(i);
      this.hashToIndex.set(this.chunkMap.chunks[i], i);
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isPaused = false;

    if (this.chunkMap.chunks.length === 0) {
      this.onComplete?.();
      return;
    }

    try {
      const staticGatekeepers = this.chunkMap.gatekeepers || [];

      let dynamicGatekeepers: string[] = [];
      try {
        dynamicGatekeepers = await this.discoverPeers(this.chunkMap.rootHash);
      } catch (discoveryErr) {
        console.warn("[ChunkDownloader] dynamic seeder discovery failed:", discoveryErr);
      }

      const gatekeepers = [...new Set([...staticGatekeepers, ...dynamicGatekeepers])];
      if (gatekeepers.length === 0) {
        throw new Error("No gatekeepers found in chunk map");
      }

      // Listen for incoming signaling (answers + ICE candidates from peers)
      this.cleanupSignaling = this.signalingChannel.onSignal(
        this.myPubkey,
        (signal) => this.handleSignalingMessage(signal)
      );

      // Initiate WebRTC connections to each eligible gatekeeper via signaling
      const candidatePeers: string[] = [];
      for (const pk of gatekeepers) {
        if (pk === this.myPubkey) {
          continue;
        }

        const banned = await Promise.resolve(this.isPeerBanned?.(pk) ?? false);
        if (banned) {
          console.warn(`[ChunkDownloader] skipping banned peer ${pk.slice(0, 8)}…`);
          continue;
        }

        candidatePeers.push(pk);
      }

      if (candidatePeers.length === 0) {
        throw new Error("No eligible gatekeeper peers available");
      }

      const connectPromises = candidatePeers.map((pk) => this.connectToPeer(pk));

      // Wait for at least one peer connection (or all to fail)
      await Promise.allSettled(connectPromises);

      if (this.connectedPeers.size === 0 && this.isRunning) {
        throw new Error("Failed to connect to any gatekeeper peers");
      }

      this.scheduleNextRequests();
    } catch (err) {
      this.isRunning = false;
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  public pause(): void {
    this.isPaused = true;
  }

  public resume(): void {
    if (this.isPaused) {
      this.isPaused = false;
      this.scheduleNextRequests();
    }
  }

  public cancel(): void {
    this.isRunning = false;
    this.isPaused = false;

    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }

    this.cleanupSignaling?.();
    this.cleanupSignaling = null;

    // Close all data channels we opened
    for (const dc of this.dataChannels.values()) {
      try { dc.close(); } catch { /* ignore */ }
    }
    this.dataChannels.clear();

    this.peerManager.disconnectAll();
    this.connectedPeers.clear();
  }

  public getChunk(index: number): ArrayBuffer | null {
    return this.downloadedChunks.get(index) || null;
  }

  public hasChunk(index: number): boolean {
    return this.downloadedChunks.has(index);
  }

  public get downloadedCount(): number {
    return this.downloadedChunks.size;
  }

  // -----------------------------------------------------------------------
  // WebRTC connection setup via SignalingChannel
  // -----------------------------------------------------------------------

  private async connectToPeer(peerPubkey: string): Promise<void> {
    const rtcConfig = createRtcConfiguration();
    const pc = new RTCPeerConnection(rtcConfig);

    // Create the data channel on the offerer side
    const dc = pc.createDataChannel(DATA_CHANNEL_LABEL);
    this.setupDataChannel(dc, peerPubkey);

    // Add peer to PeerManager so it tracks connection state
    this.peerManager.addPeer(peerPubkey, pc);

    // Gather ICE candidates and forward them via signaling
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalingChannel.sendIceCandidate({
          targetPubkey: peerPubkey,
          candidate: event.candidate.toJSON(),
          rootHash: this.chunkMap.rootHash,
        });
      }
    };

    // Create and send the SDP offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.signalingChannel.sendOffer({
      targetPubkey: peerPubkey,
      sdp: offer,
      rootHash: this.chunkMap.rootHash,
    });

    // Wait for the data channel to open (or timeout)
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (!this.connectedPeers.has(peerPubkey)) {
          console.warn(`[ChunkDownloader] connection to ${peerPubkey.slice(0, 8)}… timed out`);
          this.peerManager.removePeer(peerPubkey);
        }
        resolve();
      }, PEER_CONNECT_TIMEOUT_MS);

      dc.onopen = () => {
        clearTimeout(timeout);
        this.connectedPeers.add(peerPubkey);
        this.dataChannels.set(peerPubkey, dc);
        console.log(`[ChunkDownloader] data channel open with ${peerPubkey.slice(0, 8)}…`);
        resolve();
      };
    });
  }

  private async handleSignalingMessage(signal: SignalingMessage): Promise<void> {
    // Only process signals related to our content
    if (signal.rootHash !== this.chunkMap.rootHash) return;

    const peer = this.peerManager.getPeer(signal.senderPubkey);
    if (!peer) return;

    const pc = peer.connection;
    const pk = signal.senderPubkey;

    try {
      if (signal.type === "answer") {
        if (this.remoteDescSet.has(pk)) {
          return; // ignore duplicate answers from multiple relays
        }
        const sdp = signal.payload as RTCSessionDescriptionInit;
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        this.remoteDescSet.add(pk);

        // Flush buffered ICE candidates
        const buffered = this.pendingCandidates.get(pk) ?? [];
        for (const c of buffered) {
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* skip stale */ }
        }
        this.pendingCandidates.delete(pk);
      } else if (signal.type === "ice-candidate") {
        const candidate = signal.payload as RTCIceCandidateInit;
        if (!this.remoteDescSet.has(pk)) {
          // Buffer until remote description is set
          let buf = this.pendingCandidates.get(pk);
          if (!buf) { buf = []; this.pendingCandidates.set(pk, buf); }
          buf.push(candidate);
        } else {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      }
    } catch (err) {
      console.warn(`[ChunkDownloader] signaling error from ${signal.senderPubkey.slice(0, 8)}…:`, err);
    }
  }

  // -----------------------------------------------------------------------
  // DataChannel management
  // -----------------------------------------------------------------------

  private setupDataChannel(dc: RTCDataChannel, peerId: string): void {
    dc.binaryType = "arraybuffer";
    const receiver = createChunkReceiver();

    dc.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;

      try {
        const message = receiver.receive(event.data);
        if (!message) return;

        if (message.type === "CHUNK_DATA") {
          const index = this.hashToIndex.get(message.chunkHash);
          if (index !== undefined) {
            this.handleReceivedChunk(peerId, index, message.data);
          }
        } else if (message.type === "CHUNK_ERROR") {
          const index = this.hashToIndex.get(message.chunkHash);
          if (index !== undefined) {
            console.warn(`[ChunkDownloader] peer ${peerId.slice(0, 8)}… returned error for chunk ${index}: ${message.reason}`);
            this.handleChunkError(index);
          }
        }
      } catch (err) {
        console.warn("[ChunkDownloader] failed to decode incoming message:", err);
      }
    };

    dc.onclose = () => {
      this.connectedPeers.delete(peerId);
      this.dataChannels.delete(peerId);

      // Re-queue any in-flight chunks assigned to this peer
      for (const [index, info] of Array.from(this.inFlightChunks.entries())) {
        if (info.peerId === peerId) {
          this.handleChunkError(index);
        }
      }
    };

    dc.onerror = () => {
      console.warn(`[ChunkDownloader] data channel error with ${peerId.slice(0, 8)}…`);
    };
  }

  // -----------------------------------------------------------------------
  // Chunk scheduling & requesting
  // -----------------------------------------------------------------------

  private scheduleNextRequests(): void {
    if (!this.isRunning || this.isPaused) return;

    if (this.downloadedChunks.size === this.chunkMap.chunks.length) {
      this.isRunning = false;
      this.cleanupSignaling?.();
      this.cleanupSignaling = null;
      this.onComplete?.();
      return;
    }

    const availablePeers = Array.from(this.connectedPeers).filter(
      (pk) => this.dataChannels.has(pk)
    );

    if (availablePeers.length === 0) {
      // Wait for peers to become available
      this.timeoutHandle = setTimeout(() => this.scheduleNextRequests(), 1000);
      return;
    }

    // Assign pending chunks to peers (round-robin)
    let assigned = 0;
    while (this.inFlightChunks.size < this.maxConcurrent && this.pendingChunks.length > 0) {
      const chunkIndex = this.pendingChunks.shift()!;
      const peerId = availablePeers[assigned % availablePeers.length];
      assigned++;

      this.inFlightChunks.set(chunkIndex, { peerId, timestamp: Date.now() });

      this.requestChunkFromPeer(peerId, chunkIndex).catch((err) => {
        console.error(`[ChunkDownloader] request chunk ${chunkIndex} from ${peerId.slice(0, 8)}… failed:`, err);
        this.handleChunkError(chunkIndex);
      });
    }

    // Check for timed-out requests
    const now = Date.now();
    for (const [index, info] of Array.from(this.inFlightChunks.entries())) {
      if (now - info.timestamp > REQUEST_TIMEOUT_MS) {
        console.warn(`[ChunkDownloader] chunk ${index} timed out`);
        this.handleChunkError(index);
      }
    }
  }

  private async requestChunkFromPeer(peerId: string, index: number): Promise<void> {
    const chunkHash = this.chunkMap.chunks[index];
    if (!chunkHash) throw new Error(`Invalid chunk index ${index}`);

    const dc = this.dataChannels.get(peerId);
    if (!dc || dc.readyState !== "open") {
      throw new Error(`No open data channel for peer ${peerId.slice(0, 8)}…`);
    }

    const request: ChunkRequestMessage = {
      type: "CHUNK_REQUEST",
      requesterPubkey: this.myPubkey,
      rootHash: this.chunkMap.rootHash,
      chunkHash,
    };

    dc.send(encodeChunkRequest(request));
  }

  // -----------------------------------------------------------------------
  // Chunk verification & handling
  // -----------------------------------------------------------------------

  private handleReceivedChunk(peerId: string, index: number, data: ArrayBuffer): void {
    if (!this.inFlightChunks.has(index)) return;

    const expectedHash = this.chunkMap.chunks[index];
    const chunkData = new Uint8Array(data);

    sha256Hex(chunkData)
      .then((actualHash: string) => {
        if (actualHash === expectedHash) {
          this.inFlightChunks.delete(index);
          this.downloadedChunks.set(index, data);

          void Promise.resolve(this.onPeerTransferSuccess?.(peerId, data.byteLength)).catch((err) => {
            console.warn(
              `[ChunkDownloader] failed to record peer success for ${peerId.slice(0, 8)}…:`,
              err
            );
          });

          this.onChunkReceived?.(index, data);
          this.onProgress?.(this.downloadedChunks.size, this.chunkMap.chunks.length);

          this.scheduleNextRequests();
        } else {
          console.error(`[ChunkDownloader] invalid hash for chunk ${index} from ${peerId.slice(0, 8)}…`);

          void Promise.resolve(this.onPeerFailedVerification?.(peerId)).catch((err) => {
            console.warn(
              `[ChunkDownloader] failed to record peer verification failure for ${peerId.slice(0, 8)}…:`,
              err
            );
          });

          this.handleChunkError(index);
        }
      })
      .catch((err: unknown) => {
        console.error(`[ChunkDownloader] hash verification failed for chunk ${index}:`, err);
        this.handleChunkError(index);
      });
  }

  private handleChunkError(index: number): void {
    this.inFlightChunks.delete(index);
    if (!this.pendingChunks.includes(index) && !this.downloadedChunks.has(index)) {
      this.pendingChunks.unshift(index);
    }
    this.scheduleNextRequests();
  }
}
