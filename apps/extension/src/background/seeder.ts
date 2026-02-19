import type { DelegateSeedingPayload } from "../shared/messaging";

export interface DelegatedContentRecord extends DelegateSeedingPayload {
  delegatedAt: number;
}

const delegatedContent = new Map<string, DelegatedContentRecord>();

export function enqueueDelegation(payload: DelegateSeedingPayload): void {
  delegatedContent.set(payload.rootHash, {
    ...payload,
    delegatedAt: Date.now()
  });
}

export function listDelegations(): DelegatedContentRecord[] {
  return Array.from(delegatedContent.values());
}

export function getDelegationCount(): number {
  return delegatedContent.size;
}

export function pruneDelegations(maxAgeMs = 1000 * 60 * 60 * 6): number {
  const now = Date.now();
  let removed = 0;

  for (const [rootHash, entry] of delegatedContent.entries()) {
    if (now - entry.delegatedAt > maxAgeMs) {
      delegatedContent.delete(rootHash);
      removed += 1;
    }
  }

  return removed;
}
