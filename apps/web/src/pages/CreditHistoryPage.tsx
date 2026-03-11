import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpCircle,
  ArrowDownCircle,
  AlertTriangle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  Search,
  Filter,
  TrendingUp,
  TrendingDown
} from "lucide-react";
import { getCreditHistory, type CreditHistoryPayload } from "../lib/extension-bridge";
import type { CreditHistoryEntryPayload } from "@entropy/core";

const PAGE_SIZE = 25;

function formatBytes(bytes: number): string {
  const abs = Math.abs(bytes);
  if (abs < 1024) return `${bytes} B`;
  if (abs < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (abs < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts * 1000);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function truncHash(hash: string, len = 8): string {
  if (hash.length <= len * 2) return hash;
  return hash.slice(0, len) + "…" + hash.slice(-4);
}

type DirectionFilter = "all" | "up" | "down";

export default function CreditHistoryPage() {
  const [history, setHistory] = useState<CreditHistoryPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<DirectionFilter>("all");
  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getCreditHistory();
      setHistory(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch credit history");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  const copyToClipboard = (text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // Filtered entries
  const filteredEntries = (history?.entries ?? []).filter((entry) => {
    if (filter !== "all" && entry.direction !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        entry.chunkHash.toLowerCase().includes(q) ||
        entry.peerPubkey.toLowerCase().includes(q) ||
        (entry.rootHash?.toLowerCase().includes(q) ?? false)
      );
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageEntries = filteredEntries.slice(
    clampedPage * PAGE_SIZE,
    (clampedPage + 1) * PAGE_SIZE
  );

  const duplicates = history?.duplicateChunks ?? [];
  const duplicateChunkSet = new Set(duplicates.map((d) => d.chunkHash));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Credit History</h1>
          <p className="text-sm text-muted mt-1">
            Full ledger of credit transactions — diagnose double charges and track flows
          </p>
        </div>
        <button
          onClick={() => void fetchHistory()}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-lg bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="panel border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          <AlertTriangle size={16} className="inline mr-2" />
          {error}
        </div>
      )}

      {/* Summary cards */}
      {history && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard
            label="Current Balance"
            value={formatBytes(history.currentBalance)}
            icon={<TrendingUp size={18} className="text-primary" />}
          />
          <SummaryCard
            label="Total Entries"
            value={String(history.totalEntries)}
            icon={<Filter size={18} className="text-muted" />}
          />
          <SummaryCard
            label="Duplicate Chunks"
            value={String(duplicates.length)}
            icon={<AlertTriangle size={18} className={duplicates.length > 0 ? "text-yellow-400" : "text-muted"} />}
            highlight={duplicates.length > 0}
          />
          <SummaryCard
            label="Wasted Credits"
            value={formatBytes(
              duplicates.reduce((sum, d) => sum + d.totalBytes - (d.totalBytes / d.count), 0)
            )}
            icon={<TrendingDown size={18} className={duplicates.length > 0 ? "text-red-400" : "text-muted"} />}
            highlight={duplicates.length > 0}
          />
        </div>
      )}

      {/* Duplicate chunk warning */}
      {duplicates.length > 0 && (
        <div className="panel border-yellow-500/30 bg-yellow-500/5 px-4 py-4 space-y-3">
          <div className="flex items-center gap-2 text-yellow-400 font-medium text-sm">
            <AlertTriangle size={16} />
            Double-Charge Detected — {duplicates.length} chunk{duplicates.length > 1 ? "s" : ""} charged multiple times
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted border-b border-border/50">
                  <th className="text-left py-1.5 pr-3 font-medium">Chunk Hash</th>
                  <th className="text-left py-1.5 pr-3 font-medium">Root Hash</th>
                  <th className="text-right py-1.5 pr-3 font-medium">Times Charged</th>
                  <th className="text-right py-1.5 font-medium">Total Bytes</th>
                </tr>
              </thead>
              <tbody>
                {duplicates.map((dup) => (
                  <tr key={dup.chunkHash} className="border-b border-border/20">
                    <td className="py-1.5 pr-3 font-mono text-yellow-300">
                      {truncHash(dup.chunkHash, 12)}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-muted">
                      {dup.rootHash ? truncHash(dup.rootHash, 10) : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-bold text-yellow-400">
                      {dup.count}×
                    </td>
                    <td className="py-1.5 text-right text-red-400">
                      {formatBytes(dup.totalBytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search by chunk hash, root hash, or peer pubkey…"
            className="w-full rounded-lg border border-border bg-surface pl-9 pr-3 py-2 text-sm placeholder:text-muted/60 focus:border-primary focus:outline-none"
          />
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden text-sm">
          {(["all", "up", "down"] as DirectionFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => { setFilter(f); setPage(0); }}
              className={`px-3 py-1.5 transition-colors ${
                filter === f
                  ? "bg-primary/20 text-primary font-medium"
                  : "text-muted hover:bg-surface-hover"
              }`}
            >
              {f === "all" ? "All" : f === "up" ? "↑ Earned" : "↓ Spent"}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isLoading && !history ? (
        <div className="panel px-6 py-12 text-center text-muted">
          <RefreshCw size={24} className="mx-auto animate-spin mb-3" />
          Loading credit history…
        </div>
      ) : pageEntries.length === 0 ? (
        <div className="panel px-6 py-12 text-center text-muted">
          {search || filter !== "all"
            ? "No entries match your filter."
            : "No credit history yet."}
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-xs border-b border-border">
                <th className="text-left py-2.5 px-3 font-medium">Type</th>
                <th className="text-left py-2.5 px-3 font-medium">Time</th>
                <th className="text-left py-2.5 px-3 font-medium">Peer</th>
                <th className="text-left py-2.5 px-3 font-medium">Chunk</th>
                <th className="text-left py-2.5 px-3 font-medium">Root</th>
                <th className="text-right py-2.5 px-3 font-medium">Bytes</th>
                <th className="text-right py-2.5 px-3 font-medium">Balance After</th>
                <th className="text-center py-2.5 px-3 font-medium w-8"></th>
              </tr>
            </thead>
            <tbody>
              {pageEntries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  isDuplicate={duplicateChunkSet.has(entry.chunkHash)}
                  copiedId={copiedId}
                  onCopy={copyToClipboard}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>
            Showing {clampedPage * PAGE_SIZE + 1}–{Math.min((clampedPage + 1) * PAGE_SIZE, filteredEntries.length)} of {filteredEntries.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={clampedPage === 0}
              className="rounded p-1 hover:bg-surface-hover disabled:opacity-30"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="font-mono">
              {clampedPage + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={clampedPage >= totalPages - 1}
              className="rounded p-1 hover:bg-surface-hover disabled:opacity-30"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  icon,
  highlight = false
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className={`panel px-4 py-3 ${highlight ? "border-yellow-500/30" : ""}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-muted font-medium">{label}</span>
      </div>
      <div className={`text-lg font-bold ${highlight ? "text-yellow-400" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  isDuplicate,
  copiedId,
  onCopy
}: {
  entry: CreditHistoryEntryPayload;
  isDuplicate: boolean;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  const isUp = entry.direction === "up";
  const rowBg = isDuplicate && !isUp
    ? "bg-yellow-500/5 hover:bg-yellow-500/10"
    : "hover:bg-surface-hover/50";

  return (
    <tr className={`border-b border-border/20 transition-colors ${rowBg}`}>
      {/* Direction */}
      <td className="py-2 px-3">
        <div className="flex items-center gap-1.5">
          {isUp ? (
            <ArrowUpCircle size={16} className="text-green-400" />
          ) : (
            <ArrowDownCircle size={16} className="text-red-400" />
          )}
          <span className={`text-xs font-medium ${isUp ? "text-green-400" : "text-red-400"}`}>
            {isUp ? "EARN" : "SPEND"}
          </span>
          {isDuplicate && !isUp && (
            <span title="Duplicate charge for this chunk">
              <AlertTriangle size={12} className="text-yellow-400 ml-0.5" />
            </span>
          )}
        </div>
      </td>

      {/* Time */}
      <td className="py-2 px-3 text-xs text-muted whitespace-nowrap">
        {formatTimestamp(entry.timestamp)}
      </td>

      {/* Peer */}
      <td className="py-2 px-3">
        <Link
          to={`/profile/${entry.peerPubkey}`}
          className="font-mono text-xs hover:underline text-primary/80"
          title={entry.peerPubkey}
        >
          {truncHash(entry.peerPubkey, 6)}
        </Link>
      </td>

      {/* Chunk hash */}
      <td className="py-2 px-3">
        <span
          className={`font-mono text-xs ${isDuplicate && !isUp ? "text-yellow-300" : "text-muted"}`}
          title={entry.chunkHash}
        >
          {truncHash(entry.chunkHash, 8)}
        </span>
      </td>

      {/* Root hash */}
      <td className="py-2 px-3">
        {entry.rootHash ? (
          <Link
            to={`/watch/${entry.rootHash}`}
            className="font-mono text-xs hover:underline text-primary/60"
            title={entry.rootHash}
          >
            {truncHash(entry.rootHash, 6)}
          </Link>
        ) : (
          <span className="text-xs text-muted/40">—</span>
        )}
      </td>

      {/* Bytes */}
      <td className="py-2 px-3 text-right">
        <span className={`font-mono text-xs font-medium ${isUp ? "text-green-400" : "text-red-400"}`}>
          {isUp ? "+" : "−"}{formatBytes(entry.bytes)}
        </span>
      </td>

      {/* Balance after */}
      <td className="py-2 px-3 text-right">
        <span className="font-mono text-xs font-medium">
          {formatBytes(entry.balanceAfter)}
        </span>
      </td>

      {/* Copy */}
      <td className="py-2 px-3 text-center">
        <button
          onClick={() => onCopy(
            JSON.stringify({
              id: entry.id,
              direction: entry.direction,
              peer: entry.peerPubkey,
              chunk: entry.chunkHash,
              root: entry.rootHash,
              bytes: entry.bytes,
              balance: entry.balanceAfter,
              time: formatTimestamp(entry.timestamp),
              receipt: entry.receiptSignature
            }, null, 2),
            entry.id
          )}
          className="rounded p-1 text-muted hover:text-primary hover:bg-surface-hover transition-colors"
          title="Copy entry details"
        >
          {copiedId === entry.id ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
        </button>
      </td>
    </tr>
  );
}
