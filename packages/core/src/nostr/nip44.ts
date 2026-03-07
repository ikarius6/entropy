/**
 * nip44.ts — NIP-44 (ChaCha20 + HMAC-SHA256) encryption helpers.
 *
 * Provides synchronous EncryptFn / DecryptFn closures built from a hex
 * private key, ready to be plugged into SignalingChannel.
 *
 * NIP-44 supersedes NIP-04 (AES-CBC) and is the mandatory encryption
 * standard for SDP signaling in Entropy.
 */
import * as nip44 from "nostr-tools/nip44";
import { hexToBytes } from "../crypto/hash";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Encrypts a plaintext string for a specific recipient pubkey. Synchronous. */
export type EncryptFn = (recipientPubkey: string, plaintext: string) => string;

/** Decrypts a ciphertext string from a specific sender pubkey. Synchronous. */
export type DecryptFn = (senderPubkey: string, ciphertext: string) => string;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a matched NIP-44 encrypt/decrypt pair from a hex-encoded private key.
 *
 * ```ts
 * const { encrypt, decrypt } = makeNip44Fns(myPrivkeyHex);
 * const channel = new SignalingChannel(pool, signEvent, { encryptFn: encrypt, decryptFn: decrypt });
 * ```
 */
export function makeNip44Fns(privkeyHex: string): { encrypt: EncryptFn; decrypt: DecryptFn } {
  const privkeyBytes = hexToBytes(privkeyHex);

  const encrypt: EncryptFn = (recipientPubkey: string, plaintext: string): string => {
    const conversationKey = nip44.getConversationKey(privkeyBytes, recipientPubkey);
    return nip44.encrypt(plaintext, conversationKey);
  };

  const decrypt: DecryptFn = (senderPubkey: string, ciphertext: string): string => {
    const conversationKey = nip44.getConversationKey(privkeyBytes, senderPubkey);
    return nip44.decrypt(ciphertext, conversationKey);
  };

  return { encrypt, decrypt };
}
