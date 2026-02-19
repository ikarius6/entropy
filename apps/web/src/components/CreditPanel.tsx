import { useCredits } from "../hooks/useCredits";

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatRatio(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) {
    return "∞";
  }

  return ratio.toFixed(2);
}

export function CreditPanel() {
  const { summary, isLoading, error, refresh } = useCredits();

  return (
    <section className="panel credit-panel">
      <div className="panel-header">
        <h2>Credit Engine</h2>
        <button type="button" onClick={() => void refresh()} disabled={isLoading}>
          {isLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {!summary ? (
        <p className="muted">No credit summary received yet.</p>
      ) : (
        <>
          <ul>
            <li>Ratio: {formatRatio(summary.ratio)}</li>
            <li>Balance: {formatMegabytes(summary.balance)}</li>
            <li>Uploaded: {formatMegabytes(summary.totalUploaded)}</li>
            <li>Downloaded: {formatMegabytes(summary.totalDownloaded)}</li>
            <li>Operations: {summary.entryCount}</li>
            <li>Cold storage eligible: {summary.coldStorageEligible ? "yes" : "no"}</li>
          </ul>

          <div className="credit-history">
            <p>Recent transfers</p>
            {summary.history.length === 0 ? (
              <p className="muted">No credit operations yet.</p>
            ) : (
              <ul>
                {summary.history.map((entry) => (
                  <li key={entry.id}>
                    <span className={`direction ${entry.direction}`}>
                      {entry.direction === "up" ? "↑" : "↓"}
                    </span>{" "}
                    {formatMegabytes(entry.bytes)} · {entry.chunkHash.slice(0, 12)}… ·{" "}
                    {new Date(entry.timestamp * 1000).toLocaleTimeString()}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
