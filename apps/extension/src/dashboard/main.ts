import {
  createIndexedDbChunkStore,
  createIndexedDbQuotaManager,
  type QuotaInfo,
  type StoredChunk
} from "@entropy/core";

import type { CreditSummaryPayload, NodeStatusPayload } from "../shared/messaging";
import {
  addRuntimeRelay,
  importRuntimeKeypair,
  removeRuntimeRelay,
  requestCreditSummary,
  requestNodeSettings,
  requestNodeStatus,
  requestPublicKey,
  setRuntimeSeedingActive,
  subscribeCreditUpdates,
  subscribeNodeStatusUpdates
} from "../shared/status-client";

const refreshButton = document.getElementById("refresh");
const loadPubkeyButton = document.getElementById("load-pubkey");
const importKeypairButton = document.getElementById("import-keypair");
const importPrivkeyInput = document.getElementById("import-privkey");
const statusElement = document.getElementById("status");
const keyStatusElement = document.getElementById("key-status");
const inventorySummaryElement = document.getElementById("inventory-summary");
const rootInventoryElement = document.getElementById("root-inventory");
const chunkInventoryElement = document.getElementById("chunk-inventory");
const quotaFillElement = document.getElementById("quota-fill");
const relayUrlInput = document.getElementById("relay-url-input");
const addRelayButton = document.getElementById("add-relay");
const relayListElement = document.getElementById("relay-list");
const relayStatusElement = document.getElementById("relay-status");
const seedingToggle = document.getElementById("seeding-toggle");
const seedingStatusElement = document.getElementById("seeding-status");

let latestStatus: NodeStatusPayload | null = null;
let latestCredits: CreditSummaryPayload | null = null;
let latestPubkey: string | null = null;

const chunkStore = createIndexedDbChunkStore();
const quotaManager = createIndexedDbQuotaManager(chunkStore);

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function setInventorySummary(message: string): void {
  if (!(inventorySummaryElement instanceof HTMLElement)) {
    return;
  }

  inventorySummaryElement.textContent = message;
}

function setQuotaFill(info: QuotaInfo): void {
  if (!(quotaFillElement instanceof HTMLElement)) {
    return;
  }

  const ratio = info.limit > 0 ? (info.used / info.limit) * 100 : 0;
  const clamped = Math.max(0, Math.min(100, ratio));
  quotaFillElement.style.width = `${clamped.toFixed(2)}%`;
}

function clearList(list: HTMLElement): void {
  while (list.firstChild) {
    list.removeChild(list.firstChild);
  }
}

function appendListMessage(list: HTMLElement, message: string): void {
  const item = document.createElement("li");
  item.textContent = message;
  list.appendChild(item);
}

function renderRootInventory(chunks: StoredChunk[]): number {
  if (!(rootInventoryElement instanceof HTMLElement)) {
    return 0;
  }

  clearList(rootInventoryElement);

  const grouped = new Map<string, { count: number; bytes: number; pinned: number }>();

  for (const chunk of chunks) {
    const entry = grouped.get(chunk.rootHash) ?? { count: 0, bytes: 0, pinned: 0 };
    entry.count += 1;
    entry.bytes += chunk.data.byteLength;
    entry.pinned += chunk.pinned ? 1 : 0;
    grouped.set(chunk.rootHash, entry);
  }

  if (grouped.size === 0) {
    appendListMessage(rootInventoryElement, "No delegated roots with stored chunks yet.");
    return 0;
  }

  const sortedRoots = [...grouped.entries()].sort((left, right) => right[1].bytes - left[1].bytes);

  for (const [rootHash, entry] of sortedRoots) {
    const item = document.createElement("li");
    item.textContent = `${rootHash.slice(0, 14)}... • ${entry.count} chunks • ${formatBytes(entry.bytes)}${
      entry.pinned > 0 ? ` • pinned ${entry.pinned}` : ""
    }`;
    rootInventoryElement.appendChild(item);
  }

  return grouped.size;
}

function renderChunkInventory(chunks: StoredChunk[]): void {
  if (!(chunkInventoryElement instanceof HTMLElement)) {
    return;
  }

  clearList(chunkInventoryElement);

  if (chunks.length === 0) {
    appendListMessage(chunkInventoryElement, "No chunks stored yet.");
    return;
  }

  const sorted = [...chunks].sort((left, right) => {
    if (left.rootHash === right.rootHash) {
      return left.index - right.index;
    }

    return left.rootHash.localeCompare(right.rootHash);
  });

  const visibleLimit = 80;

  for (const chunk of sorted.slice(0, visibleLimit)) {
    const item = document.createElement("li");
    item.textContent = `${chunk.rootHash.slice(0, 10)}... #${chunk.index} • ${chunk.hash.slice(0, 14)}... • ${formatBytes(
      chunk.data.byteLength
    )}${chunk.pinned ? " • pinned" : ""}`;
    chunkInventoryElement.appendChild(item);
  }

  if (sorted.length > visibleLimit) {
    appendListMessage(
      chunkInventoryElement,
      `${sorted.length - visibleLimit} more chunks not shown to keep dashboard responsive.`
    );
  }
}

