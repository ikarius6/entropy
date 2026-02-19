import { configureReceiptSignatureVerifier, type ReceiptEventLike } from "./proof-of-upstream";

/**
 * Signature of a Nostr `verifyEvent`-compatible function.
 *
 * Consumers pass in the concrete implementation (e.g. from `nostr-tools`)
 * so that `proof-of-upstream.ts` stays dependency-free.
 */
export type NostrVerifyFn = (event: {
  id: string;
  pubkey: string;
  sig: string;
  kind: number;
  tags: string[][];
  content: string;
  created_at: number;
}) => boolean;

/**
 * Wire the receipt signature verifier used by `isValidReceipt`.
 *
 * Call once at application startup (web `main.tsx` or extension
 * `service-worker.ts`) with the concrete `verifyEvent` function.
 *
 * ```ts
 * import { verifyEvent } from "nostr-tools";
 * import { wireReceiptVerifier } from "@entropy/core";
 *
 * wireReceiptVerifier(verifyEvent);
 * ```
 */
export function wireReceiptVerifier(verifyEvent: NostrVerifyFn): void {
  configureReceiptSignatureVerifier((event: ReceiptEventLike) =>
    verifyEvent({
      id: event.id,
      pubkey: event.pubkey,
      sig: event.sig,
      kind: event.kind,
      tags: event.tags,
      content: event.content,
      created_at: event.created_at
    })
  );
}

/**
 * Remove any previously configured signature verifier.
 * Useful in tests or when tearing down.
 */
export function clearReceiptVerifier(): void {
  configureReceiptSignatureVerifier(null);
}
