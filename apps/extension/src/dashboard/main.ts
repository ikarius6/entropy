import type { NodeStatusPayload } from "../shared/messaging";
import { requestNodeStatus, subscribeNodeStatusUpdates } from "../shared/status-client";

const refreshButton = document.getElementById("refresh");
const statusElement = document.getElementById("status");

function renderStatus(status: NodeStatusPayload): string {
  return [
    `Delegated roots: ${status.delegatedCount}`,
    `Known roots: ${status.delegatedRootHashes.join(", ") || "none"}`,
    `Uptime: ${Math.floor(status.uptimeMs / 1000)}s`,
    `Last heartbeat: ${new Date(status.lastHeartbeatAt).toLocaleString()}`,
    `Signaling kinds: ${status.signalingKindRange}`,
    `Signaling healthy: ${status.signalingRangeHealthy ? "yes" : "no"}`
  ].join("\n");
}

async function refresh(): Promise<void> {
  if (!(statusElement instanceof HTMLElement)) {
    return;
  }

  statusElement.textContent = "Loading...";

  try {
    const status = await requestNodeStatus();
    statusElement.textContent = renderStatus(status);
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

  statusElement.textContent = renderStatus(status);
});

window.addEventListener("beforeunload", () => {
  unsubscribeStatusUpdates();
});

void refresh();
