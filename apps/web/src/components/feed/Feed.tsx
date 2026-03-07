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
      <div className="flex flex-col gap-2">
        <div className="flex gap-1 p-1 bg-white/5 rounded-xl border border-border">
          <button
            onClick={() => setFilter("entropy")}
            className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg text-sm font-medium transition-all ${
              filter === "entropy"
                ? "bg-primary text-background shadow-sm"
                : "text-muted hover:text-white"
            }`}
          >
            <Zap size={14} />
            Entropy
          </button>
          <button
            onClick={() => setFilter("global")}
            className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg text-sm font-medium transition-all ${
              filter === "global"
                ? "bg-primary text-background shadow-sm"
                : "text-muted hover:text-white"
            }`}
          >
            <Globe size={14} />
            Open Network
          </button>
        </div>
        {filter === "entropy" && (
          <div className="flex gap-1 p-0.5 bg-white/[0.03] rounded-lg">
            {(["chronological", "for_you", "explore"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setSortMode(m)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1 rounded-md text-xs font-medium transition-all ${
                  sortMode === m
                    ? "bg-white/10 text-white"
                    : "text-muted/70 hover:text-white"
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
        <div className="flex flex-col items-center justify-center min-h-[30vh] text-center gap-4 border border-dashed border-border rounded-xl p-8 bg-white/5">
          {filter === "entropy" ? (
            <>
              <Zap size={32} className="text-muted" />
              <h2 className="text-xl font-bold text-white">No Entropy posts yet</h2>
              <p className="text-muted max-w-md">Connect to more relays or follow some users to see their publications.</p>
            </>
          ) : (
            <>
              <Globe size={32} className="text-muted" />
              <h2 className="text-xl font-bold text-white">Nothing in the open network yet</h2>
              <p className="text-muted max-w-md">Connect to more relays to see posts from across Nostr.</p>
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
