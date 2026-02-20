import { useState } from "react";
import { UploadPipeline } from "../components/upload/UploadPipeline";
import { DragDropZone } from "../components/upload/DragDropZone";
import { useUploadPipeline } from "../hooks/useUploadPipeline";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const pipeline = useUploadPipeline();

  const handleStart = async () => {
    if (!file) return;
    await pipeline.start(file, title, description);
  };

  return (
    <div className="panel flex flex-col gap-6 max-w-2xl mx-auto w-full">
      <h1 className="text-2xl font-bold">Create Publication</h1>
      
      {pipeline.progress.stage === 'idle' || pipeline.progress.stage === 'error' ? (
        <div className="flex flex-col gap-4">
          <DragDropZone onFileSelected={setFile} selectedFile={file} />
          
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-muted">Title (optional)</label>
            <input 
              type="text" 
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="bg-background/50 border border-border rounded-md px-3 py-2 text-white"
              placeholder="Give your content a title"
            />
          </div>
          
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-muted">Description (optional)</label>
            <textarea 
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="bg-background/50 border border-border rounded-md px-3 py-2 text-white min-h-[100px]"
              placeholder="Tell others what this is about..."
            />
          </div>
          
          <div className="flex justify-end gap-3 mt-4">
            <button 
              onClick={() => {
                setFile(null);
                setTitle("");
                setDescription("");
              }}
              className="px-4 py-2 rounded-md hover:bg-white/5 transition-colors"
              disabled={!file}
            >
              Clear
            </button>
            <button 
              onClick={handleStart}
              className="bg-primary hover:bg-accent text-background px-6 py-2 rounded-md font-semibold transition-colors disabled:opacity-50"
              disabled={!file}
            >
              Upload & Publish
            </button>
          </div>
          
          {pipeline.progress.error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-md text-sm">
              {pipeline.progress.error}
            </div>
          )}
        </div>
      ) : (
        <UploadPipeline progress={pipeline.progress} onCancel={pipeline.cancel} />
      )}
    </div>
  );
}
