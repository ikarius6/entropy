import {
  type EntropyChunkMap,
  type PeerManager,
  type RelayPool,
  type SignalingChannel,
  encodeChunkRequest,
  type ChunkRequestMessage,
  sha256Hex
} from "../index";

export interface ChunkDownloadOptions {
  chunkMap: EntropyChunkMap;
  peerManager: PeerManager;
  signalingChannel: SignalingChannel;
  myPubkey: string;
  relayPool: RelayPool;
  maxConcurrent?: number;
  onChunkReceived?: (index: number, data: ArrayBuffer) => void;
  onProgress?: (downloaded: number, total: number) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

export class ChunkDownloader {
  private readonly chunkMap: EntropyChunkMap;
  private readonly peerManager: PeerManager;
  private readonly signalingChannel: SignalingChannel;
  private readonly myPubkey: string;
  private readonly maxConcurrent: number;
  
  private readonly onChunkReceived?: (index: number, data: ArrayBuffer) => void;
  private readonly onProgress?: (downloaded: number, total: number) => void;
  private readonly onComplete?: () => void;
  private readonly onError?: (error: Error) => void;

  private downloadedChunks = new Map<number, ArrayBuffer>();
  private pendingChunks: number[] = [];
  private inFlightChunks = new Map<number, { peerId: string; timestamp: number }>();
  
  private isRunning = false;
  private isPaused = false;
  private connectedPeers = new Set<string>();

  constructor(options: ChunkDownloadOptions) {
    this.chunkMap = options.chunkMap;
    this.peerManager = options.peerManager;
    this.signalingChannel = options.signalingChannel;
    this.myPubkey = options.myPubkey;
    this.maxConcurrent = options.maxConcurrent || 3;
    
    this.onChunkReceived = options.onChunkReceived;
    this.onProgress = options.onProgress;
    this.onComplete = options.onComplete;
    this.onError = options.onError;

    // Initialize pending chunks
    for (let i = 0; i < this.chunkMap.chunks.length; i++) {
      this.pendingChunks.push(i);
    }
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isPaused = false;

    if (this.chunkMap.chunks.length === 0) {
      this.onComplete?.();
      return;
    }

    try {
      // Connect to gatekeepers
      const gatekeepers = this.chunkMap.gatekeepers || [];
      if (gatekeepers.length === 0) {
        throw new Error("No gatekeepers found in chunk map");
      }

      // Initialize connections
      for (const peerPubkey of gatekeepers) {
        if (peerPubkey === this.myPubkey) continue;
        
        // Use signalingChannel to negotiate connection instead of just PeerManager
        // In a full implementation we would create the RTCPeerConnection, add it to PeerManager,
        // and handle offers/answers via SignalingChannel
        
        // Mock connection setup for now to satisfy the types
        const pc = new RTCPeerConnection();
        this.peerManager.addPeer(peerPubkey, pc);
        this.connectedPeers.add(peerPubkey);
      }

      // Start the download loop
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

  private scheduleNextRequests(): void {
    if (!this.isRunning || this.isPaused) return;

    if (this.downloadedChunks.size === this.chunkMap.chunks.length) {
      this.isRunning = false;
      this.onComplete?.();
      return;
    }

    const availablePeers = Array.from(this.connectedPeers);
    if (availablePeers.length === 0) {
      // No peers available, wait for connections
      setTimeout(() => this.scheduleNextRequests(), 1000);
      return;
    }

    // Assign pending chunks to peers
    while (this.inFlightChunks.size < this.maxConcurrent && this.pendingChunks.length > 0) {
      const chunkIndex = this.pendingChunks.shift()!;
      
      // Simple round-robin peer assignment
      const peerId = availablePeers[this.inFlightChunks.size % availablePeers.length];
      
      this.inFlightChunks.set(chunkIndex, { peerId, timestamp: Date.now() });
      
      this.requestChunkFromPeer(peerId, chunkIndex).catch(err => {
        console.error(`Failed to request chunk ${chunkIndex} from ${peerId}:`, err);
        this.handleChunkError(chunkIndex);
      });
    }

    // Check for timed out requests
    const now = Date.now();
    for (const [index, info] of Array.from(this.inFlightChunks.entries())) {
      if (now - info.timestamp > 15000) {
        console.warn(`Chunk ${index} request timed out`);
        this.handleChunkError(index);
      }
    }
  }

  private async requestChunkFromPeer(peerId: string, index: number): Promise<void> {
    const chunkHash = this.chunkMap.chunks[index];
    if (!chunkHash) throw new Error(`Invalid chunk index ${index}`);

    const peer = this.peerManager.getPeer(peerId);
    if (!peer || !peer.connection) throw new Error(`Peer ${peerId} not found or not connected`);

    const request: ChunkRequestMessage = {
      type: "CHUNK_REQUEST",
      requesterPubkey: this.myPubkey,
      rootHash: this.chunkMap.rootHash,
      chunkHash,
    };
    const requestPayload = encodeChunkRequest(request);

    // Assuming we have a data channel to send on, we would use it here
    // For now we'll mock the send since RTCPeerConnection doesn't have a send method directly
    // It would normally be peer.connection.createDataChannel("entropy").send(requestPayload);
    console.log(`Sending chunk request to ${peerId} for chunk ${index}`);
  }

  // This should be called when PeerManager receives a CHUNK_RESPONSE
  public handleReceivedChunk(peerId: string, index: number, data: ArrayBuffer): void {
    if (!this.inFlightChunks.has(index)) return; // Ignore if not requested

    const expectedHash = this.chunkMap.chunks[index];
    
    // Convert ArrayBuffer to Uint8Array for hashing
    const chunkData = new Uint8Array(data);
    
    sha256Hex(chunkData).then((actualHash: string) => {
      const isValid = actualHash === expectedHash;
      if (isValid) {
        this.inFlightChunks.delete(index);
        this.downloadedChunks.set(index, data);
        
        this.onChunkReceived?.(index, data);
        this.onProgress?.(this.downloadedChunks.size, this.chunkMap.chunks.length);
        
        this.scheduleNextRequests();
      } else {
        console.error(`Invalid hash for chunk ${index} from peer ${peerId}`);
        // Consider banning peer here
        this.handleChunkError(index);
      }
    }).catch((err: Error | unknown) => {
      console.error(`Hash verification failed for chunk ${index}:`, err);
      this.handleChunkError(index);
    });
  }

  private handleChunkError(index: number): void {
    this.inFlightChunks.delete(index);
    // Add back to front of pending list to retry immediately
    if (!this.pendingChunks.includes(index) && !this.downloadedChunks.has(index)) {
      this.pendingChunks.unshift(index);
    }
    this.scheduleNextRequests();
  }
}
