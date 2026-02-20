import { useEffect } from "react";
import { useNostrFeed } from "../../hooks/useNostrFeed";
import { PostCard } from "./PostCard";
import { Loader2 } from "lucide-react";

export function Feed() {
  const { items, isLoading, loadMore } = useNostrFeed();

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

  if (items.length === 0 && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[30vh] text-center gap-4 border border-dashed border-border rounded-xl p-8 bg-white/5">
        <h2 className="text-xl font-bold text-white">No content yet</h2>
        <p className="text-muted max-w-md">Connect to more relays or follow some users to see their publications.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {items.map(item => (
        <PostCard key={item.id} item={item} />
      ))}
      
      <div id="feed-loader" className="h-16 flex items-center justify-center text-muted">
        {isLoading && <Loader2 className="animate-spin" size={24} />}
        {!isLoading && items.length > 0 && "End of feed"}
      </div>
    </div>
  );
}
