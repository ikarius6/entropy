import type { ChangeEvent } from "react";

interface FilePickerSectionProps {
  file: File | null;
  estimatedChunks: number;
  isChunking: boolean;
  error: string | null;
  extensionWarning: string | null;
  onFileChange: (file: File | null) => void;
  onGenerate: () => void;
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

export function FilePickerSection({
  file,
  estimatedChunks,
  isChunking,
  error,
  extensionWarning,
  onFileChange,
  onGenerate
}: FilePickerSectionProps): JSX.Element {
  return (
    <section className="panel hero">
      <p className="eyebrow">Entropy Phase 1</p>
      <h1>Chunk Map Generator</h1>
      <p>
        Upload a file, split it into blind chunks, compute its Merkle root, and generate a Nostr chunk-map event ready
        for relay publication.
      </p>

      <label className="file-picker" htmlFor="file-input">
        <input
          id="file-input"
          type="file"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            onFileChange(event.target.files?.[0] ?? null);
          }}
        />
      </label>

      <div className="meta-grid">
        <div>
          <strong>Selected file</strong>
          <p>{file?.name ?? "None"}</p>
        </div>
        <div>
          <strong>Estimated chunks</strong>
          <p>{estimatedChunks}</p>
        </div>
        <div>
          <strong>Size</strong>
          <p>{file ? formatBytes(file.size) : "-"}</p>
        </div>
      </div>

      <button type="button" onClick={onGenerate} disabled={!file || isChunking}>
        {isChunking ? "Generating..." : "Generate chunk map"}
      </button>

      {error ? <p className="error">{error}</p> : null}
      {extensionWarning ? <p className="warning">{extensionWarning}</p> : null}
    </section>
  );
}
