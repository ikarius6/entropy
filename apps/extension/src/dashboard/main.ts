import {
  createIndexedDbChunkStore,
  createIndexedDbQuotaManager,
  type QuotaInfo,
  type StoredChunk
} from "@entropy/core";

import type { ColdStorageAssignmentPayload, CreditSummaryPayload, NodeMetricsPayload, NodeStatusPayload } from "../shared/messaging";
import {
  addRuntimeRelay,
  importRuntimeKeypair,
  releaseColdStorageAssignment,
  removeRuntimeRelay,
  requestColdStorageAssignments,
  requestCreditSummary,
  requestExportIdentity,
  requestNodeMetrics,
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
const exportIdentityButton = document.getElementById("export-identity");
const importIdentityFileInput = document.getElementById("import-identity-file");
const seedingToggle = document.getElementById("seeding-toggle");
const seedingStatusElement = document.getElementById("seeding-status");
const coldStorageStatusElement = document.getElementById("cold-storage-status");
const coldStorageListElement = document.getElementById("cold-storage-list");
const refreshColdStorageButton = document.getElementById("refresh-cold-storage");
const metricsContentElement = document.getElementById("metrics-content");
const refreshMetricsButton = document.getElementById("refresh-metrics");

let latestStatus: NodeStatusPayload | null = null;
let latestCredits: CreditSummaryPayload | null = null;
let latestPubkey: string | null = null;
let latestColdAssignments: ColdStorageAssignmentPayload[] = [];
let latestMetrics: NodeMetricsPayload | null = null;

const chunkStore = createIndexedDbChunkStore();
const quotaManager = createIndexedDbQuotaManager(chunkStore);

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function setColdStorageStatus(message: string): void {
  if (!(coldStorageStatusElement instanceof HTMLElement)) {
    return;
  }

  coldStorageStatusElement.textContent = message;
}

function renderColdStorageList(assignments: ColdStorageAssignmentPayload[]): void {
  if (!(coldStorageListElement instanceof HTMLElement)) {
    return;
  }

  clearList(coldStorageListElement);

  if (assignments.length === 0) {
    appendListMessage(coldStorageListElement, "No active cold storage assignments.");
    return;
  }

  const now = Date.now();

  for (const assignment of assignments) {
    const item = document.createElement("li");
    item.className = "cold-assignment-item";

    const info = document.createElement("div");
    info.className = "cold-assignment-info";

    const expiresIn = assignment.expiresAt - now;
    const expiresLabel = expiresIn > 0 ? `expires in ${formatDuration(expiresIn)}` : "expired";

    info.innerHTML = [
      `<code>${assignment.chunkHash.slice(0, 14)}…</code>`,
      `root: <code>${assignment.rootHash.slice(0, 10)}…</code>`,
      `credits: ${assignment.premiumCredits}`,
      expiresLabel
    ].join(" · ");

    const releaseBtn = document.createElement("button");
    releaseBtn.textContent = "Release";
    releaseBtn.type = "button";
    releaseBtn.className = "cold-release-btn";
    releaseBtn.addEventListener("click", () => {
      void (async () => {
        setColdStorageStatus(`Releasing ${assignment.chunkHash.slice(0, 12)}…`);
        releaseBtn.disabled = true;

        try {
          const updated = await releaseColdStorageAssignment({ chunkHash: assignment.chunkHash });
          latestColdAssignments = updated.assignments;
          renderColdStorageList(latestColdAssignments);
          setColdStorageStatus(
            `Released. ${updated.assignments.length} assignment(s) active · ${updated.totalPremiumCredits} premium credits.`
          );
        } catch (caughtError) {
          const message = caughtError instanceof Error ? caughtError.message : "Unknown error.";
          setColdStorageStatus(`Release failed: ${message}`);
          releaseBtn.disabled = false;
        }
      })();
    });

    item.appendChild(info);
    item.appendChild(releaseBtn);
    coldStorageListElement.appendChild(item);
  }
}

async function refreshColdStorage(): Promise<void> {
  setColdStorageStatus("Loading cold storage assignments…");

  try {
    const status = await requestColdStorageAssignments();
    latestColdAssignments = status.assignments;
    renderColdStorageList(latestColdAssignments);

    const totalCredits = status.totalPremiumCredits;
    setColdStorageStatus(
      `${status.assignments.length} assignment(s) active · ${totalCredits} premium credits total.`
    );
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Unknown cold storage error.";
    setColdStorageStatus(`Cold storage unavailable: ${message}`);

    if (coldStorageListElement instanceof HTMLElement) {
      clearList(coldStorageListElement);
      appendListMessage(coldStorageListElement, "Could not load cold storage assignments.");
    }
  }
}

function renderMetrics(metrics: NodeMetricsPayload): void {
  if (!(metricsContentElement instanceof HTMLElement)) {
    return;
  }

  const healthClass =
    metrics.healthStatus === "healthy"
      ? "health-badge-ext--healthy"
      : metrics.healthStatus === "degraded"
        ? "health-badge-ext--degraded"
        : "health-badge-ext--unknown";

  const rows: Array<[string, string]> = [
    ["Health", `<span class="health-badge-ext ${healthClass}">${metrics.healthStatus}</span>`],
    ["Uptime", formatDuration(metrics.uptimeMs)],
    ["Chunks served", metrics.chunksServed.toString()],
    ["Bytes served", formatBytes(metrics.bytesServed)],
    ["Chunks downloaded", metrics.chunksDownloaded.toString()],
    ["Bytes downloaded", formatBytes(metrics.bytesDownloaded)],
    ["Peers connected", metrics.peersConnected.toString()],
    ["Cold assignments", metrics.coldStorageAssignments.toString()],
    [
      "Last health check",
      metrics.lastHealthCheck
        ? new Date(metrics.lastHealthCheck).toLocaleTimeString()
        : "never"
    ]
  ];

  metricsContentElement.innerHTML = rows
    .map(
      ([label, value]) =>
        `<div class="metric-row-ext"><span class="metric-label-ext">${label}</span><span class="metric-value-ext">${value}</span></div>`
    )
    .join("");
}

async function refreshMetrics(): Promise<void> {
  if (metricsContentElement instanceof HTMLElement) {
    metricsContentElement.textContent = "Loading…";
  }

  try {
    const metrics = await requestNodeMetrics();
    latestMetrics = metrics;
    renderMetrics(metrics);
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Unknown metrics error.";
    if (metricsContentElement instanceof HTMLElement) {
      metricsContentElement.textContent = `Metrics unavailable: ${message}`;
    }
  }
}

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
    await Promise.all([refreshInventory(), refreshColdStorage()]);
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

async function exportIdentityToFile(): Promise<void> {
  setKeyStatus("Exporting identity...");

  try {
    const identity = await requestExportIdentity();
    const json = JSON.stringify({
      pubkey: identity.pubkey,
      privkey: identity.privkey,
      exportedAt: new Date().toISOString()
    }, null, 2);

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `entropy-identity-${identity.pubkey.slice(0, 8)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);

    setKeyStatus(`Public key: ${identity.pubkey} (exported)`);
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Unknown export error.";
    setKeyStatus(`Export failed: ${message}`);
  }
}

async function importIdentityFromFile(file: File): Promise<void> {
  setKeyStatus("Importing identity from file...");

  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as { privkey?: string };

    if (typeof parsed.privkey !== "string" || parsed.privkey.length === 0) {
      setKeyStatus("Invalid identity file: missing private key.");
      return;
    }

    const payload = await importRuntimeKeypair({ privkey: parsed.privkey });
    latestPubkey = payload.pubkey;
    setKeyStatus(`Public key: ${payload.pubkey} (imported from file)`);
    await refresh();
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Unknown import error.";
    setKeyStatus(`Import from file failed: ${message}`);
  }
}

if (exportIdentityButton instanceof HTMLButtonElement) {
  exportIdentityButton.addEventListener("click", () => {
    void exportIdentityToFile();
  });
}

if (importIdentityFileInput instanceof HTMLInputElement) {
  importIdentityFileInput.addEventListener("change", () => {
    const file = importIdentityFileInput.files?.[0];
    if (file) {
      void importIdentityFromFile(file);
      importIdentityFileInput.value = "";
    }
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

if (refreshColdStorageButton instanceof HTMLButtonElement) {
  refreshColdStorageButton.addEventListener("click", () => {
    void refreshColdStorage();
  });
}

if (refreshMetricsButton instanceof HTMLButtonElement) {
  refreshMetricsButton.addEventListener("click", () => {
    void refreshMetrics();
  });
}

window.addEventListener("beforeunload", () => {
  unsubscribeStatusUpdates();
  unsubscribeCreditUpdates();
  chunkStore.close();
});

void refresh();
void refreshPublicKey();
void refreshInventory();
void refreshRelaySettings();
void refreshColdStorage();
void refreshMetrics();
