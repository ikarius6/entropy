import browser from "webextension-polyfill";
import { DEFAULT_NETWORK_TAG } from "@entropy/core";

const STORAGE_KEY = "entropyNetworkTags";

export async function getNetworkTags(): Promise<string[]> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEY);
    const tags = result[STORAGE_KEY];

    if (!Array.isArray(tags) || tags.length === 0) {
      return [DEFAULT_NETWORK_TAG];
    }

    return tags.filter((t: unknown) => typeof t === "string" && t.trim().length > 0);
  } catch {
    return [DEFAULT_NETWORK_TAG];
  }
}

export async function setNetworkTags(tags: string[]): Promise<string[]> {
  const cleaned = tags
    .filter((t) => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim().toLowerCase());

  const final = cleaned.length > 0 ? [...new Set(cleaned)] : [DEFAULT_NETWORK_TAG];

  await browser.storage.local.set({ [STORAGE_KEY]: final });

  return final;
}
