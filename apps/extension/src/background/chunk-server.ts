import {
  decodeChunkTransferMessage,
  encodeChunkError,
  sendChunkOverDataChannel,
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

  const onMessage = (event: MessageEvent): void => {
    void (async () => {
      let message: ChunkRequestMessage;

      try {
        const buffer = await toArrayBuffer(event.data);
        const decoded = decodeChunkTransferMessage(buffer);

        if (decoded.type !== "CHUNK_REQUEST") {
          return;
        }

        message = decoded;
      } catch {
        return;
      }

      if (message.requesterPubkey !== peerPubkey) {
        await sendChunkError(channel, message.chunkHash, "BUSY");
        return;
      }

      const chunk = await chunkStore.getChunk(message.chunkHash);

      if (!chunk || chunk.rootHash !== message.rootHash) {
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
        await sendChunkError(channel, message.chunkHash, "INSUFFICIENT_CREDIT");
        return;
      }

      try {
        sendChunkOverDataChannel(channel, chunk);
        await onChunkServed(chunk.hash, chunk.data.byteLength);
      } catch {
        await sendChunkError(channel, message.chunkHash, "BUSY");
      }
    })();
  };

  channel.addEventListener("message", onMessage);
}
