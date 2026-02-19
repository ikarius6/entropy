import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools";

import { bytesToHex, hexToBytes } from "../crypto/hash";
import type { NostrEvent } from "./client";
import type { NostrEventDraft } from "./events";

export interface NostrKeypair {
  pubkey: string;
  privkey: string;
}

const PRIVATE_KEY_HEX_LENGTH = 64;

function normalizePrivateKeyHex(privkey: string): string {
  const normalized = privkey.trim().toLowerCase().replace(/^0x/, "");

  if (!/^[0-9a-f]+$/i.test(normalized)) {
    throw new Error("Private key must be a hex string.");
  }

  if (normalized.length !== PRIVATE_KEY_HEX_LENGTH) {
    throw new Error("Private key must be a 32-byte hex string.");
  }

  return normalized;
}

function cloneDraft(draft: NostrEventDraft): NostrEventDraft {
  return {
    kind: draft.kind,
    created_at: draft.created_at,
    content: draft.content,
    tags: draft.tags.map((tag) => [...tag])
  };
}

function privateKeyToBytes(privkey: string): Uint8Array {
  return hexToBytes(normalizePrivateKeyHex(privkey));
}

export function generateKeypair(): NostrKeypair {
  const secretKey = generateSecretKey();

  return {
    privkey: bytesToHex(secretKey),
    pubkey: getPublicKey(secretKey)
  };
}

export function pubkeyFromPrivkey(privkey: string): string {
  return getPublicKey(privateKeyToBytes(privkey));
}

export function signEvent(draft: NostrEventDraft, privkey: string): NostrEvent {
  const signedEvent = finalizeEvent(cloneDraft(draft), privateKeyToBytes(privkey));

  return {
    id: signedEvent.id,
    pubkey: signedEvent.pubkey,
    sig: signedEvent.sig,
    kind: signedEvent.kind,
    created_at: signedEvent.created_at,
    content: signedEvent.content,
    tags: signedEvent.tags.map((tag) => [...tag])
  };
}

export function verifyEventSignature(event: NostrEvent): boolean {
  return verifyEvent({
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig
  });
}
