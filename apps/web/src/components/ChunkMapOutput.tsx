import type { ChunkingResult } from "@entropy/core";

interface ChunkMapOutputProps {
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

export function ChunkMapOutput({ chunking, eventJson }: ChunkMapOutputProps): JSX.Element {
  return (
    <section className="panel output">
      <h2>Generated artifacts</h2>
      <ul>
        <li>Root hash: {chunking.rootHash}</li>
        <li>Chunk count: {chunking.chunkHashes.length}</li>
        <li>Total size: {formatBytes(chunking.totalSize)}</li>
      </ul>

      <pre>{eventJson}</pre>
    </section>
  );
}
