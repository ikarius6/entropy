import { useRef, useEffect, useState } from "react";
import { Send, Loader2, CheckCircle2 } from "lucide-react";
import { useEntropyStore } from "../../stores/entropy-store";
import { useNostrProfile } from "../../hooks/useNostrProfile";
import { useTextPost } from "../../hooks/useTextPost";
import type { ReplyTo } from "../../hooks/useTextPost";
import { AvatarBadge } from "../profile/ProfileHeader";

interface ReplyComposerProps {
  replyTo: ReplyTo;
  /** Called after a reply is successfully published */
  onReplied?: () => void;
}

export function ReplyComposer({ replyTo, onReplied }: ReplyComposerProps) {
  const { pubkey } = useEntropyStore();
  const { profile } = useNostrProfile(pubkey ?? null);
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { state, publish, reset } = useTextPost();

  // Auto-focus when mounted
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Auto-expand textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const canPost = text.trim().length > 0;
  const isBusy = state.stage === "signing" || state.stage === "publishing";

  const handlePost = async () => {
    if (!canPost || isBusy) return;
    await publish(text, replyTo);
  };

  if (state.stage === "done") {
    return (
      <div className="flex items-center gap-2 text-green-400 text-sm py-2 px-3">
        <CheckCircle2 size={15} />
        Reply published!
        <button
          onClick={() => { reset(); setText(""); onReplied?.(); }}
          className="ml-auto text-muted hover:text-white transition-colors"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5 pt-2">
      {pubkey && (
        <div className="flex-shrink-0 mt-0.5">
          <AvatarBadge profile={profile} pubkey={pubkey} size="sm" />
        </div>
      )}
      <div className="flex-1 flex flex-col gap-2 min-w-0">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a reply…"
          rows={1}
          className="w-full bg-white/5 border border-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted resize-none outline-none focus:border-primary/50 transition-colors min-h-[36px] max-h-[150px]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handlePost();
          }}
        />

        {state.error && (
          <p className="text-red-400 text-xs">{state.error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={handlePost}
            disabled={!canPost || isBusy}
            className="flex items-center gap-1.5 bg-primary hover:bg-accent text-background text-xs font-semibold px-3 py-1.5 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isBusy ? (
              <><Loader2 size={13} className="animate-spin" /> Signing…</>
            ) : (
              <><Send size={13} /> Reply</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
