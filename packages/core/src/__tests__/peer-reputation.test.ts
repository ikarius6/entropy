import { describe, expect, it } from "vitest";

import {
  createPeerReputationStore,
  DEFAULT_BAN_DURATION_MS,
  DEFAULT_FAILED_VERIFICATION_BAN_THRESHOLD
} from "../credits/peer-reputation";

describe("peer-reputation", () => {
  it("records peer success metrics", async () => {
    const store = createPeerReputationStore({ nowMs: () => 1_700_000_000_000 });

    const updated = await store.recordSuccess("peer-a", 1024);

    expect(updated.pubkey).toBe("peer-a");
    expect(updated.successfulTransfers).toBe(1);
    expect(updated.totalBytesExchanged).toBe(1024);
    expect(updated.failedVerifications).toBe(0);
    expect(updated.banned).toBe(false);
    expect(updated.lastSeen).toBe(1_700_000_000_000);
  });

  it("auto-bans a peer after default failed verification threshold", async () => {
    const store = createPeerReputationStore();

    for (let index = 0; index < DEFAULT_FAILED_VERIFICATION_BAN_THRESHOLD - 1; index += 1) {
      const peer = await store.recordFailedVerification("peer-b");
      expect(peer.banned).toBe(false);
    }

    const bannedPeer = await store.recordFailedVerification("peer-b");
    expect(bannedPeer.failedVerifications).toBe(DEFAULT_FAILED_VERIFICATION_BAN_THRESHOLD);
    expect(bannedPeer.banned).toBe(true);
    await expect(store.isBanned("peer-b")).resolves.toBe(true);
  });

  it("supports custom ban threshold", async () => {
    const store = createPeerReputationStore({ failedVerificationBanThreshold: 2 });

    const first = await store.recordFailedVerification("peer-c");
    expect(first.banned).toBe(false);

    const second = await store.recordFailedVerification("peer-c");
    expect(second.banned).toBe(true);
  });

  it("can manually ban/unban peers", async () => {
    const store = createPeerReputationStore();

    await store.recordSuccess("peer-d", 2048);

    const banned = await store.setBanned("peer-d", true);
    expect(banned.banned).toBe(true);
    await expect(store.isBanned("peer-d")).resolves.toBe(true);

    const unbanned = await store.setBanned("peer-d", false);
    expect(unbanned.banned).toBe(false);
    await expect(store.isBanned("peer-d")).resolves.toBe(false);
  });

  it("lists peers ordered by lastSeen descending", async () => {
    let now = 100;
    const store = createPeerReputationStore({ nowMs: () => now });

    now = 100;
    await store.recordSuccess("peer-1", 1);

    now = 200;
    await store.recordSuccess("peer-2", 1);

    now = 150;
    await store.recordFailedVerification("peer-3");

    const peers = await store.listPeers();

    expect(peers.map((peer) => peer.pubkey)).toEqual(["peer-2", "peer-3", "peer-1"]);
  });

  it("auto-unbans peer after ban duration expires", async () => {
    let now = 1_000_000;
    const store = createPeerReputationStore({
      banDurationMs: 5_000,
      nowMs: () => now
    });

    // Ban the peer via failed verifications
    for (let i = 0; i < DEFAULT_FAILED_VERIFICATION_BAN_THRESHOLD; i++) {
      await store.recordFailedVerification("peer-exp");
    }
    await expect(store.isBanned("peer-exp")).resolves.toBe(true);

    // Still banned before duration elapses
    now = 1_004_999;
    await expect(store.isBanned("peer-exp")).resolves.toBe(true);

    // Expired after duration
    now = 1_005_000;
    await expect(store.isBanned("peer-exp")).resolves.toBe(false);

    // Peer record should be reset
    const peer = await store.getPeer("peer-exp");
    expect(peer!.banned).toBe(false);
    expect(peer!.failedVerifications).toBe(0);
    expect(peer!.bannedAt).toBeUndefined();
  });

  it("treats legacy banned peers (no bannedAt) as expired", async () => {
    const store = createPeerReputationStore({
      seedPeers: [{
        pubkey: "legacy-peer",
        successfulTransfers: 5,
        failedVerifications: 3,
        totalBytesExchanged: 10_000,
        lastSeen: 999,
        banned: true
        // no bannedAt → legacy record
      }]
    });

    // Should be treated as expired immediately
    await expect(store.isBanned("legacy-peer")).resolves.toBe(false);
  });

  it("permanent bans (Infinity) never expire", async () => {
    let now = 1_000_000;
    const store = createPeerReputationStore({
      banDurationMs: Infinity,
      nowMs: () => now
    });

    for (let i = 0; i < DEFAULT_FAILED_VERIFICATION_BAN_THRESHOLD; i++) {
      await store.recordFailedVerification("perma-peer");
    }
    await expect(store.isBanned("perma-peer")).resolves.toBe(true);

    // Even far in the future, still banned
    now = 999_999_999_999;
    await expect(store.isBanned("perma-peer")).resolves.toBe(true);
  });

  it("setBanned(false) resets failedVerifications and bannedAt", async () => {
    const store = createPeerReputationStore({ nowMs: () => 5000 });

    for (let i = 0; i < DEFAULT_FAILED_VERIFICATION_BAN_THRESHOLD; i++) {
      await store.recordFailedVerification("reset-peer");
    }
    const banned = await store.getPeer("reset-peer");
    expect(banned!.banned).toBe(true);
    expect(banned!.bannedAt).toBe(5000);

    const unbanned = await store.setBanned("reset-peer", false);
    expect(unbanned.banned).toBe(false);
    expect(unbanned.failedVerifications).toBe(0);
    expect(unbanned.bannedAt).toBeUndefined();
  });

  it("default ban duration is 30 minutes", () => {
    expect(DEFAULT_BAN_DURATION_MS).toBe(30 * 60 * 1000);
  });

  it("validates pubkey and byte input", async () => {
    const store = createPeerReputationStore();

    await expect(store.recordSuccess("", 1)).rejects.toThrowError("pubkey is required.");
    await expect(store.recordSuccess("peer-z", 0)).rejects.toThrowError("bytes must be a positive integer.");
    await expect(store.recordSuccess("peer-z", -10)).rejects.toThrowError("bytes must be a positive integer.");
    await expect(store.recordSuccess("peer-z", Number.NaN)).rejects.toThrowError("bytes must be a positive integer.");
  });
});
