export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type HashInput = ArrayBuffer | ArrayBufferView;

export function toArrayBuffer(input: HashInput): ArrayBuffer {
  if (input instanceof ArrayBuffer) {
    return input;
  }

  const view = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

export function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim().toLowerCase();
  if (normalized.length % 2 !== 0) {
    throw new Error("Invalid hex string length.");
  }

  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return bytes;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);

  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function ensureSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto API is not available in this runtime.");
  }

  return subtle;
}

export async function sha256(data: HashInput): Promise<Uint8Array> {
  const subtle = ensureSubtleCrypto();
  const digest = await subtle.digest("SHA-256", toArrayBuffer(data));
  return new Uint8Array(digest);
}

export async function sha256Hex(data: HashInput): Promise<string> {
  const digest = await sha256(data);
  return bytesToHex(digest);
}
