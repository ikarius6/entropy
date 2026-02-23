import { useNodeMetrics } from "../hooks/useNodeMetrics";
import type { NodeMetricsPayload } from "../lib/extension-bridge";

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = Math.max(0, bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatUptime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function HealthBadge({ status }: { status: NodeMetricsPayload["healthStatus"] }) {
  const colorClass =
    status === "healthy"
      ? "health-badge--healthy"
      : status === "degraded"
        ? "health-badge--degraded"
        : "health-badge--unknown";

  return <span className={`health-badge ${colorClass}`}>{status}</span>;
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-row">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
}

export function NodeMetricsPanel() {
  const { metrics, isLoading, error, refresh } = useNodeMetrics();

  return (
    <section className="panel metrics-panel">
      <div className="panel-header">
        <h2>Node Metrics</h2>
        <button type="button" onClick={() => void refresh()} disabled={isLoading}>
          {isLoading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {metrics ? (
        <>
          <div className="metrics-health-row">
            <span className="metric-label">Health</span>
            <HealthBadge status={metrics.healthStatus} />
          </div>

          <MetricRow label="Uptime" value={formatUptime(metrics.uptimeMs)} />
          <MetricRow label="Chunks served" value={metrics.chunksServed.toString()} />
          <MetricRow label="Bytes served" value={formatBytes(metrics.bytesServed)} />
          <MetricRow label="Chunks downloaded" value={metrics.chunksDownloaded.toString()} />
          <MetricRow label="Bytes downloaded" value={formatBytes(metrics.bytesDownloaded)} />
          <MetricRow label="Peers connected" value={metrics.peersConnected.toString()} />
          <MetricRow
            label="Cold storage assignments"
            value={metrics.coldStorageAssignments.toString()}
          />
          <MetricRow
            label="Last health check"
            value={
              metrics.lastHealthCheck
                ? new Date(metrics.lastHealthCheck).toLocaleTimeString()
                : "never"
            }
          />
        </>
      ) : (
        <p className="muted">No metrics data received yet.</p>
      )}
    </section>
  );
}
