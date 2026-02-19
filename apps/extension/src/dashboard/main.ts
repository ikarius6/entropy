import {
  createIndexedDbChunkStore,
  createIndexedDbQuotaManager,
  type QuotaInfo,
  type StoredChunk
} from "@entropy/core";

import type { CreditSummaryPayload, NodeStatusPayload } from "../shared/messaging";
import {
  importRuntimeKeypair,
  requestCreditSummary,
  requestNodeStatus,
  requestPublicKey,
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
