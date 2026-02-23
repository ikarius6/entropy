import { describe, expect, it } from "vitest";

import {
  createPeerReputationStore,
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

  it("validates pubkey and byte input", async () => {
    const store = createPeerReputationStore();

    await expect(store.recordSuccess("", 1)).rejects.toThrowError("pubkey is required.");
    await expect(store.recordSuccess("peer-z", 0)).rejects.toThrowError("bytes must be a positive integer.");
    await expect(store.recordSuccess("peer-z", -10)).rejects.toThrowError("bytes must be a positive integer.");
    await expect(store.recordSuccess("peer-z", Number.NaN)).rejects.toThrowError("bytes must be a positive integer.");
  });
});
