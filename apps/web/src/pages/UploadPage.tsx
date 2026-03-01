import { useState } from "react";
import { UploadPipeline } from "../components/upload/UploadPipeline";
import { DragDropZone } from "../components/upload/DragDropZone";
import { useUploadPipeline } from "../hooks/useUploadPipeline";
import { useTextPost } from "../hooks/useTextPost";
import { FileText, Upload, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

type Mode = "text" | "file";

export default function UploadPage() {
  const [mode, setMode] = useState<Mode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const pipeline = useUploadPipeline();
  const textPost = useTextPost();

  const isIdle =
    pipeline.progress.stage === "idle" || pipeline.progress.stage === "error";
  const isTextIdle =
    textPost.state.stage === "idle" || textPost.state.stage === "error";

  const canPublish =
    mode === "file" ? !!file : description.trim().length > 0;

  const handlePublish = async () => {
    if (mode === "file" && file) {
      await pipeline.start(file, title, description);
    } else if (mode === "text") {
      await textPost.publish(description);
    }
  };

  const handleClear = () => {
    setFile(null);
    setTitle("");
    setDescription("");
    pipeline.cancel();
    textPost.reset();
  };

  const showPipelineProgress =
    pipeline.progress.stage !== "idle" && pipeline.progress.stage !== "error";
  const uploadDone = pipeline.progress.stage === "done";
  const textDone = textPost.state.stage === "done";

  return (
    <div className="panel flex flex-col gap-6 max-w-2xl mx-auto w-full">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Publish</h1>
      </div>

      {/* Mode switcher */}
      <div className="flex gap-1 p-1 bg-white/5 rounded-xl border border-border">
        <button
          onClick={() => { setMode("file"); handleClear(); }}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${
            mode === "file"
              ? "bg-primary text-background shadow-sm"
              : "text-muted hover:text-white"
          }`}
        >
          <Upload size={15} />
          Upload file
        </button>
        <button
          onClick={() => { setMode("text"); handleClear(); }}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${
            mode === "text"
              ? "bg-primary text-background shadow-sm"
              : "text-muted hover:text-white"
          }`}
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
          <div className="flex flex-col gap-4">
            <DragDropZone onFileSelected={setFile} selectedFile={file} />

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-muted">Title (optional)</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="bg-background/50 border border-border rounded-md px-3 py-2 text-white outline-none focus:border-primary/50 transition-colors"
                placeholder="Give your content a title"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-muted">Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="bg-background/50 border border-border rounded-md px-3 py-2 text-white min-h-[100px] outline-none resize-none focus:border-primary/50 transition-colors"
                placeholder="Tell others what this is about..."
              />
            </div>

            {pipeline.progress.error && (
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-md text-sm">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                {pipeline.progress.error}
              </div>
            )}

            <div className="flex justify-end gap-3 mt-2">
              <button
                onClick={handleClear}
                disabled={!file}
                className="px-4 py-2 rounded-md hover:bg-white/5 transition-colors disabled:opacity-40"
              >
                Clear
              </button>
              <button
                onClick={handlePublish}
                disabled={!canPublish}
                className="bg-primary hover:bg-accent text-background px-6 py-2 rounded-md font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
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
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <CheckCircle2 size={40} className="text-green-400" />
            <p className="text-white font-medium">Note published!</p>
            <button onClick={handleClear} className="text-sm text-muted hover:text-white transition-colors">
              Write another
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-muted">Your note</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="bg-background/50 border border-border rounded-md px-3 py-3 text-white min-h-[140px] outline-none resize-none focus:border-primary/50 transition-colors"
                placeholder="What's on your mind?"
              />
            </div>

            {textPost.state.error && (
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-md text-sm">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                {textPost.state.error}
              </div>
            )}

            <div className="flex justify-end gap-3 mt-2">
              <button
                onClick={handleClear}
                disabled={!description}
                className="px-4 py-2 rounded-md hover:bg-white/5 transition-colors disabled:opacity-40"
              >
                Clear
              </button>
              <button
                onClick={handlePublish}
                disabled={!canPublish || !isTextIdle}
                className="bg-primary hover:bg-accent text-background px-6 py-2 rounded-md font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
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
  );
}
