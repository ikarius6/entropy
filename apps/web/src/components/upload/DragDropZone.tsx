import { useRef, useState } from "react";
import { Upload } from "lucide-react";

interface DragDropZoneProps {
  onFileSelected: (file: File | null) => void;
  selectedFile: File | null;
}

export function DragDropZone({ onFileSelected, selectedFile }: DragDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelected(e.target.files[0]);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (selectedFile) {
    return (
      <div className="p-6 border border-border bg-surface/5 rounded-xl flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="font-medium text-main truncate" title={selectedFile.name}>{selectedFile.name}</div>
          <div className="text-sm text-muted">
            {selectedFile.type || "unknown"} • {formatSize(selectedFile.size)}
          </div>
        </div>
        <button 
          onClick={() => {
            if (fileInputRef.current) fileInputRef.current.value = "";
            onFileSelected(null);
          }}
          className="text-sm px-3 py-1.5 bg-surface/10 hover:bg-red-500/20 hover:text-red-400 rounded-md transition-colors flex-shrink-0"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div 
      className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center gap-4 transition-all cursor-pointer
        ${isDragging ? 'border-primary bg-primary/5' : 'border-border bg-surface/5 hover:bg-surface/10 hover:border-surface/20'}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
    >
      <input 
        type="file" 
        className="hidden" 
        ref={fileInputRef}
        onChange={handleFileChange}
      />
      <div className={`p-4 rounded-full ${isDragging ? 'bg-primary/20 text-primary' : 'bg-surface/5 text-muted'}`}>
        <Upload size={32} />
      </div>
      <div className="text-center">
        <div className="font-medium text-lg mb-1">Click to select or drag and drop</div>
        <div className="text-sm text-muted">Video, audio, images or any file type</div>
      </div>
    </div>
  );
}
