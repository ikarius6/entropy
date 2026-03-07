import { describe, expect, it } from "vitest";

import { generateKeypair, signEvent as signEventFn } from "../nostr/identity";
import { makeNip44Fns } from "../nostr/nip44";
import { SignalingChannel } from "../transport/signaling-channel";
import type { NostrEvent, NostrFilter, EventCallback, Subscription, RelayPool } from "../nostr/client";
import type { NostrEventDraft } from "../nostr/events";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flush pending microtasks so the async signEvent().then(publish) resolves. */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function createMockPool() {
  const published: NostrEvent[] = [];
  let subscribedCallback: EventCallback | null = null;

  const pool: RelayPool = {
    publish(event: NostrEvent) {
      published.push(event);
    },
    subscribe(_filters: NostrFilter[], onEvent: EventCallback): Subscription {
      subscribedCallback = onEvent;
      return { id: "mock-sub", unsubscribe: () => { subscribedCallback = null; } };
    },
  } as unknown as RelayPool;

  return {
    pool,
    published,
    feedEvent(event: NostrEvent) {
      subscribedCallback?.(event);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NIP-44 signaling encryption roundtrip", () => {
  const alice = generateKeypair();
  const bob = generateKeypair();

  const aliceNip44 = makeNip44Fns(alice.privkey);
  const bobNip44 = makeNip44Fns(bob.privkey);

  const fakeSdp = { type: "offer", sdp: "v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\n" };
  const rootHash = "a".repeat(64);

  it("published event content is NOT the raw SDP JSON", async () => {
    const { pool, published } = createMockPool();

    const senderChannel = new SignalingChannel(
      pool,
      (draft: NostrEventDraft) => signEventFn(draft, alice.privkey),
      { encryptFn: aliceNip44.encrypt, decryptFn: aliceNip44.decrypt },
    );

    senderChannel.sendOffer({
      targetPubkey: bob.pubkey,
      sdp: fakeSdp,
      rootHash,
    });

    await flush();

    expect(published.length).toBe(1);
    const event = published[0];

    // Content must NOT be the plain JSON of the SDP
    expect(event.content).not.toBe(JSON.stringify(fakeSdp));

    // Must have the ["enc", "nip44"] tag
    const encTag = event.tags.find((t) => t[0] === "enc" && t[1] === "nip44");
    expect(encTag).toBeDefined();
  });

  it("receiver decrypts and recovers the original SDP payload", async () => {
    const senderPool = createMockPool();
    const receiverPool = createMockPool();

    const senderChannel = new SignalingChannel(
      senderPool.pool,
      (draft: NostrEventDraft) => signEventFn(draft, alice.privkey),
      { encryptFn: aliceNip44.encrypt, decryptFn: aliceNip44.decrypt },
    );

    const receivedSignals: unknown[] = [];

    const receiverChannel = new SignalingChannel(
      receiverPool.pool,
      (draft: NostrEventDraft) => signEventFn(draft, bob.privkey),
      { encryptFn: bobNip44.encrypt, decryptFn: bobNip44.decrypt },
    );

    receiverChannel.onSignal(bob.pubkey, (signal) => {
      receivedSignals.push(signal);
    });

    // Alice sends an encrypted offer
    senderChannel.sendOffer({
      targetPubkey: bob.pubkey,
      sdp: fakeSdp,
      rootHash,
    });

    await flush();

    // Simulate relay delivery: feed Alice's published event into Bob's subscription
    const publishedEvent = senderPool.published[0];
    receiverPool.feedEvent(publishedEvent);

    expect(receivedSignals.length).toBe(1);
    const signal = receivedSignals[0] as { type: string; payload: unknown; rootHash: string; senderPubkey: string };
    expect(signal.type).toBe("offer");
    expect(signal.payload).toEqual(fakeSdp);
    expect(signal.rootHash).toBe(rootHash);
    expect(signal.senderPubkey).toBe(alice.pubkey);
  });

  it("drops event when decryption fails (wrong key)", async () => {
    const senderPool = createMockPool();
    const receiverPool = createMockPool();

    // Charlie is an unrelated keypair — Bob cannot decrypt messages from Alice encrypted for Charlie
    const charlie = generateKeypair();
    const charlieNip44 = makeNip44Fns(charlie.privkey);

    const senderChannel = new SignalingChannel(
      senderPool.pool,
      (draft: NostrEventDraft) => signEventFn(draft, alice.privkey),
      { encryptFn: aliceNip44.encrypt, decryptFn: aliceNip44.decrypt },
    );

    const receivedSignals: unknown[] = [];

    // Receiver uses Charlie's decrypt (wrong key for Alice→Bob messages)
    const receiverChannel = new SignalingChannel(
      receiverPool.pool,
      (draft: NostrEventDraft) => signEventFn(draft, charlie.privkey),
      { encryptFn: charlieNip44.encrypt, decryptFn: charlieNip44.decrypt },
    );

    receiverChannel.onSignal(charlie.pubkey, (signal) => {
      receivedSignals.push(signal);
    });

    // Alice encrypts for Bob's pubkey, but Charlie tries to decrypt
    senderChannel.sendOffer({
      targetPubkey: bob.pubkey,
      sdp: fakeSdp,
      rootHash,
    });

    await flush();

    const publishedEvent = senderPool.published[0];
    receiverPool.feedEvent(publishedEvent);

    // Should be dropped — Charlie can't decrypt content encrypted for Bob
    expect(receivedSignals.length).toBe(0);
  });

  it("works without encryption when no fns provided (backward compat)", async () => {
    const { pool, published } = createMockPool();
    const receiverPool = createMockPool();

    // No encryption fns
    const senderChannel = new SignalingChannel(
      pool,
      (draft: NostrEventDraft) => signEventFn(draft, alice.privkey),
    );

    senderChannel.sendOffer({
      targetPubkey: bob.pubkey,
      sdp: fakeSdp,
      rootHash,
    });

    await flush();

    expect(published.length).toBe(1);
    const event = published[0];

    // Content IS the raw JSON (no encryption)
    expect(event.content).toBe(JSON.stringify(fakeSdp));

    // No enc tag
    const encTag = event.tags.find((t) => t[0] === "enc");
    expect(encTag).toBeUndefined();

    // Receiver without decrypt fns can parse it
    const receivedSignals: unknown[] = [];
    const receiverChannel = new SignalingChannel(receiverPool.pool);
    receiverChannel.onSignal(bob.pubkey, (signal) => {
      receivedSignals.push(signal);
    });

    receiverPool.feedEvent(event);

    expect(receivedSignals.length).toBe(1);
    const signal = receivedSignals[0] as { type: string; payload: unknown };
    expect(signal.payload).toEqual(fakeSdp);
  });
});
