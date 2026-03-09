import { useState } from "react";
import { UploadPipeline } from "../components/upload/UploadPipeline";
import { DragDropZone } from "../components/upload/DragDropZone";
import { useUploadPipeline } from "../hooks/useUploadPipeline";
import { useTextPost } from "../hooks/useTextPost";
import { FileText, Upload, Loader2, CheckCircle2, AlertCircle, Tag } from "lucide-react";

type Mode = "text" | "file";

export default function UploadPage() {
  const [mode, setMode] = useState<Mode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tag, setTag] = useState("");

  const pipeline = useUploadPipeline();
  const textPost = useTextPost();

  const isTextIdle =
    textPost.state.stage === "idle" || textPost.state.stage === "error";

  const canPublish =
    mode === "file" ? !!file : description.trim().length > 0;

  const handlePublish = async () => {
    if (mode === "file" && file) {
      await pipeline.start(file, title, description, tag.trim() || undefined);
    } else if (mode === "text") {
      await textPost.publish(description);
    }
  };

  const handleClear = () => {
    setFile(null);
    setTitle("");
    setDescription("");
    setTag("");
    pipeline.cancel();
    textPost.reset();
  };

  const showPipelineProgress =
    pipeline.progress.stage !== "idle" && pipeline.progress.stage !== "error";
  const uploadDone = pipeline.progress.stage === "done";
  const textDone = textPost.state.stage === "done";

  return (
    <div className="mx-auto flex w-full max-w-[52rem] flex-col gap-6 pb-10">
      <div className="mb-1 flex flex-col gap-2 border-b border-border/70 pb-4">
        <h1 className="text-[1.8rem] font-semibold tracking-tight">Publish</h1>
        <p className="max-w-2xl text-sm text-muted">Upload media to the network or publish a text note from the same workspace.</p>
      </div>

      <div className="panel flex flex-col gap-5 px-5 py-4 md:px-6">
        {/* Mode switcher */}
        <div className="tab-strip">
          <button
            onClick={() => { setMode("file"); handleClear(); }}
            className={`tab-button ${mode === "file" ? "tab-button--active" : ""}`}
          >
            <Upload size={15} />
            Upload file
          </button>
          <button
            onClick={() => { setMode("text"); handleClear(); }}
            className={`tab-button ${mode === "text" ? "tab-button--active" : ""}`}
          >
            <FileText size={15} />
            Text note
          </button>
        </div>

        {/* ── FILE MODE ─────────────────────────────────────────── */}
        {mode === "file" && (
          showPipelineProgress || uploadDone ? (
            <UploadPipeline progress={pipeline.progress} onCancel={handleClear} />
          ) : (
            <div className="flex flex-col gap-5">
              <DragDropZone onFileSelected={setFile} selectedFile={file} />

              <div className="flex flex-col gap-4 p-4">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-muted">Title (optional)</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="input-base"
                    placeholder="Give your content a title"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-1.5 text-sm font-medium text-muted">
                    <Tag size={13} />
                    Tag (optional)
                  </label>
                  <input
                    type="text"
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                    maxLength={20}
                    className="input-base"
                    placeholder="e.g. música, gaming, tutorial"
                  />
                  <p className="text-xs text-muted/60">One tag for content discovery (20 characters max)</p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-muted">Description (optional)</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="input-base min-h-[100px] resize-none px-3 py-2"
                    placeholder="Tell others what this is about..."
                  />
                </div>
              </div>

              {pipeline.progress.error && (
                <div className="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
                  <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                  {pipeline.progress.error}
                </div>
              )}

              <div className="mt-1 flex flex-wrap justify-end gap-3">
                <button
                  onClick={handleClear}
                  disabled={!file}
                  className="button-secondary px-4 py-2 text-sm"
                >
                  Clear
                </button>
                <button
                  onClick={handlePublish}
                  disabled={!canPublish}
                  className="button-primary px-6 py-2 text-sm"
                >
                  <Upload size={16} />
                  Upload &amp; Publish
                </button>
              </div>
            </div>
          )
        )}

        {/* ── TEXT MODE ─────────────────────────────────────────── */}
        {mode === "text" && (
          textDone ? (
            <div className="empty-state flex flex-col items-center gap-3 py-8 text-center">
              <CheckCircle2 size={40} className="text-green-400" />
              <p className="font-medium text-main">Note published!</p>
              <button onClick={handleClear} className="button-secondary px-4 py-2 text-sm">
                Write another
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="input-base min-h-[160px] resize-none px-3 py-3"
                  placeholder="What's on your mind?"
                />

              {textPost.state.error && (
                <div className="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
                  <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                  {textPost.state.error}
                </div>
              )}

              <div className="mt-1 flex flex-wrap justify-end gap-3">
                <button
                  onClick={handleClear}
                  disabled={!description}
                  className="button-secondary px-4 py-2 text-sm"
                >
                  Clear
                </button>
                <button
                  onClick={handlePublish}
                  disabled={!canPublish || !isTextIdle}
                  className="button-primary px-6 py-2 text-sm"
                >
                  {textPost.state.stage === "signing" || textPost.state.stage === "publishing" ? (
                    <><Loader2 size={16} className="animate-spin" /> Publishing…</>
                  ) : (
                    <><FileText size={16} /> Publish Note</>
                  )}
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
