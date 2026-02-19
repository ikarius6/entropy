import { useExtensionNodeStatus } from "../hooks/useExtensionNodeStatus";

function formatSeconds(ms: number): number {
  return Math.max(0, Math.floor(ms / 1000));
}

function formatClock(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "-";
  }

  return new Date(timestamp).toLocaleTimeString();
}

export function NodeStatusPanel() {
  const { status, isLoading, error, refresh } = useExtensionNodeStatus();

  return (
    <section className="panel extension-status">
      <div className="panel-header">
        <h2>Extension Node Status</h2>
        <button type="button" onClick={() => void refresh()} disabled={isLoading}>
          {isLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {status ? (
        <ul>
          <li>Delegated roots: {status.delegatedCount}</li>
          <li>Uptime: {formatSeconds(status.uptimeMs)}s</li>
          <li>Last heartbeat: {formatClock(status.lastHeartbeatAt)}</li>
          <li>Signaling range: {status.signalingKindRange}</li>
          <li>Signaling healthy: {status.signalingRangeHealthy ? "yes" : "no"}</li>
        </ul>
      ) : (
        <p className="muted">No extension status received yet.</p>
      )}

      {status && status.delegatedRootHashes.length > 0 ? (
        <div className="root-list">
          <p>Delegated roots</p>
          <ul>
            {status.delegatedRootHashes.map((rootHash) => (
              <li key={rootHash}>
                <code>{rootHash}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
