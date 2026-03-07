import { useParams } from "react-router-dom";
import { useNostrProfile } from "../hooks/useNostrProfile";
import { useNostrFeed } from "../hooks/useNostrFeed";
import { useNip05Resolve } from "../hooks/useNip05Resolve";
import { ProfileHeader } from "../components/profile/ProfileHeader";
import { useEntropyStore } from "../stores/entropy-store";
import { useFollow } from "../hooks/useFollow";
import { useContactList } from "../hooks/useContactList";
import { KINDS } from "../lib/constants";
import { PostCard } from "../components/feed/PostCard";
import { Loader2 } from "lucide-react";

export default function ProfilePage() {
  const { pubkey: paramPubkey } = useParams<{ pubkey: string }>();
  const currentPubkey = useEntropyStore((s) => s.pubkey);

  // Determine if the param is a NIP-05 alias or a raw pubkey
  const isAlias = !!paramPubkey && paramPubkey.includes("@");
  const isMe = paramPubkey === "me" || (!isAlias && paramPubkey === currentPubkey);

  // For "me" or direct pubkey, skip the NIP-05 resolver
  const aliasInput = isMe ? null : (isAlias ? paramPubkey : null);
  const { resolvedPubkey, isResolving, error: resolveError } = useNip05Resolve(aliasInput);

  // The actual pubkey to load the profile for
  const targetPubkey = isMe
    ? currentPubkey
    : isAlias
    ? resolvedPubkey
    : (paramPubkey ?? null);

  const { profile, isLoading } = useNostrProfile(targetPubkey || null);
  const { follows } = useContactList(targetPubkey ?? null);
  const { isFollowing, toggle: toggleFollow, isPending: isFollowPending } = useFollow(
    isMe ? null : (targetPubkey ?? null)
  );

  // Fetch both kind:1 (text) and kind:7001 (media) from this profile
  const { items: posts, isLoading: feedLoading, removeItem } = useNostrFeed(
    targetPubkey
      ? { authors: [targetPubkey], kinds: [KINDS.TEXT_NOTE, KINDS.ENTROPY_CHUNK_MAP, KINDS.REPOST], limit: 50 }
      : { kinds: [] }
  );

  // NIP-05 resolution error
  if (resolveError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center gap-4">
        <h2 className="text-2xl font-bold">Could not resolve alias</h2>
        <p className="text-muted max-w-md">{resolveError}</p>
        <p className="text-xs text-muted/60 font-mono">{paramPubkey}</p>
      </div>
    );
  }

  // Still resolving the NIP-05 alias
  if (isResolving) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center gap-4">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-muted">Resolving <span className="text-accent font-mono">{paramPubkey}</span>…</p>
      </div>
    );
  }

  if (!targetPubkey) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center gap-4">
        <h2 className="text-2xl font-bold">Connect your node</h2>
        <p className="text-muted max-w-md">You need to connect to the Entropy extension to view your profile and start seeding.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full">
      {isLoading ? (
        <div className="panel h-64 animate-pulse bg-white/5" />
      ) : (
        <ProfileHeader 
          profile={profile} 
          pubkey={targetPubkey} 
          isCurrentUser={isMe} 
          followersCount={0}
          followingCount={follows.length}
          isFollowing={isFollowing}
          isFollowPending={isFollowPending}
          onFollow={toggleFollow}
        />
      )}
      
      <div className="flex flex-col gap-1 mt-2">
        <div className="px-1 pb-2 flex items-center gap-2">
          <h3 className="text-lg font-bold">
            Posts
          </h3>
          {posts.length > 0 && (
            <span className="text-muted font-normal text-sm">{posts.length}</span>
          )}
        </div>

        {feedLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted">
            <Loader2 className="animate-spin" size={28} />
            <span className="text-sm">Loading posts…</span>
          </div>
        ) : posts.length === 0 ? (
          <div className="panel flex flex-col items-center justify-center py-16 text-center gap-3">
            <span className="text-4xl">📭</span>
            <p className="text-muted">No posts yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {posts.map(item => (
              <PostCard key={item.id} item={item} onRemoveItem={removeItem} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
