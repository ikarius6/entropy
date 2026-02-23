import { describe, expect, it } from "vitest";

import type { NostrEvent } from "../nostr/client";
import {
  buildSeederAnnouncementEvent,
  ENTROPY_SEEDER_ANNOUNCEMENT_KIND,
  parseSeederAnnouncementEvent
} from "../nostr/seeder-announcement";

const ROOT_HASH = "A".repeat(64);

function getTag(tags: string[][], key: string): string | undefined {
  return tags.find((tag) => tag[0] === key)?.[1];
}

function makeSeederEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "event-id",
    pubkey: "peer-pubkey",
    sig: "event-sig",
    kind: ENTROPY_SEEDER_ANNOUNCEMENT_KIND,
    created_at: 1_700_000_000,
    content: "",
    tags: [
      ["x", ROOT_HASH],
      ["chunks", "3"]
    ],
    ...overrides
  };
}

describe("seeder announcement", () => {
  it("builds kind 20002 seeder announcement event", () => {
    const event = buildSeederAnnouncementEvent({
      rootHash: ROOT_HASH,
      chunkCount: 12,
      createdAt: 1_700_000_100
    });

    expect(event.kind).toBe(ENTROPY_SEEDER_ANNOUNCEMENT_KIND);
    expect(event.created_at).toBe(1_700_000_100);
    expect(getTag(event.tags, "x")).toBe(ROOT_HASH.toLowerCase());
    expect(getTag(event.tags, "chunks")).toBe("12");
    expect(getTag(event.tags, "t")).toBe("entropy");
  });

  it("parses seeder announcement event", () => {
    const parsed = parseSeederAnnouncementEvent(
      makeSeederEvent({
        pubkey: "peer-seeder",
        tags: [
          ["x", ROOT_HASH.toLowerCase()],
          ["chunks", "5"]
        ]
      })
    );

    expect(parsed).toEqual({
      rootHash: ROOT_HASH.toLowerCase(),
      chunkCount: 5,
      seederPubkey: "peer-seeder"
    });
  });

  it("throws when event kind is invalid", () => {
    expect(() =>
      parseSeederAnnouncementEvent(
        makeSeederEvent({ kind: ENTROPY_SEEDER_ANNOUNCEMENT_KIND + 1 })
      )
    ).toThrowError(`Expected kind ${ENTROPY_SEEDER_ANNOUNCEMENT_KIND}`);
  });

  it("throws when root hash or chunk count tags are invalid", () => {
    expect(() =>
      parseSeederAnnouncementEvent(
        makeSeederEvent({
          tags: [["chunks", "2"]]
        })
      )
    ).toThrowError("rootHash is required.");

    expect(() =>
      parseSeederAnnouncementEvent(
        makeSeederEvent({
          tags: [
            ["x", ROOT_HASH],
            ["chunks", "NaN"]
          ]
        })
      )
    ).toThrowError("invalid chunk count");
  });
});
