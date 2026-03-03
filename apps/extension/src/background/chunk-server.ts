import {
  decodeChunkTransferMessage,
  encodeCustodyProof,
  encodeChunkError,
  encodeTransferReceipt,
  sendChunkOverDataChannel,
  buildReceiptDraft,
  ENTROPY_UPSTREAM_RECEIPT_KIND,
  sha256Hex,
  logger,
  type CustodyChallengeMessage,
  type ChunkRequestMessage,
  type ChunkStore,
  type SignEventFn
} from "@entropy/core";

// ---------------------------------------------------------------------------
// Security constants
// ---------------------------------------------------------------------------

/** Maximum allowed binary message size in bytes (4 MB). */
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

/** Maximum CHUNK_REQUEST messages allowed per second per peer. */
const MAX_REQUESTS_PER_SECOND = 10;

/** Close the DataChannel if no message is received within this window (ms). */
const INACTIVE_CHANNEL_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Per-peer rate limiter (token bucket, 1-second window)
// ---------------------------------------------------------------------------

interface RateBucket {
  count: number;
  windowStart: number;
}

const rateBuckets = new Map<string, RateBucket>();

function isRateLimited(peerPubkey: string, nowMs: number): boolean {
  let bucket = rateBuckets.get(peerPubkey);

  if (!bucket || nowMs - bucket.windowStart >= 1000) {
    bucket = { count: 0, windowStart: nowMs };
    rateBuckets.set(peerPubkey, bucket);
  }

  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_SECOND;
}

function clearRateBucket(peerPubkey: string): void {
  rateBuckets.delete(peerPubkey);
}

export interface ChunkServerContext {
  authorizeRequest?: (request: {
    peerPubkey: string;
    chunkHash: string;
    rootHash: string;
    requestedBytes: number;
  }) => boolean | Promise<boolean>;
  signEvent?: SignEventFn;
  myPubkey?: string;
}

function isArrayBufferView(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value);
}

async function toArrayBuffer(data: unknown): Promise<ArrayBuffer> {
  if (data instanceof ArrayBuffer) {
    return data;
  }

  if (isArrayBufferView(data)) {
    const payload = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return payload.slice().buffer;
  }

  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return await data.arrayBuffer();
  }

  throw new Error("Unsupported RTC data channel payload type.");
}

async function sendChunkError(
  channel: RTCDataChannel,
  chunkHash: string,
  reason: "NOT_FOUND" | "INSUFFICIENT_CREDIT" | "BUSY"
): Promise<void> {
  if (channel.readyState !== "open") {
    return;
  }

  channel.send(
    encodeChunkError({
      type: "CHUNK_ERROR",
      chunkHash,
      reason
    })
  );
}

async function sendCustodyProof(
  channel: RTCDataChannel,
  message: CustodyChallengeMessage,
  chunkStore: ChunkStore
): Promise<void> {
  const chunk = await chunkStore.getChunk(message.chunkHash);
  if (!chunk) {
    await sendChunkError(channel, message.chunkHash, "NOT_FOUND");
    return;
  }

  const endOffset = message.offset + message.length;
  if (message.length === 0 || endOffset > chunk.data.byteLength) {
    logger.warn(
      "[chunk-server] invalid custody challenge range",
      `offset=${message.offset}`,
      `length=${message.length}`,
      `chunkSize=${chunk.data.byteLength}`
    );
    await sendChunkError(channel, message.chunkHash, "BUSY");
    return;
  }

  const chunkBytes = new Uint8Array(chunk.data);
  const slice = chunkBytes.slice(message.offset, endOffset);
  const sliceHash = await sha256Hex(slice);

  if (channel.readyState !== "open") {
    return;
  }

  channel.send(
    encodeCustodyProof({
      type: "CUSTODY_PROOF",
      chunkHash: message.chunkHash,
      sliceHash
    })
  );
}

