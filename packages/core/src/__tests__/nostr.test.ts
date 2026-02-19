import { describe, expect, it } from "vitest";

import {
  ENTROPY_CHUNK_MAP_KIND,
  buildEntropyChunkMapEvent,
  parseEntropyChunkMapEvent
} from "../nostr/events";

describe("nostr chunk map event", () => {
  it("builds and parses kind 7001 chunk map events", () => {
    const event = buildEntropyChunkMapEvent({
      chunkMap: {
        rootHash: "abc123",
        chunks: ["chunk-a", "chunk-b"],
        size: 10,
        chunkSize: 5,
        mimeType: "video/mp4",
        title: "Demo",
        gatekeepers: ["npub1peer", "npub1peer2"]
      },
      content: "Entropy map",
      createdAt: 1700000000
    });

    expect(event.kind).toBe(ENTROPY_CHUNK_MAP_KIND);
    expect(event.content).toBe("Entropy map");
    expect(event.created_at).toBe(1700000000);

    const parsed = parseEntropyChunkMapEvent(event);
    expect(parsed.rootHash).toBe("abc123");
    expect(parsed.chunks).toEqual(["chunk-a", "chunk-b"]);
    expect(parsed.chunkSize).toBe(5);
    expect(parsed.gatekeepers).toEqual(["npub1peer", "npub1peer2"]);
  });
});
