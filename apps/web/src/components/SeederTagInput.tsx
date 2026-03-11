import { useState, useCallback } from "react";
import { Tag, Loader2, Check, AlertCircle } from "lucide-react";
import { validateTagName, TAG_NAME_MAX_LENGTH, ENTROPY_TAG_VOTE_KIND, buildTagVoteTags } from "@entropy/core";
import { tagContent } from "../lib/extension-bridge";
import { useEntropyStore } from "../stores/entropy-store";
import { useContentTags } from "../hooks/useContentTags";

type TagState = "idle" | "submitting" | "success" | "already_tagged" | "error";

interface SeederTagInputProps {
  rootHash: string;
  /** Compact mode renders inline without wrapper padding */
  compact?: boolean;
}

/**
 * Inline input that lets a seeder add one hidden tag to content they've
 * fully downloaded/seeded. Publishes a Nostr kind:37001 tag-vote event
 * (visible to all users via relay subscription) and also stores locally
 * via TAG_CONTENT for P2P propagation.
 */
export function SeederTagInput({ rootHash, compact = false }: SeederTagInputProps) {
  const { relayPool, networkTags } = useEntropyStore();
  const { userTagged, userTag } = useContentTags(rootHash);

  const [value, setValue] = useState("");
  const [state, setState] = useState<TagState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    const validation = validateTagName(value);
    if (!validation.valid) {
      setErrorMsg(validation.error ?? "Invalid tag.");
      setState("error");
      return;
    }

    setState("submitting");
    setErrorMsg(null);

    try {
      // 1. Publish Nostr tag-vote event (kind:37001, parameterized replaceable)
      if (!window.nostr) {
        throw new Error("NIP-07 signer not available.");
      }

      const draft = {
        kind: ENTROPY_TAG_VOTE_KIND,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: buildTagVoteTags(rootHash, validation.normalized, networkTags),
      };

      const signed = await window.nostr.signEvent(draft);

      if (relayPool) {
        relayPool.publish(signed as Parameters<typeof relayPool.publish>[0]);
      }

      // 2. Also store locally in extension for P2P propagation (fire-and-forget)
      tagContent(rootHash, validation.normalized).catch(() => {});

      setState("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to tag content.");
      setState("error");
    }
  }, [value, rootHash, relayPool, networkTags]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && value.trim().length > 0) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  // Nostr subscription detected existing tag vote from this user
  if (userTagged && state !== "success") {
    return (
      <div className={`flex items-center gap-1.5 text-xs text-muted ${compact ? "" : "mt-2"}`}>
        <Tag size={13} />
        <span>You tagged this content{userTag ? `: "${userTag}"` : ""}</span>
      </div>
    );
  }

  // After success or already_tagged, show a static message
  if (state === "success") {
    return (
      <div className={`flex items-center gap-1.5 text-xs text-green-400 ${compact ? "" : "mt-2"}`}>
        <Check size={13} />
        <span>Tag added — it will spread to peers via P2P</span>
      </div>
    );
  }

  if (state === "already_tagged") {
    return (
      <div className={`flex items-center gap-1.5 text-xs text-muted ${compact ? "" : "mt-2"}`}>
        <Tag size={13} />
        <span>You already tagged this content</span>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-1.5 ${compact ? "" : "mt-2"}`}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Tag size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (state === "error") setState("idle");
            }}
            onKeyDown={handleKeyDown}
            maxLength={TAG_NAME_MAX_LENGTH}
            placeholder="Add a tag to this content…"
            disabled={state === "submitting"}
            className="input-base w-full pl-8 pr-3 py-1.5 text-sm"
          />
        </div>
        <button
          onClick={() => void handleSubmit()}
          disabled={state === "submitting" || value.trim().length === 0}
          className="button-secondary shrink-0 px-3 py-1.5 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {state === "submitting" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            "Tag"
          )}
        </button>
      </div>
      {state === "error" && errorMsg && (
        <div className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle size={12} />
          <span>{errorMsg}</span>
        </div>
      )}
      <p className="text-[0.68rem] text-muted/50">
        One tag per content · max {TAG_NAME_MAX_LENGTH} chars · helps categorize content for the network
      </p>
    </div>
  );
}
