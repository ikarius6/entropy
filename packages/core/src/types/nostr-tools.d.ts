declare module "nostr-tools" {
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
