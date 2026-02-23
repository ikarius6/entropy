import { useMemo, useState } from "react";

import {
  ENTROPY_CHUNK_MAP_KIND,
  buildEntropyChunkMapEvent,
  chunkFile,
  type ChunkingResult
} from "@entropy/core";

import { ChunkMapOutput } from "./components/ChunkMapOutput";
import { ColdStoragePanel } from "./components/ColdStoragePanel";
import { CreditPanel } from "./components/CreditPanel";
import { FilePickerSection } from "./components/FilePickerSection";
import { NodeMetricsPanel } from "./components/NodeMetricsPanel";
import { NodeStatusPanel } from "./components/NodeStatusPanel";
import { delegateSeeding, storeChunk } from "./lib/extension-bridge";

interface GeneratedArtifacts {
  chunking: ChunkingResult;
  eventJson: string;
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

  function handleFileChange(nextFile: File | null): void {
    setFile(nextFile);
    setArtifacts(null);
    setError(null);
    setExtensionWarning(null);
  }

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

      void (async () => {
        try {
          for (const chunk of chunking.chunks) {
            const payload = chunk.data.slice();

            await storeChunk({
              hash: chunk.hash,
              rootHash: delegationPayload.rootHash,
              index: chunk.index,
              data: Array.from(payload)
            });
          }

          await delegateSeeding(delegationPayload);
        } catch (caughtError) {
          const message =
            caughtError instanceof Error
              ? caughtError.message
              : "Extension bridge did not accept the chunk storage/delegation request.";

          setExtensionWarning(message);
        }
      })();

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
      <FilePickerSection
        file={file}
        estimatedChunks={estimatedChunks}
        isChunking={isChunking}
        error={error}
        extensionWarning={extensionWarning}
        onFileChange={handleFileChange}
        onGenerate={generateChunkMap}
      />

      {artifacts ? <ChunkMapOutput chunking={artifacts.chunking} eventJson={artifacts.eventJson} /> : null}

      <NodeStatusPanel />
      <CreditPanel />
      <ColdStoragePanel />
      <NodeMetricsPanel />
    </main>
  );
}
