export const ENTROPY_SIGNALING_KIND_MIN = 20_000;
export const ENTROPY_SIGNALING_KIND_MAX = 29_999;

export interface EntropySignalingEnvelope<TPayload = unknown> {
  kind: number;
  pubkey: string;
  created_at: number;
  payload: TPayload;
}

export function isEntropySignalingKind(kind: number): boolean {
  return kind >= ENTROPY_SIGNALING_KIND_MIN && kind <= ENTROPY_SIGNALING_KIND_MAX;
}
