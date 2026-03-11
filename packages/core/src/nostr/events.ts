import {
  ENTROPY_CHUNK_MAP_KIND,
  ENTROPY_TAG_VOTE_KIND,
  ENTROPY_TAG,
  DEFAULT_NETWORK_TAG,
  buildEntropyChunkMapTags,
  parseEntropyChunkMapTags,
  buildTagVoteTags,
  parseTagVoteTags,
  type EntropyChunkMap,
  type NostrTag
} from "./nip-entropy";

export { ENTROPY_CHUNK_MAP_KIND, ENTROPY_TAG_VOTE_KIND, ENTROPY_TAG, DEFAULT_NETWORK_TAG };
export { buildTagVoteTags, parseTagVoteTags };

export interface NostrEventDraft {
  kind: number;
  created_at: number;
  content: string;
  tags: NostrTag[];
}

export interface BuildEntropyChunkMapEventParams {
  chunkMap: EntropyChunkMap;
  content?: string;
  createdAt?: number;
  networkTags?: string[];
}

export function buildEntropyChunkMapEvent(
  params: BuildEntropyChunkMapEventParams
): NostrEventDraft {
  return {
    kind: ENTROPY_CHUNK_MAP_KIND,
    created_at: params.createdAt ?? Math.floor(Date.now() / 1000),
    content: params.content ?? "",
    tags: buildEntropyChunkMapTags(params.chunkMap, params.networkTags)
  };
}

export function isEntropyChunkMapEvent(event: Pick<NostrEventDraft, "kind">): boolean {
  return event.kind === ENTROPY_CHUNK_MAP_KIND;
}

export function parseEntropyChunkMapEvent(
  event: Pick<NostrEventDraft, "kind" | "tags">
): EntropyChunkMap {
  if (!isEntropyChunkMapEvent(event)) {
    throw new Error(`Expected kind ${ENTROPY_CHUNK_MAP_KIND} but received ${event.kind}.`);
  }

  return parseEntropyChunkMapTags(event.tags);
}
