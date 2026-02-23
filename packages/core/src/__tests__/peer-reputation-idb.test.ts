import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { DEFAULT_FAILED_VERIFICATION_BAN_THRESHOLD } from "../credits/peer-reputation";
import { createIndexedDbPeerReputationStore } from "../storage/peer-reputation-idb";

let databaseCounter = 0;

function createTestStore(options: { nowMs?: () => number; dbName?: string } = {}) {
  databaseCounter += 1;

  return createIndexedDbPeerReputationStore({
    dbName: options.dbName ?? `entropy-peer-reputation-test-${databaseCounter}`,
    nowMs: options.nowMs
  });
}

describe("indexeddb peer reputation store", () => {
  it("records peer success metrics", async () => {
    const store = createTestStore({ nowMs: () => 1_700_000_000_000 });

    try {
      const peer = await store.recordSuccess("peer-a", 4096);

      expect(peer.pubkey).toBe("peer-a");
      expect(peer.successfulTransfers).toBe(1);
      expect(peer.totalBytesExchanged).toBe(4096);
      expect(peer.failedVerifications).toBe(0);
      expect(peer.banned).toBe(false);
      expect(peer.lastSeen).toBe(1_700_000_000_000);
    } finally {
      store.close();
    }
  });

  it("auto-bans peer after failed verification threshold", async () => {
    const store = createTestStore();

    try {
      for (let index = 0; index < DEFAULT_FAILED_VERIFICATION_BAN_THRESHOLD - 1; index += 1) {
        const peer = await store.recordFailedVerification("peer-b");
        expect(peer.banned).toBe(false);
      }

      const bannedPeer = await store.recordFailedVerification("peer-b");
      expect(bannedPeer.failedVerifications).toBe(DEFAULT_FAILED_VERIFICATION_BAN_THRESHOLD);
      expect(bannedPeer.banned).toBe(true);
      await expect(store.isBanned("peer-b")).resolves.toBe(true);
    } finally {
      store.close();
    }
  });

  it("supports manual ban and unban", async () => {
    const store = createTestStore();

    try {
      await store.recordSuccess("peer-c", 512);

      const banned = await store.setBanned("peer-c", true);
      expect(banned.banned).toBe(true);
      await expect(store.isBanned("peer-c")).resolves.toBe(true);

      const unbanned = await store.setBanned("peer-c", false);
      expect(unbanned.banned).toBe(false);
      await expect(store.isBanned("peer-c")).resolves.toBe(false);
    } finally {
      store.close();
    }
  });

  it("lists peers sorted by lastSeen desc", async () => {
    let now = 100;
    const store = createTestStore({ nowMs: () => now });

    try {
      now = 100;
      await store.recordSuccess("peer-1", 1);

      now = 300;
      await store.recordSuccess("peer-2", 1);

      now = 200;
      await store.recordFailedVerification("peer-3");

      const peers = await store.listPeers();
      expect(peers.map((peer) => peer.pubkey)).toEqual(["peer-2", "peer-3", "peer-1"]);
    } finally {
      store.close();
    }
  });

  it("persists data for same dbName across instances", async () => {
    const sharedDbName = "entropy-peer-reputation-persist-test";
    const storeA = createTestStore({ dbName: sharedDbName });

    try {
      await storeA.recordSuccess("peer-x", 777);
    } finally {
      storeA.close();
    }

    const storeB = createTestStore({ dbName: sharedDbName });

    try {
      const peer = await storeB.getPeer("peer-x");
      expect(peer?.successfulTransfers).toBe(1);
      expect(peer?.totalBytesExchanged).toBe(777);
    } finally {
      storeB.close();
    }
  });
});
