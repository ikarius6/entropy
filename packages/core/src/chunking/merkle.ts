import { concatBytes, hexToBytes, sha256Hex } from "../crypto/hash";

export async function hashMerklePair(leftHash: string, rightHash: string): Promise<string> {
  const left = hexToBytes(leftHash);
  const right = hexToBytes(rightHash);
  return sha256Hex(concatBytes(left, right));
}

export async function buildMerkleLayers(leaves: string[]): Promise<string[][]> {
  if (leaves.length === 0) {
    return [[await sha256Hex(new Uint8Array())]];
  }

  const layers: string[][] = [leaves.slice()];

  while (layers[layers.length - 1].length > 1) {
    const currentLayer = layers[layers.length - 1];
    const nextLayer: string[] = [];

    for (let index = 0; index < currentLayer.length; index += 2) {
      const left = currentLayer[index];
      const right = currentLayer[index + 1] ?? left;
      nextLayer.push(await hashMerklePair(left, right));
    }

    layers.push(nextLayer);
  }

  return layers;
}

export async function computeMerkleRoot(leaves: string[]): Promise<string> {
  const layers = await buildMerkleLayers(leaves);
  return layers[layers.length - 1][0];
}
