import { useState, useEffect } from "react";

/**
 * NIP-05 resolver hook.
 * Accepts a string that may be a NIP-05 identifier (`user@domain`) and
 * resolves it to a hex pubkey via the NIP-05 well-known endpoint.
 *
 * If the input doesn't look like a NIP-05 alias, `resolvedPubkey` is
 * returned as-is so callers can pass either form without branching.
 */
export function useNip05Resolve(input: string | null) {
  const [resolvedPubkey, setResolvedPubkey] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!input) {
      setResolvedPubkey(null);
      setError(null);
      return;
    }

    // If it doesn't contain "@" it's already a pubkey — pass through
    if (!input.includes("@")) {
      setResolvedPubkey(input);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsResolving(true);
    setError(null);
    setResolvedPubkey(null);

    const [name, domain] = input.split("@");
    if (!name || !domain) {
      setError("Invalid NIP-05 identifier format.");
      setIsResolving(false);
      return;
    }

    const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${domain}`);
        return res.json();
      })
      .then((json: { names?: Record<string, string> }) => {
        if (cancelled) return;

        const pubkey = json?.names?.[name];
        if (!pubkey) {
          throw new Error(`Name "${name}" not found on ${domain}`);
        }

        setResolvedPubkey(pubkey);
        setIsResolving(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : `Could not resolve ${input}`
        );
        setIsResolving(false);
      });

    return () => {
      cancelled = true;
    };
  }, [input]);

  return { resolvedPubkey, isResolving, error };
}
