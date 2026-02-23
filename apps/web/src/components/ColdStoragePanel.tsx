import { useColdStorage } from "../hooks/useColdStorage";
import type { ColdStorageAssignmentPayload } from "../lib/extension-bridge";

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function AssignmentRow({
  assignment,
  isReleasing,
  onRelease
}: {
  assignment: ColdStorageAssignmentPayload;
  isReleasing: boolean;
  onRelease: () => void;
}) {
  const expiresIn = assignment.expiresAt - Date.now();
  const expiresLabel = expiresIn > 0 ? `expires in ${formatDuration(expiresIn)}` : "expired";

  return (
    <li className="cold-assignment-row">
      <div className="cold-assignment-info">
        <code>{assignment.chunkHash.slice(0, 14)}…</code>
        <span className="cold-meta">
          root: <code>{assignment.rootHash.slice(0, 10)}…</code>
          {" · "}credits: {assignment.premiumCredits}
          {" · "}{expiresLabel}
        </span>
      </div>
      <button
        type="button"
        className="cold-release-btn"
        onClick={onRelease}
        disabled={isReleasing}
      >
        {isReleasing ? "Releasing…" : "Release"}
      </button>
    </li>
  );
}

export function ColdStoragePanel() {
  const { status, isLoading, isReleasing, error, refresh, release } = useColdStorage();

  return (
    <section className="panel cold-storage-panel">
      <div className="panel-header">
        <h2>Cold Storage</h2>
        <button type="button" onClick={() => void refresh()} disabled={isLoading}>
          {isLoading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {status ? (
        <>
          <p className="cold-summary">
            {status.assignments.length} assignment(s) active
            {" · "}
            {status.totalPremiumCredits} premium credits
          </p>

          {status.assignments.length === 0 ? (
            <p className="muted">No active cold storage assignments.</p>
          ) : (
            <ul className="cold-assignment-list">
              {status.assignments.map((assignment) => (
                <AssignmentRow
                  key={assignment.chunkHash}
                  assignment={assignment}
                  isReleasing={isReleasing === assignment.chunkHash}
                  onRelease={() => void release({ chunkHash: assignment.chunkHash })}
                />
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="muted">No cold storage data received yet.</p>
      )}
    </section>
  );
}
