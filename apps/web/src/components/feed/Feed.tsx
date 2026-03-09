import { useEffect, useState } from "react";
import { useNostrFeed, type FeedSortMode } from "../../hooks/useNostrFeed";
import { useTagPreferences } from "../../hooks/useTagPreferences";
import { PostCard } from "./PostCard";
import { Loader2, Zap, Globe, Sparkles } from "lucide-react";

type FeedFilter = "entropy" | "global";

export function Feed() {
  const [filter, setFilter] = useState<FeedFilter>("entropy");
  const [sortMode, setSortMode] = useState<FeedSortMode>("chronological");
  const { preferences, recordSignal } = useTagPreferences();
  const { items, isLoading, loadMore, removeItem } = useNostrFeed({
    entropyOnly: filter === "entropy",
    feedMode: sortMode,
    userPrefs: preferences,
  });

  // Infinite scroll intersection observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoading) {
          loadMore();
        }
      },
      { threshold: 1.0 }
    );
    
    const target = document.getElementById("feed-loader");
    if (target) observer.observe(target);

    return () => {
      if (target) observer.unobserve(target);
    };
  }, [isLoading, loadMore]);

  return (
    <div className="flex flex-col gap-4">
      {/* Feed filter + sort tabs */}
      <div className="panel px-4 py-3">
        <div className="tab-strip">
          <button
            onClick={() => setFilter("entropy")}
            className={`tab-button ${
              filter === "entropy"
                ? "tab-button--active"
                : ""
            }`}
          >
            <Zap size={14} />
            Entropy
          </button>
          <button
            onClick={() => setFilter("global")}
            className={`tab-button ${
              filter === "global"
                ? "tab-button--active"
                : ""
            }`}
          >
            <Globe size={14} />
            Open Network
          </button>
        </div>
        {filter === "entropy" && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(["chronological", "for_you", "explore"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setSortMode(m)}
                className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  sortMode === m
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-transparent text-muted hover:text-main"
                }`}
              >
                {m === "chronological" && "Latest"}
                {m === "for_you" && <><Sparkles size={11} /> For You</>}
                {m === "explore" && "Explore"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Feed items */}
      {items.length === 0 && !isLoading ? (
        <div className="empty-state flex flex-col items-center justify-center gap-4 px-8 py-10 text-center min-h-[30vh]">
          {filter === "entropy" ? (
            <>
              <Zap size={28} className="text-muted" />
              <h2 className="text-lg font-semibold text-main">No Entropy posts yet</h2>
              <p className="max-w-md text-sm text-muted">Connect to more relays or follow some users to see their publications.</p>
            </>
          ) : (
            <>
              <Globe size={28} className="text-muted" />
              <h2 className="text-lg font-semibold text-main">Nothing in the open network yet</h2>
              <p className="max-w-md text-sm text-muted">Connect to more relays to see posts from across Nostr.</p>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map(item => (
            <PostCard key={item.id} item={item} onSignal={recordSignal} onRemoveItem={removeItem} />
          ))}

          <div id="feed-loader" className="h-16 flex items-center justify-center text-muted">
            {isLoading && <Loader2 className="animate-spin" size={24} />}
            {!isLoading && items.length > 0 && (
              <span className="text-sm text-muted/60">
                {filter === "global" ? "Open network · read-only outside Entropy" : "End of feed"}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