async function refreshInventory(): Promise<void> {
  setInventorySummary("Loading inventory...");

  try {
    const [chunks, quotaInfo] = await Promise.all([
      chunkStore.listAllChunks(),
      quotaManager.getQuotaInfo()
    ]);

    const rootCount = renderRootInventory(chunks);
    renderChunkInventory(chunks);
    setQuotaFill(quotaInfo);

    const chunkBytes = chunks.reduce((total, chunk) => total + chunk.data.byteLength, 0);

    setInventorySummary(
      `${chunks.length} chunks • ${rootCount} roots • chunk bytes ${formatBytes(chunkBytes)} • storage ${formatBytes(
        quotaInfo.used
      )} / ${formatBytes(quotaInfo.limit)}`
    );
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Unknown inventory error.";
    setInventorySummary(`Inventory unavailable: ${message}`);

    if (rootInventoryElement instanceof HTMLElement) {
      clearList(rootInventoryElement);
      appendListMessage(rootInventoryElement, "Could not load root inventory.");
    }

    if (chunkInventoryElement instanceof HTMLElement) {
      clearList(chunkInventoryElement);
      appendListMessage(chunkInventoryElement, "Could not load chunk inventory.");
    }

    if (quotaFillElement instanceof HTMLElement) {
      quotaFillElement.style.width = "0%";
    }
  }
}

function setKeyStatus(message: string): void {
  if (!(keyStatusElement instanceof HTMLElement)) {
    return;
  }

  keyStatusElement.textContent = message;
}

async function refreshPublicKey(): Promise<void> {
  setKeyStatus("Public key: loading...");

  try {
    const payload = await requestPublicKey();
    latestPubkey = payload.pubkey;
    setKeyStatus(`Public key: ${payload.pubkey}`);
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Unknown public-key error.";
    setKeyStatus(`Public key: unavailable (${message})`);
  }
}

async function importKeypairFromInput(): Promise<void> {
  if (!(importPrivkeyInput instanceof HTMLInputElement)) {
    return;
  }

  const privkey = importPrivkeyInput.value.trim();

  if (privkey.length === 0) {
    setKeyStatus("Public key: provide a private key before importing.");
    return;
  }

  setKeyStatus("Public key: importing...");

  try {
    const payload = await importRuntimeKeypair({ privkey });
    latestPubkey = payload.pubkey;
    importPrivkeyInput.value = "";
    setKeyStatus(`Public key: ${payload.pubkey} (imported)`);
    await refresh();
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Unknown key import error.";
    setKeyStatus(`Public key: import failed (${message})`);
  }
}

function setRelayStatus(message: string): void {
  if (!(relayStatusElement instanceof HTMLElement)) {
    return;
  }

  relayStatusElement.textContent = message;
}

function setSeedingStatus(message: string): void {
  if (!(seedingStatusElement instanceof HTMLElement)) {
    return;
  }

  seedingStatusElement.textContent = message;
}

function renderRelayList(
  relayUrls: string[],
  relayStatuses: Array<{ url: string; status: string }>
): void {
  if (!(relayListElement instanceof HTMLElement)) {
    return;
  }

  clearList(relayListElement);

  if (relayUrls.length === 0) {
    appendListMessage(relayListElement, "No relays configured.");
    return;
  }

  const statusMap = new Map(relayStatuses.map((entry) => [entry.url, entry.status]));

  for (const url of relayUrls) {
    const status = statusMap.get(url) ?? "unknown";
    const item = document.createElement("li");
    item.className = "relay-item";

    const urlSpan = document.createElement("span");
    urlSpan.textContent = `${url} (${status})`;

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Remove";
    removeBtn.type = "button";
    removeBtn.className = "relay-remove-btn";
    removeBtn.addEventListener("click", () => {
      void (async () => {
        setRelayStatus("Removing relay...");

        try {
          const settings = await removeRuntimeRelay({ url });
          renderRelayList(settings.relayUrls, settings.relayStatuses);
          setRelayStatus(`Removed ${url}.`);
        } catch (caughtError) {
          const message = caughtError instanceof Error ? caughtError.message : "Unknown error.";
          setRelayStatus(`Remove failed: ${message}`);
        }
      })();
    });

    item.appendChild(urlSpan);
    item.appendChild(removeBtn);
    relayListElement.appendChild(item);
  }
}

async function refreshRelaySettings(): Promise<void> {
  setRelayStatus("Loading relay settings...");

  try {
    const settings = await requestNodeSettings();
    renderRelayList(settings.relayUrls, settings.relayStatuses);

    if (seedingToggle instanceof HTMLInputElement) {
      seedingToggle.checked = settings.seedingActive;
    }

    setRelayStatus(`${settings.relayUrls.length} relay(s) configured.`);
    setSeedingStatus(settings.seedingActive ? "Seeding is active." : "Seeding is paused.");
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Unknown relay error.";
    setRelayStatus(`Relay settings unavailable: ${message}`);
  }
}

