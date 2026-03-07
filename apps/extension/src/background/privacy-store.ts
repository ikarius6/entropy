import browser from "webextension-polyfill";
import {
  DEFAULT_PRIVACY_SETTINGS,
  type PrivacySettingsPayload
} from "@entropy/core";

const PRIVACY_STORAGE_KEY = "entropyPrivacySettings";

interface PrivacyStorageSchema {
  [PRIVACY_STORAGE_KEY]?: PrivacySettingsPayload;
}

export async function getPrivacySettings(): Promise<PrivacySettingsPayload> {
  const result = (await browser.storage.local.get(PRIVACY_STORAGE_KEY)) as PrivacyStorageSchema;
  const stored = result[PRIVACY_STORAGE_KEY];

  if (!stored || typeof stored !== "object") {
    return { ...DEFAULT_PRIVACY_SETTINGS };
  }

  return {
    torEnabled: typeof stored.torEnabled === "boolean" ? stored.torEnabled : DEFAULT_PRIVACY_SETTINGS.torEnabled,
    torProxyAddress: typeof stored.torProxyAddress === "string" && stored.torProxyAddress.length > 0
      ? stored.torProxyAddress
      : DEFAULT_PRIVACY_SETTINGS.torProxyAddress,
    forceRelay: typeof stored.forceRelay === "boolean" ? stored.forceRelay : DEFAULT_PRIVACY_SETTINGS.forceRelay,
    turnServers: Array.isArray(stored.turnServers) ? stored.turnServers : DEFAULT_PRIVACY_SETTINGS.turnServers,
    filterLocalCandidates: typeof stored.filterLocalCandidates === "boolean"
      ? stored.filterLocalCandidates
      : DEFAULT_PRIVACY_SETTINGS.filterLocalCandidates,
  };
}

export async function setPrivacySettings(settings: PrivacySettingsPayload): Promise<PrivacySettingsPayload> {
  const sanitized: PrivacySettingsPayload = {
    torEnabled: settings.torEnabled,
    torProxyAddress: settings.torProxyAddress.trim() || DEFAULT_PRIVACY_SETTINGS.torProxyAddress,
    forceRelay: settings.forceRelay,
    turnServers: settings.turnServers.filter((s) => typeof s.urls === "string" && s.urls.trim().length > 0),
    filterLocalCandidates: settings.filterLocalCandidates,
  };

  await browser.storage.local.set({ [PRIVACY_STORAGE_KEY]: sanitized });

  return sanitized;
}
