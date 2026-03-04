import { describe, expect, it } from "vitest";

import {
  MESSAGE_TYPE_TAG_UPDATE,
  encodeTagUpdate,
  decodeTagUpdate,
  isTagUpdateMessage,
  type TagUpdateMessage
} from "../tags/tag-transfer";
import type { ContentTag } from "../tags/content-tags";

const ROOT_HASH = "ab".repeat(32);
const T1 = 1700000000;

function makeTags(entries: [string, number, number][]): ContentTag[] {
  return entries.map(([name, counter, updatedAt]) => ({ name, counter, updatedAt }));
}

describe("encodeTagUpdate / decodeTagUpdate", () => {
  it("round-trips empty tag list", () => {
    const msg: TagUpdateMessage = {
      type: "TAG_UPDATE",
      rootHash: ROOT_HASH,
      tags: []
    };

    const encoded = encodeTagUpdate(msg);
    const decoded = decodeTagUpdate(encoded);

    expect(decoded.type).toBe("TAG_UPDATE");
    expect(decoded.rootHash).toBe(ROOT_HASH);
    expect(decoded.tags).toEqual([]);
  });

  it("round-trips single tag", () => {
    const msg: TagUpdateMessage = {
      type: "TAG_UPDATE",
      rootHash: ROOT_HASH,
      tags: makeTags([["rock", 5, T1]])
    };

    const decoded = decodeTagUpdate(encodeTagUpdate(msg));

    expect(decoded.tags).toHaveLength(1);
    expect(decoded.tags[0]).toEqual({ name: "rock", counter: 5, updatedAt: T1 });
  });

  it("round-trips multiple tags", () => {
    const tags = makeTags([
      ["música", 10, T1],
      ["rock", 5, T1 + 100],
      ["en-vivo", 1, T1 + 200]
    ]);

    const msg: TagUpdateMessage = { type: "TAG_UPDATE", rootHash: ROOT_HASH, tags };
    const decoded = decodeTagUpdate(encodeTagUpdate(msg));

    expect(decoded.tags).toHaveLength(3);
    expect(decoded.tags[0].name).toBe("música");
    expect(decoded.tags[1].name).toBe("rock");
    expect(decoded.tags[2].name).toBe("en-vivo");
  });

  it("preserves UTF-8 tag names with accented characters", () => {
    const tags = makeTags([["electrónica", 3, T1], ["señal", 1, T1]]);

    const msg: TagUpdateMessage = { type: "TAG_UPDATE", rootHash: ROOT_HASH, tags };
    const decoded = decodeTagUpdate(encodeTagUpdate(msg));

    expect(decoded.tags[0].name).toBe("electrónica");
    expect(decoded.tags[1].name).toBe("señal");
  });

  it("preserves large counter values", () => {
    const msg: TagUpdateMessage = {
      type: "TAG_UPDATE",
      rootHash: ROOT_HASH,
      tags: [{ name: "popular", counter: 4294967295, updatedAt: T1 }]
    };

    const decoded = decodeTagUpdate(encodeTagUpdate(msg));

    expect(decoded.tags[0].counter).toBe(4294967295);
  });
});

describe("encodeTagUpdate — validation", () => {
  it("rejects invalid rootHash", () => {
    expect(() =>
      encodeTagUpdate({ type: "TAG_UPDATE", rootHash: "invalid", tags: [] })
    ).toThrow();
  });

  it("rejects more than 255 tags", () => {
    const tags: ContentTag[] = [];
    for (let i = 0; i < 256; i++) {
      tags.push({ name: `t${i}`, counter: 1, updatedAt: T1 });
    }

    expect(() =>
      encodeTagUpdate({ type: "TAG_UPDATE", rootHash: ROOT_HASH, tags })
    ).toThrow("255");
  });
});

describe("decodeTagUpdate — error cases", () => {
  it("rejects truncated buffer", () => {
    expect(() => decodeTagUpdate(new ArrayBuffer(2))).toThrow("truncated");
  });

  it("rejects wrong message type", () => {
    const buf = new ArrayBuffer(34);
    const view = new Uint8Array(buf);
    view[0] = 0xff;

    expect(() => decodeTagUpdate(buf)).toThrow("Expected TAG_UPDATE");
  });

  it("rejects truncated tag entries", () => {
    const buf = new ArrayBuffer(34);
    const view = new Uint8Array(buf);
    view[0] = MESSAGE_TYPE_TAG_UPDATE;
    view[33] = 5; // claim 5 tags but no data follows

    expect(() => decodeTagUpdate(buf)).toThrow("truncated");
  });
});

describe("isTagUpdateMessage", () => {
  it("returns true for TAG_UPDATE buffers", () => {
    const msg: TagUpdateMessage = {
      type: "TAG_UPDATE",
      rootHash: ROOT_HASH,
      tags: []
    };

    expect(isTagUpdateMessage(encodeTagUpdate(msg))).toBe(true);
  });

  it("returns false for other message types", () => {
    const buf = new ArrayBuffer(34);
    const view = new Uint8Array(buf);
    view[0] = 0x01;

    expect(isTagUpdateMessage(buf)).toBe(false);
  });

  it("returns false for empty buffer", () => {
    expect(isTagUpdateMessage(new ArrayBuffer(0))).toBe(false);
  });
});
