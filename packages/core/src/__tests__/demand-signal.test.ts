import { describe, expect, it } from "vitest";

import {
  ENTROPY_DEMAND_SIGNAL_KIND,
  buildDemandSignalEvent,
  parseDemandSignalEvent
} from "../nostr/demand-signal";

describe("demand-signal", () => {
  const ROOT_HASH = "a".repeat(64);
  const PUBKEY = "b".repeat(64);

  describe("buildDemandSignalEvent", () => {
    it("builds a valid demand signal event draft", () => {
      const draft = buildDemandSignalEvent({
        rootHash: ROOT_HASH,
        createdAt: 1_700_000_000
      });

      expect(draft.kind).toBe(ENTROPY_DEMAND_SIGNAL_KIND);
      expect(draft.kind).toBe(20003);
      expect(draft.created_at).toBe(1_700_000_000);
      expect(draft.content).toBe("");
      expect(draft.tags).toContainEqual(["t", "entropy"]);
      expect(draft.tags).toContainEqual(["x", ROOT_HASH]);
    });

    it("uses custom network tags when provided", () => {
      const draft = buildDemandSignalEvent({
        rootHash: ROOT_HASH,
        networkTags: ["my-net", "other-net"]
      });

      expect(draft.tags).toContainEqual(["t", "my-net"]);
      expect(draft.tags).toContainEqual(["t", "other-net"]);
      expect(draft.tags).not.toContainEqual(["t", "entropy"]);
    });

    it("normalizes rootHash to lowercase", () => {
      const draft = buildDemandSignalEvent({
        rootHash: "  " + ROOT_HASH.toUpperCase() + "  "
      });

      const xTag = draft.tags.find((t) => t[0] === "x");
      expect(xTag?.[1]).toBe(ROOT_HASH);
    });

    it("throws on empty rootHash", () => {
      expect(() =>
        buildDemandSignalEvent({ rootHash: "" })
      ).toThrow("rootHash is required");
    });
  });

  describe("parseDemandSignalEvent", () => {
    it("parses a valid demand signal event", () => {
      const signal = parseDemandSignalEvent({
        kind: ENTROPY_DEMAND_SIGNAL_KIND,
        tags: [
          ["t", "entropy"],
          ["x", ROOT_HASH]
        ],
        pubkey: PUBKEY,
        created_at: 1_700_000_000
      });

      expect(signal.rootHash).toBe(ROOT_HASH);
      expect(signal.signalerPubkey).toBe(PUBKEY);
      expect(signal.timestamp).toBe(1_700_000_000);
    });

    it("throws on wrong kind", () => {
      expect(() =>
        parseDemandSignalEvent({
          kind: 1,
          tags: [["x", ROOT_HASH]],
          pubkey: PUBKEY,
          created_at: 1_700_000_000
        })
      ).toThrow("Expected kind 20003");
    });

    it("throws on missing rootHash", () => {
      expect(() =>
        parseDemandSignalEvent({
          kind: ENTROPY_DEMAND_SIGNAL_KIND,
          tags: [["t", "entropy"]],
          pubkey: PUBKEY,
          created_at: 1_700_000_000
        })
      ).toThrow("rootHash is required");
    });

    it("throws on empty pubkey", () => {
      expect(() =>
        parseDemandSignalEvent({
          kind: ENTROPY_DEMAND_SIGNAL_KIND,
          tags: [["x", ROOT_HASH]],
          pubkey: "",
          created_at: 1_700_000_000
        })
      ).toThrow("empty pubkey");
    });
  });
});