async function addRelayFromInput(): Promise<void> {
  if (!(relayUrlInput instanceof HTMLInputElement)) {
    return;
  }

  const url = relayUrlInput.value.trim();

  if (url.length === 0) {
    setRelayStatus("Enter a relay URL before adding.");
    return;
  }

  setRelayStatus("Adding relay...");

  try {
    const settings = await addRuntimeRelay({ url });
    relayUrlInput.value = "";
    renderRelayList(settings.relayUrls, settings.relayStatuses);
    setRelayStatus(`Added ${url}.`);
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Unknown error.";
    setRelayStatus(`Add failed: ${message}`);
  }
}

async function onSeedingToggleChange(): Promise<void> {
  if (!(seedingToggle instanceof HTMLInputElement)) {
    return;
  }

  const active = seedingToggle.checked;
  setSeedingStatus(active ? "Enabling seeding..." : "Pausing seeding...");

  try {
    const settings = await setRuntimeSeedingActive({ active });
    setSeedingStatus(settings.seedingActive ? "Seeding is active." : "Seeding is paused.");
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Unknown error.";
    setSeedingStatus(`Toggle failed: ${message}`);
    seedingToggle.checked = !active;
  }
}

function formatCreditSummary(summary: CreditSummaryPayload): string[] {
  const ratioLabel =
    typeof summary.ratio === "number" && Number.isFinite(summary.ratio)
      ? summary.ratio.toFixed(2)
      : "∞";

  return [
    `Credit balance: ${(summary.balance / (1024 * 1024)).toFixed(2)} MB`,
    `Ratio: ${ratioLabel}`,
    `Transfers: ${summary.entryCount}`,
    `Cold storage eligible: ${summary.coldStorageEligible ? "yes" : "no"}`
  ];
}

function renderStatus(): string {
  if (!latestStatus) {
    return "Loading...";
  }

  const lines = [
    `Delegated roots: ${latestStatus.delegatedCount}`,
    `Known roots: ${latestStatus.delegatedRootHashes.join(", ") || "none"}`,
    `Uptime: ${Math.floor(latestStatus.uptimeMs / 1000)}s`,
    `Last heartbeat: ${new Date(latestStatus.lastHeartbeatAt).toLocaleString()}`,
    `Public key: ${latestPubkey ?? "unknown (click Load Public Key)"}`,
    `Signaling kinds: ${latestStatus.signalingKindRange}`,
    `Signaling healthy: ${latestStatus.signalingRangeHealthy ? "yes" : "no"}`
  ];

  if (!latestCredits) {
    return lines.join("\n");
  }

  return [...lines, "", "Credits", ...formatCreditSummary(latestCredits)].join("\n");
}

async function refresh(): Promise<void> {
  if (!(statusElement instanceof HTMLElement)) {
    return;
  }

  statusElement.textContent = "Loading...";

  try {
    const [status, credits] = await Promise.all([requestNodeStatus(), requestCreditSummary()]);
    await refreshInventory();
    latestStatus = status;
    latestCredits = credits;
    statusElement.textContent = renderStatus();
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Unknown dashboard error.";
    statusElement.textContent = `Error: ${message}`;
  }
}

if (refreshButton instanceof HTMLButtonElement) {
  refreshButton.addEventListener("click", () => {
    void refresh();
  });
}

if (loadPubkeyButton instanceof HTMLButtonElement) {
  loadPubkeyButton.addEventListener("click", () => {
    void refreshPublicKey();
  });
}

if (importKeypairButton instanceof HTMLButtonElement) {
  importKeypairButton.addEventListener("click", () => {
    void importKeypairFromInput();
  });
}

if (addRelayButton instanceof HTMLButtonElement) {
  addRelayButton.addEventListener("click", () => {
    void addRelayFromInput();
  });
}

if (relayUrlInput instanceof HTMLInputElement) {
  relayUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      void addRelayFromInput();
    }
  });
}

if (seedingToggle instanceof HTMLInputElement) {
  seedingToggle.addEventListener("change", () => {
    void onSeedingToggleChange();
  });
}

const unsubscribeStatusUpdates = subscribeNodeStatusUpdates((status) => {
  if (!(statusElement instanceof HTMLElement)) {
    return;
  }

  latestStatus = status;
  statusElement.textContent = renderStatus();
  void refreshInventory();
});

const unsubscribeCreditUpdates = subscribeCreditUpdates((summary) => {
  if (!(statusElement instanceof HTMLElement)) {
    return;
  }

  latestCredits = summary;
  statusElement.textContent = renderStatus();
  void refreshInventory();
});

window.addEventListener("beforeunload", () => {
  unsubscribeStatusUpdates();
  unsubscribeCreditUpdates();
  chunkStore.close();
});

void refresh();
void refreshPublicKey();
void refreshInventory();
void refreshRelaySettings();
