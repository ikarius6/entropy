import type { CreditSummaryPayload, NodeStatusPayload } from "../shared/messaging";
import {
  requestCreditSummary,
  requestNodeStatus,
  subscribeCreditUpdates,
  subscribeNodeStatusUpdates
} from "../shared/status-client";

const statusElement = document.getElementById("status");
const refreshButton = document.getElementById("refresh");
const openDashboardButton = document.getElementById("open-dashboard");

let latestStatus: NodeStatusPayload | null = null;
let latestCredits: CreditSummaryPayload | null = null;

function formatCredits(summary: CreditSummaryPayload): string[] {
  const ratioLabel =
    typeof summary.ratio === "number" && Number.isFinite(summary.ratio)
      ? summary.ratio.toFixed(2)
      : "∞";

  return [
    `Balance: ${(summary.balance / (1024 * 1024)).toFixed(2)} MB`,
    `Ratio: ${ratioLabel}`,
    `Eligible cold storage: ${summary.coldStorageEligible ? "yes" : "no"}`
  ];
}

function renderStatus(): string {
  if (!latestStatus) {
    return "Loading node status...";
  }

  const nodeLines = [
    `Delegated roots: ${latestStatus.delegatedCount}`,
    `Uptime: ${Math.floor(latestStatus.uptimeMs / 1000)}s`,
    `Last heartbeat: ${new Date(latestStatus.lastHeartbeatAt).toLocaleTimeString()}`,
    `Signaling kinds: ${latestStatus.signalingKindRange}`,
    `Signaling healthy: ${latestStatus.signalingRangeHealthy ? "yes" : "no"}`,
    `Roots: ${latestStatus.delegatedRootHashes.join(", ") || "none"}`
  ];

  if (!latestCredits) {
    return nodeLines.join("\n");
  }

  return [...nodeLines, "", "Credits", ...formatCredits(latestCredits)].join("\n");
}

async function refreshStatus(): Promise<void> {
  if (!(statusElement instanceof HTMLElement)) {
    return;
  }

  statusElement.textContent = "Loading node status...";

  try {
    const [status, credits] = await Promise.all([requestNodeStatus(), requestCreditSummary()]);
    latestStatus = status;
    latestCredits = credits;
    statusElement.textContent = renderStatus();
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

  latestStatus = status;
  statusElement.textContent = renderStatus();
});

const unsubscribeCreditUpdates = subscribeCreditUpdates((summary) => {
  if (!(statusElement instanceof HTMLElement)) {
    return;
  }

  latestCredits = summary;
  statusElement.textContent = renderStatus();
});

window.addEventListener("beforeunload", () => {
  unsubscribeStatusUpdates();
  unsubscribeCreditUpdates();
});

void refreshStatus();
