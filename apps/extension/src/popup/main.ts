import type { NodeStatusPayload } from "../shared/messaging";
import { requestNodeStatus, subscribeNodeStatusUpdates } from "../shared/status-client";

const statusElement = document.getElementById("status");
const refreshButton = document.getElementById("refresh");
const openDashboardButton = document.getElementById("open-dashboard");

function formatStatus(status: NodeStatusPayload): string {
  return [
    `Delegated roots: ${status.delegatedCount}`,
    `Uptime: ${Math.floor(status.uptimeMs / 1000)}s`,
    `Last heartbeat: ${new Date(status.lastHeartbeatAt).toLocaleTimeString()}`,
    `Signaling kinds: ${status.signalingKindRange}`,
    `Signaling healthy: ${status.signalingRangeHealthy ? "yes" : "no"}`,
    `Roots: ${status.delegatedRootHashes.join(", ") || "none"}`
  ].join("\n");
}

async function refreshStatus(): Promise<void> {
  if (!(statusElement instanceof HTMLElement)) {
    return;
  }

  statusElement.textContent = "Loading node status...";

  try {
    const status = await requestNodeStatus();
    statusElement.textContent = formatStatus(status);
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Unknown extension status error.";
    statusElement.textContent = `Failed to load status: ${message}`;
  }
}

async function openDashboard(): Promise<void> {
  if (!(statusElement instanceof HTMLElement)) {
    return;
  }

  try {
    await chrome.runtime.openOptionsPage();
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Failed to open Entropy dashboard.";
    statusElement.textContent = `Failed to open dashboard: ${message}`;
  }
}

if (refreshButton instanceof HTMLButtonElement) {
  refreshButton.addEventListener("click", () => {
    void refreshStatus();
  });
}

if (openDashboardButton instanceof HTMLButtonElement) {
  openDashboardButton.addEventListener("click", () => {
    void openDashboard();
  });
}

const unsubscribeStatusUpdates = subscribeNodeStatusUpdates((status) => {
  if (!(statusElement instanceof HTMLElement)) {
    return;
  }

  statusElement.textContent = formatStatus(status);
});

window.addEventListener("beforeunload", () => {
  unsubscribeStatusUpdates();
});

void refreshStatus();
