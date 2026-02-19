import { type ChangeEvent, useMemo, useState } from "react";

import {
  ENTROPY_CHUNK_MAP_KIND,
  buildEntropyChunkMapEvent,
  chunkFile,
  type ChunkingResult
} from "@entropy/core";

import { NodeStatusPanel } from "./components/NodeStatusPanel";
import { delegateSeeding } from "./lib/extension-bridge";

interface GeneratedArtifacts {
  chunking: ChunkingResult;
  eventJson: string;
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

export function App(): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [isChunking, setIsChunking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extensionWarning, setExtensionWarning] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<GeneratedArtifacts | null>(null);

  const estimatedChunks = useMemo(() => {
    if (!file) {
      return 0;
    }

    return Math.ceil(file.size / (5 * 1024 * 1024));
  }, [file]);

  async function generateChunkMap(): Promise<void> {
    if (!file) {
      setError("Select a file before generating the chunk map.");
      return;
    }

    setError(null);
    setExtensionWarning(null);
    setIsChunking(true);

    try {
      const chunking = await chunkFile(await file.arrayBuffer());
      const delegationPayload = {
        rootHash: chunking.rootHash,
        chunkHashes: chunking.chunkHashes,
        size: chunking.totalSize,
        chunkSize: chunking.chunkSize,
        mimeType: chunking.mimeType,
        title: file.name
      };

      const event = buildEntropyChunkMapEvent({
        chunkMap: {
          rootHash: delegationPayload.rootHash,
          chunks: delegationPayload.chunkHashes,
          size: delegationPayload.size,
          chunkSize: delegationPayload.chunkSize,
          mimeType: delegationPayload.mimeType,
          title: delegationPayload.title
        },
        content: `Entropy chunk map for ${file.name}`
      });

      void delegateSeeding(delegationPayload).catch((caughtError) => {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "Extension bridge did not accept the delegation request.";

        setExtensionWarning(message);
      });

      setArtifacts({
        chunking,
        eventJson: JSON.stringify(event, null, 2)
      });
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Unknown error during chunking.";
      setError(message);
    } finally {
      setIsChunking(false);
    }
  }

  return (
    <main className="layout">
      <section className="panel hero">
        <p className="eyebrow">Entropy Phase 1</p>
        <h1>Chunk Map Generator (kind {ENTROPY_CHUNK_MAP_KIND})</h1>
        <p>
          Upload a file, split it into blind chunks, compute its Merkle root, and generate a Nostr chunk-map
          event ready for relay publication.
        </p>

        <label className="file-picker" htmlFor="file-input">
          <input
            id="file-input"
            type="file"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setFile(event.target.files?.[0] ?? null);
              setArtifacts(null);
              setError(null);
              setExtensionWarning(null);
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

        <button type="button" onClick={generateChunkMap} disabled={!file || isChunking}>
          {isChunking ? "Generating..." : "Generate chunk map"}
        </button>

        {error ? <p className="error">{error}</p> : null}
        {extensionWarning ? <p className="warning">{extensionWarning}</p> : null}
      </section>

      {artifacts ? (
        <section className="panel output">
          <h2>Generated artifacts</h2>
          <ul>
            <li>Root hash: {artifacts.chunking.rootHash}</li>
            <li>Chunk count: {artifacts.chunking.chunkHashes.length}</li>
            <li>Total size: {formatBytes(artifacts.chunking.totalSize)}</li>
          </ul>

          <pre>{artifacts.eventJson}</pre>
        </section>
      ) : null}

      <NodeStatusPanel />
    </main>
  );
}
