import { useEffect, useRef, useState } from "react";
import { useNostrFeed, type FeedSortMode } from "../../hooks/useNostrFeed";
import { useTagPreferences } from "../../hooks/useTagPreferences";
import { PostCard } from "./PostCard";
import { Loader2, Zap, Globe, Sparkles } from "lucide-react";
import type { FeedItem } from "../../types/nostr";
import type { ContentTag, UserSignalType } from "@entropy/core";

type FeedFilter = "entropy" | "global";

// ─── Lazy mount wrapper ───────────────────────────────────────────────────────
// Only renders the real <PostCard> once the placeholder scrolls close to the
// viewport (rootMargin: 400px). This prevents hooks inside PostCard — profile
// fetches, reactions, reposts, content-tags — from opening relay subscriptions
// for off-screen posts the user may never see.

interface LazyPostCardProps {
  item: FeedItem;
  onSignal?: (contentTags: ContentTag[], signal: UserSignalType) => void;
  onRemoveItem?: (eventId: string) => void;
}

function LazyPostCard({ item, onSignal, onRemoveItem }: LazyPostCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect(); // stays rendered once visible — no unmount on scroll-up
        }
      },
      { rootMargin: "400px", threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  if (!visible) {
    // Placeholder with approximate card height to keep scroll stable
    return <div ref={ref} className="panel h-[140px]" aria-hidden />;
  }

  return <PostCard item={item} onSignal={onSignal} onRemoveItem={onRemoveItem} />;
}

// ─── Feed ─────────────────────────────────────────────────────────────────────

export function Feed() {
  const [filter, setFilter] = useState<FeedFilter>("entropy");
  const [sortMode, setSortMode] = useState<FeedSortMode>("chronological");
  const { preferences, recordSignal } = useTagPreferences();
  const { items, isLoading, loadMore, removeItem } = useNostrFeed({
    entropyOnly: filter === "entropy",
    feedMode: sortMode,
    userPrefs: preferences,
  });

  // Infinite scroll — fires 200 px before the sentinel enters the viewport so
  // the user never visually hits the end. threshold: 0 means "any intersection".
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoading) {
          loadMore();
        }
      },
      { rootMargin: "200px", threshold: 0 }
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
            <LazyPostCard key={item.id} item={item} onSignal={recordSignal} onRemoveItem={removeItem} />
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
