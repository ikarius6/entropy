import {
  mergeContentTags,
  addContentTag,
  type ChunkStore,
  type StoreChunkPayload,
  type StoredChunk,
  type TagStore,
  type ContentTag
} from "@entropy/core";

function numberArrayToBuffer(data: number[]): ArrayBuffer {
  return new Uint8Array(data).buffer;
}

function toStoredChunk(payload: StoreChunkPayload): StoredChunk {
  if (!Number.isInteger(payload.index) || payload.index < 0) {
    throw new Error("Chunk index must be a non-negative integer.");
  }

  return {
    hash: payload.hash,
    rootHash: payload.rootHash,
    index: payload.index,
    data: numberArrayToBuffer(payload.data),
    createdAt: Date.now(),
    lastAccessed: Date.now(),
    pinned: payload.pinned ?? false
  };
}

export async function storeChunkPayload(chunkStore: ChunkStore, payload: StoreChunkPayload): Promise<void> {
  await chunkStore.storeChunk(toStoredChunk(payload));
}

export async function hasDelegatedChunks(
  chunkStore: ChunkStore,
  chunkHashes: string[]
): Promise<{ ok: boolean; missing: string[] }> {
  const missing: string[] = [];

  for (const hash of chunkHashes) {
    if (!(await chunkStore.hasChunk(hash))) {
      missing.push(hash);
    }
  }

  return {
    ok: missing.length === 0,
    missing
  };
}

export async function mergeIncomingTags(
  tagStore: TagStore,
  rootHash: string,
  remoteTags: ContentTag[]
): Promise<ContentTag[]> {
  const localTags = await tagStore.getContentTags(rootHash);
  const merged = mergeContentTags(localTags, remoteTags);
  await tagStore.setContentTags(rootHash, merged);
  return merged;
}

export async function addContentTagFromUser(
  tagStore: TagStore,
  rootHash: string,
  tagName: string
): Promise<{ added: boolean; tags: ContentTag[] }> {
  const alreadyTagged = await tagStore.hasTaggedContent(rootHash);

  if (alreadyTagged) {
    const tags = await tagStore.getContentTags(rootHash);
    return { added: false, tags };
  }

  const currentTags = await tagStore.getContentTags(rootHash);
  const updated = addContentTag(currentTags, tagName);
  await tagStore.setContentTags(rootHash, updated);
  await tagStore.recordTagAction(rootHash, tagName);

  return { added: true, tags: updated };
}