export function handleDataChannel(
  channel: RTCDataChannel,
  peerPubkey: string,
  chunkStore: ChunkStore,
  onChunkServed: (chunkHash: string, bytes: number) => void | Promise<void>,
  context: ChunkServerContext = {}
): void {
  channel.binaryType = "arraybuffer";
  logger.log("[chunk-server] handleDataChannel called, peer:", peerPubkey.slice(0, 8) + "…",
    "| label:", channel.label, "readyState:", channel.readyState,
    "| id:", channel.id, "negotiated:", channel.negotiated);

  // Inactive channel timeout — close if peer sends nothing within the window.
  let inactivityTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    logger.warn("[chunk-server] closing inactive DataChannel for peer", peerPubkey.slice(0, 8) + "…");
    try { channel.close(); } catch { /* ignore */ }
  }, INACTIVE_CHANNEL_TIMEOUT_MS);

  function resetInactivityTimer(): void {
    if (inactivityTimer !== null) {
      clearTimeout(inactivityTimer);
    }
    inactivityTimer = setTimeout(() => {
      logger.warn("[chunk-server] closing inactive DataChannel for peer", peerPubkey.slice(0, 8) + "…");
      try { channel.close(); } catch { /* ignore */ }
    }, INACTIVE_CHANNEL_TIMEOUT_MS);
  }

  channel.addEventListener("close", () => {
    if (inactivityTimer !== null) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
    clearRateBucket(peerPubkey);
  });

  const onMessage = (event: MessageEvent): void => {
    resetInactivityTimer();
    logger.log("[chunk-server] onmessage received, dataType:", typeof event.data,
      "isArrayBuffer:", event.data instanceof ArrayBuffer,
      "byteLength:", event.data?.byteLength ?? event.data?.length ?? "N/A");
    void (async () => {
      let message: ChunkRequestMessage;

      try {
        const buffer = await toArrayBuffer(event.data);

        // Message size guard
        if (buffer.byteLength > MAX_MESSAGE_BYTES) {
          logger.warn(
            "[chunk-server] oversized message from peer", peerPubkey.slice(0, 8) + "…",
            "(" + buffer.byteLength + " bytes > " + MAX_MESSAGE_BYTES + ")"
          );
          return;
        }

        const decoded = decodeChunkTransferMessage(buffer);
        logger.log("[chunk-server] decoded message type:", decoded.type);

        if (decoded.type === "CUSTODY_CHALLENGE") {
          await sendCustodyProof(channel, decoded, chunkStore);
          return;
        }

        if (decoded.type !== "CHUNK_REQUEST") {
          logger.log("[chunk-server] ignoring non-CHUNK_REQUEST message");
          return;
        }

        message = decoded;
      } catch (decErr) {
        logger.warn("[chunk-server] failed to decode message:", decErr);
        return;
      }

      logger.log("[chunk-server] CHUNK_REQUEST from:", message.requesterPubkey.slice(0, 8) + "…",
        "chunkHash:", message.chunkHash.slice(0, 12) + "…",
        "rootHash:", message.rootHash.slice(0, 12) + "…");

      if (message.requesterPubkey !== peerPubkey) {
        logger.warn("[chunk-server] requester mismatch, expected:", peerPubkey.slice(0, 8) + "…",
          "got:", message.requesterPubkey.slice(0, 8) + "…");
        await sendChunkError(channel, message.chunkHash, "BUSY");
        return;
      }

      if (isRateLimited(peerPubkey, Date.now())) {
        logger.warn("[chunk-server] rate limit exceeded for peer", peerPubkey.slice(0, 8) + "…");
        await sendChunkError(channel, message.chunkHash, "BUSY");
        return;
      }

      const chunk = await chunkStore.getChunk(message.chunkHash);
      logger.log("[chunk-server] chunk lookup result:", chunk ? "FOUND (" + chunk.data.byteLength + " bytes)" : "NOT FOUND");

      if (!chunk || chunk.rootHash !== message.rootHash) {
        logger.warn("[chunk-server] chunk not found or rootHash mismatch");
        await sendChunkError(channel, message.chunkHash, "NOT_FOUND");
        return;
      }

      const isAuthorized = await Promise.resolve(
        context.authorizeRequest?.({
          peerPubkey,
          chunkHash: chunk.hash,
          rootHash: chunk.rootHash,
          requestedBytes: chunk.data.byteLength
        }) ?? true
      );

      if (!isAuthorized) {
        logger.warn("[chunk-server] request not authorized");
        await sendChunkError(channel, message.chunkHash, "INSUFFICIENT_CREDIT");
        return;
      }

      try {
        logger.log("[chunk-server] sending chunk", chunk.hash.slice(0, 12) + "…",
          chunk.data.byteLength, "bytes via data channel");
        sendChunkOverDataChannel(channel, chunk);

        // Sign and send transfer receipt after chunk data
        if (context.signEvent && context.myPubkey) {
          try {
            const receiptDraft = buildReceiptDraft({
              chunkHash: chunk.hash,
              senderPubkey: context.myPubkey,
              receiverPubkey: peerPubkey,
              bytes: chunk.data.byteLength,
              timestamp: Math.floor(Date.now() / 1000)
            });

            const signedReceipt = await context.signEvent(receiptDraft);

            if (channel.readyState === "open") {
              channel.send(encodeTransferReceipt({
                type: "TRANSFER_RECEIPT",
                chunkHash: chunk.hash,
                receipt: {
                  id: signedReceipt.id,
                  pubkey: signedReceipt.pubkey,
                  created_at: signedReceipt.created_at,
                  kind: signedReceipt.kind,
                  tags: signedReceipt.tags,
                  content: signedReceipt.content,
                  sig: signedReceipt.sig
                }
              }));
              logger.log("[chunk-server] ✅ transfer receipt sent for", chunk.hash.slice(0, 12) + "…");
            }
          } catch (receiptErr) {
            logger.warn("[chunk-server] failed to sign/send transfer receipt:", receiptErr);
          }
        }

        await onChunkServed(chunk.hash, chunk.data.byteLength);
        logger.log("[chunk-server] ✅ chunk served successfully");
      } catch (sendErr) {
        logger.error("[chunk-server] error sending chunk:", sendErr);
        await sendChunkError(channel, message.chunkHash, "BUSY");
      }
    })();
  };

  channel.addEventListener("message", onMessage);
  logger.log("[chunk-server] message listener attached");
}
