import { useState, useRef, useEffect } from "react";
import { Paperclip, X, Send, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useEntropyStore } from "../../stores/entropy-store";
import { useNostrProfile } from "../../hooks/useNostrProfile";
import { useTextPost } from "../../hooks/useTextPost";
import { useUploadPipeline } from "../../hooks/useUploadPipeline";
import { AvatarBadge } from "../profile/ProfileHeader";
import { DragDropZone } from "../upload/DragDropZone";
import { UploadPipeline } from "../upload/UploadPipeline";

export function PostComposer() {
  const { pubkey } = useEntropyStore();
  const { profile } = useNostrProfile(pubkey ?? null);

  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [showAttach, setShowAttach] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const textPost = useTextPost();
  const uploadPipeline = useUploadPipeline();

  // Auto-expand textarea height
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const isUploading =
    uploadPipeline.progress.stage !== "idle" &&
    uploadPipeline.progress.stage !== "error";
  const uploadDone = uploadPipeline.progress.stage === "done";
  const textDone = textPost.state.stage === "done";
  const isSigning = textPost.state.stage === "signing" || textPost.state.stage === "publishing";

  const canPost = !isUploading && !isSigning && (text.trim().length > 0 || !!file);

  const handlePost = async () => {
    if (!canPost) return;

    if (file) {
      // File path – use upload pipeline (text goes as description)
      await uploadPipeline.start(file, title || file.name, text);
    } else {
      // Text-only path
      await textPost.publish(text);
    }
  };

  const handleReset = () => {
    setText("");
    setFile(null);
    setTitle("");
    setShowAttach(false);
    uploadPipeline.cancel();
    textPost.reset();
  };

  // Show inline upload progress when uploading
  const showProgress = isUploading || uploadDone || uploadPipeline.progress.stage === "error";

  if (!pubkey) {
    return (
      <div className="panel p-5 flex items-center gap-4 opacity-60 select-none">
        <div className="w-10 h-10 rounded-full bg-white/10 flex-shrink-0" />
        <span className="text-muted text-sm">Connect your node to post...</span>
      </div>
    );
  }

  return (
    <div className="panel p-5 flex flex-col gap-4">
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="flex-shrink-0 mt-0.5">
          <AvatarBadge profile={profile} pubkey={pubkey} size="sm" />
        </div>

        {/* Main input area */}
        <div className="flex-1 flex flex-col gap-3 min-w-0">
          {showProgress ? (
            /* Upload pipeline progress – shown inline */
            <div className="flex flex-col gap-2">
              <UploadPipeline progress={uploadPipeline.progress} onCancel={handleReset} />
            </div>
          ) : textDone ? (
            <div className="flex items-center gap-2 text-green-400 py-2">
              <CheckCircle2 size={18} />
              <span className="text-sm font-medium">Posted!</span>
              <button onClick={handleReset} className="ml-auto text-muted hover:text-white text-sm transition-colors">
                Write another
              </button>
            </div>
          ) : (
            <>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What's happening on your node?"
                rows={1}
                className="w-full bg-transparent text-white placeholder:text-muted resize-none outline-none text-base leading-relaxed min-h-[42px] max-h-[300px] overflow-y-auto"
              />

              {/* File attachment area */}
              {showAttach && (
                <div className="flex flex-col gap-2">
                  <DragDropZone onFileSelected={setFile} selectedFile={file} />
                  {file && (
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Title (optional)"
                      className="bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm text-white placeholder:text-muted outline-none focus:border-primary/50 transition-colors"
                    />
                  )}
                </div>
              )}

              {/* Error states */}
              {(textPost.state.error || uploadPipeline.progress.error) && (
                <div className="flex items-start gap-2 p-2.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <span>{textPost.state.error || uploadPipeline.progress.error}</span>
                </div>
              )}

              {/* Action bar */}
              <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                {/* Attach toggle */}
                <button
                  onClick={() => {
                    setShowAttach((v) => !v);
                    if (showAttach) {
                      setFile(null);
                      setTitle("");
                    }
                  }}
                  title={showAttach ? "Remove attachment" : "Attach a file"}
                  className={`p-2 rounded-lg transition-colors ${
                    showAttach
                      ? "text-primary bg-primary/10"
                      : "text-muted hover:text-white hover:bg-white/5"
                  }`}
                >
                  {showAttach ? <X size={17} /> : <Paperclip size={17} />}
                </button>

                {/* File indicator pill */}
                {file && !showAttach && (
                  <span className="text-xs text-muted bg-white/5 px-2 py-1 rounded-md truncate max-w-[160px]">
                    📎 {file.name}
                  </span>
                )}

                {/* Post button */}
                <button
                  onClick={handlePost}
                  disabled={!canPost}
                  className="ml-auto flex items-center gap-2 bg-primary hover:bg-accent text-background px-4 py-1.5 rounded-lg font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSigning ? (
                    <><Loader2 size={15} className="animate-spin" /> Signing…</>
                  ) : file ? (
                    <><Send size={15} /> Upload & Post</>
                  ) : (
                    <><Send size={15} /> Post</>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
