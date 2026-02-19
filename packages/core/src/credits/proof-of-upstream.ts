import type { NostrEvent } from "../nostr/client";
import type { NostrEventDraft } from "../nostr/events";

export const ENTROPY_UPSTREAM_RECEIPT_KIND = 7772;

export interface UpstreamReceipt {
  chunkHash: string;
  senderPubkey: string;
  receiverPubkey: string;
  bytes: number;
  timestamp: number;
}

export interface ReceiptEventLike {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export type ReceiptSignatureVerifier = (event: ReceiptEventLike) => boolean;

export interface SignedReceipt extends UpstreamReceipt {
  signature: string;
  eventId: string;
}

export interface ReceiptValidationOptions {
  nowSeconds?: number;
  maxAgeSeconds?: number;
  maxFutureSkewSeconds?: number;
  verifySignature?: ReceiptSignatureVerifier;
}

const DEFAULT_MAX_AGE_SECONDS = 60 * 30;
const DEFAULT_MAX_FUTURE_SKEW_SECONDS = 60;
let defaultVerifySignature: ReceiptSignatureVerifier | null = null;

export function configureReceiptSignatureVerifier(verifySignature: ReceiptSignatureVerifier | null): void {
  defaultVerifySignature = verifySignature;
}

function findTag(tags: string[][], key: string): string | undefined {
  const tag = tags.find((candidate) => candidate[0] === key);
  return tag?.[1];
}

function toReceiptTags(receipt: UpstreamReceipt): string[][] {
  return [
    ["p", receipt.senderPubkey],
    ["x", receipt.chunkHash],
    ["bytes", String(receipt.bytes)],
    ["receipt", String(receipt.timestamp)]
  ];
}

function buildReceiptEventLike(receipt: SignedReceipt): ReceiptEventLike {
  return {
    id: receipt.eventId,
    pubkey: receipt.receiverPubkey,
    created_at: receipt.timestamp,
    kind: ENTROPY_UPSTREAM_RECEIPT_KIND,
    content: "",
    tags: toReceiptTags(receipt),
    sig: receipt.signature
  };
}

function defaultSignatureVerifier(event: ReceiptEventLike): boolean {
  if (!defaultVerifySignature) {
    return false;
  }

  try {
    return defaultVerifySignature(event);
  } catch {
    return false;
  }
}

function isFinitePositiveInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

export function buildReceiptDraft(receipt: UpstreamReceipt): NostrEventDraft {
  return {
    kind: ENTROPY_UPSTREAM_RECEIPT_KIND,
    created_at: receipt.timestamp,
    content: "",
    tags: toReceiptTags(receipt)
  };
}

export function parseReceipt(
  event: Pick<NostrEvent, "kind" | "pubkey" | "id" | "sig" | "tags" | "created_at">
): SignedReceipt {
  if (event.kind !== ENTROPY_UPSTREAM_RECEIPT_KIND) {
    throw new Error(`Expected kind ${ENTROPY_UPSTREAM_RECEIPT_KIND} but received ${event.kind}.`);
  }

  const senderPubkey = findTag(event.tags, "p");
  const chunkHash = findTag(event.tags, "x");
  const bytesRaw = findTag(event.tags, "bytes");
  const timestampRaw = findTag(event.tags, "receipt");

  const bytes = Number.parseInt(bytesRaw ?? "", 10);
  const timestamp = Number.parseInt(timestampRaw ?? String(event.created_at), 10);

  if (!senderPubkey || !chunkHash || !isFinitePositiveInteger(bytes) || !isFinitePositiveInteger(timestamp)) {
    throw new Error("Invalid upstream receipt event tags.");
  }

  return {
    senderPubkey,
    receiverPubkey: event.pubkey,
    chunkHash,
    bytes,
    timestamp,
    signature: event.sig,
    eventId: event.id
  };
}

export function isValidReceipt(
  receipt: SignedReceipt,
  expectedChunkHash: string,
  options: ReceiptValidationOptions = {}
): boolean {
  if (receipt.chunkHash !== expectedChunkHash) {
    return false;
  }

  if (
    receipt.senderPubkey.length === 0 ||
    receipt.receiverPubkey.length === 0 ||
    receipt.signature.length === 0 ||
    receipt.eventId.length === 0 ||
    !isFinitePositiveInteger(receipt.bytes) ||
    !isFinitePositiveInteger(receipt.timestamp)
  ) {
    return false;
  }

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  const maxFutureSkewSeconds = options.maxFutureSkewSeconds ?? DEFAULT_MAX_FUTURE_SKEW_SECONDS;

  if (receipt.timestamp > nowSeconds + maxFutureSkewSeconds) {
    return false;
  }

  if (nowSeconds - receipt.timestamp > maxAgeSeconds) {
    return false;
  }

  const verifySignature = options.verifySignature ?? defaultSignatureVerifier;
  return verifySignature(buildReceiptEventLike(receipt));
}

export function receiptToBytes(receipt: SignedReceipt): number {
  if (!isFinitePositiveInteger(receipt.bytes)) {
    throw new Error("Receipt bytes must be a positive integer.");
  }

  return receipt.bytes;
}
