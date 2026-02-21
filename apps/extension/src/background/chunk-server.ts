import {
  decodeChunkTransferMessage,
  encodeChunkError,
  sendChunkOverDataChannel,
  logger,
  type ChunkRequestMessage,
  type ChunkStore
} from "@entropy/core";

export interface ChunkServerContext {
  authorizeRequest?: (request: {
    peerPubkey: string;
    chunkHash: string;
    rootHash: string;
    requestedBytes: number;
  }) => boolean | Promise<boolean>;
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

  const onMessage = (event: MessageEvent): void => {
    logger.log("[chunk-server] onmessage received, dataType:", typeof event.data,
      "isArrayBuffer:", event.data instanceof ArrayBuffer,
      "byteLength:", event.data?.byteLength ?? event.data?.length ?? "N/A");
    void (async () => {
      let message: ChunkRequestMessage;

      try {
        const buffer = await toArrayBuffer(event.data);
        const decoded = decodeChunkTransferMessage(buffer);
        logger.log("[chunk-server] decoded message type:", decoded.type);

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
