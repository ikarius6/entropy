import { describe, expect, it } from "vitest";

import {
  ENTROPY_TAG_VOTE_KIND,
  ENTROPY_TAG,
  buildTagVoteTags,
  parseTagVoteTags,
} from "../nostr/nip-entropy";

describe("tag vote event (kind 37001)", () => {
  const ROOT_HASH = "abc123def456";
  const TAG_NAME = "music";

  // ── buildTagVoteTags ────────────────────────────────────────────────

  describe("buildTagVoteTags", () => {
    it("produces the required Nostr tags with default network tag", () => {
      const tags = buildTagVoteTags(ROOT_HASH, TAG_NAME);

      expect(tags).toContainEqual(["d", ROOT_HASH]);
      expect(tags).toContainEqual(["t", ENTROPY_TAG]);
      expect(tags).toContainEqual(["x-hash", ROOT_HASH]);
      expect(tags).toContainEqual(["entropy-tag", TAG_NAME]);
    });

    it("uses custom network tags when provided", () => {
      const tags = buildTagVoteTags(ROOT_HASH, TAG_NAME, ["custom-net", "alt"]);

      expect(tags).toContainEqual(["t", "custom-net"]);
      expect(tags).toContainEqual(["t", "alt"]);
      // Should NOT contain default "entropy" network tag
      expect(tags).not.toContainEqual(["t", ENTROPY_TAG]);
    });

    it("falls back to default network tag when networkTags is empty", () => {
      const tags = buildTagVoteTags(ROOT_HASH, TAG_NAME, []);

      expect(tags).toContainEqual(["t", ENTROPY_TAG]);
    });

    it("places the d-tag first for NIP-33 compliance", () => {
      const tags = buildTagVoteTags(ROOT_HASH, TAG_NAME);

      expect(tags[0]).toEqual(["d", ROOT_HASH]);
    });
  });

  // ── parseTagVoteTags ────────────────────────────────────────────────

  describe("parseTagVoteTags", () => {
    it("parses rootHash and tagName from valid tags", () => {
      const tags = buildTagVoteTags(ROOT_HASH, TAG_NAME);
      const parsed = parseTagVoteTags(tags);

      expect(parsed.rootHash).toBe(ROOT_HASH);
      expect(parsed.tagName).toBe(TAG_NAME);
    });

    it("throws when d-tag (rootHash) is missing", () => {
      const tags = [
        ["t", ENTROPY_TAG],
        ["entropy-tag", TAG_NAME],
      ];

      expect(() => parseTagVoteTags(tags)).toThrow("missing the d tag");
    });

    it("returns empty tagName when entropy-tag is missing", () => {
      const tags = [
        ["d", ROOT_HASH],
        ["t", ENTROPY_TAG],
      ];

      const parsed = parseTagVoteTags(tags);
      expect(parsed.rootHash).toBe(ROOT_HASH);
      expect(parsed.tagName).toBe("");
    });

    it("ignores unrelated tags", () => {
      const tags = [
        ["d", ROOT_HASH],
        ["t", ENTROPY_TAG],
        ["x-hash", ROOT_HASH],
        ["entropy-tag", TAG_NAME],
        ["random", "value"],
        ["p", "some-pubkey"],
      ];

      const parsed = parseTagVoteTags(tags);
      expect(parsed.rootHash).toBe(ROOT_HASH);
      expect(parsed.tagName).toBe(TAG_NAME);
    });
  });

  // ── Round-trip ──────────────────────────────────────────────────────

  describe("round-trip", () => {
    it("build → parse preserves rootHash and tagName", () => {
      const tags = buildTagVoteTags(ROOT_HASH, TAG_NAME);
      const parsed = parseTagVoteTags(tags);

      expect(parsed).toEqual({ rootHash: ROOT_HASH, tagName: TAG_NAME });
    });

    it("works with various tag names", () => {
      const names = ["electronic", "lo-fi", "hip_hop", "ambient drone", "a"];

      for (const name of names) {
        const tags = buildTagVoteTags(ROOT_HASH, name);
        const parsed = parseTagVoteTags(tags);
        expect(parsed.tagName).toBe(name);
      }
    });

    it("kind constant is 37001 (parameterized replaceable range)", () => {
      expect(ENTROPY_TAG_VOTE_KIND).toBe(37001);
      expect(ENTROPY_TAG_VOTE_KIND).toBeGreaterThanOrEqual(30000);
      expect(ENTROPY_TAG_VOTE_KIND).toBeLessThanOrEqual(39999);
    });
  });
});
