import { useState } from "react";
import { useEntropyStore } from "../stores/entropy-store";
import { ENTROPY_TAG } from "@entropy/core";

export type TextPostStage = "idle" | "signing" | "publishing" | "done" | "error";

export interface TextPostState {
  stage: TextPostStage;
  error: string | null;
}

/** NIP-10 reply context */
export interface ReplyTo {
  rootId: string;         // Root event id of the thread
  parentId: string;       // Direct parent event id
  authorPubkey: string;   // Author of the parent event
}

const IDLE: TextPostState = { stage: "idle", error: null };

export function useTextPost() {
  const { relayPool } = useEntropyStore();
  const [state, setState] = useState<TextPostState>(IDLE);

  const publish = async (content: string, replyTo?: ReplyTo) => {
    if (!content.trim()) return;

    if (!window.nostr) {
      setState({ stage: "error", error: "NIP-07 signer not available. Is the Entropy extension enabled?" });
      return;
    }

    try {
      setState({ stage: "signing", error: null });

      // Build tags: replies get NIP-10 e/p markers; standalone posts get #t entropy tag
      const tags: string[][] = replyTo
        ? [
            ["e", replyTo.rootId, "", "root"],
            ["e", replyTo.parentId, "", "reply"],
            ["p", replyTo.authorPubkey],
          ]
        : [["t", ENTROPY_TAG]];

      const draft = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: content.trim(),
      };

      const signed = await window.nostr.signEvent(draft);

      setState({ stage: "publishing", error: null });

      if (relayPool) {
        relayPool.publish(signed as Parameters<typeof relayPool.publish>[0]);
      } else {
        console.warn("[useTextPost] no relayPool — event signed but not published");
      }

      setState({ stage: "done", error: null });

      // Reset back to idle after a moment so the composer can be reused
      setTimeout(() => setState(IDLE), 2000);
    } catch (err) {
      console.error("[useTextPost] error:", err);
      setState({
        stage: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const reset = () => setState(IDLE);

  return { state, publish, reset };
}

