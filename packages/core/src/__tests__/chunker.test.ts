import { describe, expect, it } from "vitest";

import { assembleChunks } from "../chunking/assembler";
import { chunkFile, estimateChunkCount } from "../chunking/chunker";

describe("chunker", () => {
  it("splits input data into deterministic chunks", async () => {
    const sourceText = "entropy-phase1-poc";
    const data = new TextEncoder().encode(sourceText);

    const result = await chunkFile(data, 4);

    expect(result.totalSize).toBe(data.byteLength);
    expect(result.chunkHashes.length).toBe(estimateChunkCount(data.byteLength, 4));
    expect(result.chunkHashes.length).toBe(5);
    expect(result.rootHash.length).toBe(64);

    const reconstructed = assembleChunks(result.chunks, "text/plain");
    const reconstructedText = new TextDecoder().decode(await reconstructed.arrayBuffer());

    expect(reconstructedText).toBe(sourceText);
  });

  it("returns zero chunks for empty size estimates", () => {
    expect(estimateChunkCount(0)).toBe(0);
  });
});
