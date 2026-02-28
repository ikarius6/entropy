import { useParams } from "react-router-dom";
import { useNostrProfile } from "../hooks/useNostrProfile";
import { useNostrFeed } from "../hooks/useNostrFeed";
import { useNip05Resolve } from "../hooks/useNip05Resolve";
import { ProfileHeader } from "../components/profile/ProfileHeader";
import { useEntropyStore } from "../stores/entropy-store";
import { useFollow } from "../hooks/useFollow";
import { useContactList } from "../hooks/useContactList";
import { KINDS } from "../lib/constants";

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

  // Fetch only kind:7001 events published by this profile
  const { items: publications, isLoading: feedLoading } = useNostrFeed(
    targetPubkey
      ? { authors: [targetPubkey], kinds: [KINDS.ENTROPY_CHUNK_MAP], limit: 30 }
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
      
      <div className="panel p-6 mt-4">
        <h3 className="text-xl font-bold mb-4 border-b border-border pb-2">
          Publications {publications.length > 0 && <span className="text-muted font-normal text-base">({publications.length})</span>}
        </h3>

        {feedLoading ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 rounded-lg bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : publications.length === 0 ? (
          <div className="text-center py-12 text-muted">
            No publications yet.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {publications.map(item => {
              const title = item.tags.find(t => t[0] === "title")?.[1] ?? item.content ?? "Untitled";
              const mime = item.tags.find(t => t[0] === "mime")?.[1] ?? "";
              const size = Number(item.tags.find(t => t[0] === "size")?.[1] ?? 0);
              const rootHash = item.tags.find(t => t[0] === "x-hash")?.[1] ?? "";
              const chunkCount = item.tags.filter(t => t[0] === "chunk").length;
              const date = new Date(item.created_at * 1000).toLocaleDateString();

              return (
                <div key={item.id} className="flex items-center gap-4 p-4 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                  <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center text-primary text-xl flex-shrink-0">
                    {mime.startsWith("video") ? "🎬" : mime.startsWith("audio") ? "🎵" : "📄"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{title}</div>
                    <div className="text-sm text-muted flex gap-3 mt-0.5">
                      {mime && <span>{mime}</span>}
                      {size > 0 && <span>{(size / 1024 / 1024).toFixed(1)} MB</span>}
                      <span>{chunkCount} chunks</span>
                      <span>{date}</span>
                    </div>
                    {rootHash && (
                      <div className="text-xs text-muted/60 font-mono mt-0.5 truncate">{rootHash}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
