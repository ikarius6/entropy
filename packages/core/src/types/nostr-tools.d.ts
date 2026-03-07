declare module "nostr-tools/nip44" {
  export function getConversationKey(privkey: Uint8Array, pubkey: string): Uint8Array;
  export function encrypt(plaintext: string, conversationKey: Uint8Array): string;
  export function decrypt(ciphertext: string, conversationKey: Uint8Array): string;
}

declare module "nostr-tools" {
  export interface NostrEventTemplate {
    kind: number;
    created_at: number;
    content: string;
    tags: string[][];
  }

  export interface NostrVerifiedEvent extends NostrEventTemplate {
    id: string;
    pubkey: string;
    sig: string;
  }

  export function generateSecretKey(): Uint8Array;
  export function getPublicKey(secretKey: Uint8Array): string;

  export function finalizeEvent(
    event: NostrEventTemplate,
    secretKey: Uint8Array
  ): NostrVerifiedEvent;

  export function verifyEvent(event: {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
  }): boolean;
}
