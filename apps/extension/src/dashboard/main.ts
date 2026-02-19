import type { CreditSummaryPayload, NodeStatusPayload } from "../shared/messaging";
import {
  requestCreditSummary,
  requestNodeStatus,
  subscribeCreditUpdates,
  subscribeNodeStatusUpdates
} from "../shared/status-client";

const refreshButton = document.getElementById("refresh");
const statusElement = document.getElementById("status");

let latestStatus: NodeStatusPayload | null = null;
let latestCredits: CreditSummaryPayload | null = null;

function formatCreditSummary(summary: CreditSummaryPayload): string[] {
  return [
    `Credit balance: ${(summary.balance / (1024 * 1024)).toFixed(2)} MB`,
    `Ratio: ${Number.isFinite(summary.ratio) ? summary.ratio.toFixed(2) : "∞"}`,
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

void refresh();
