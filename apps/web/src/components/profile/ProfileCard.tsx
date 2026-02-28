import { Link } from "react-router-dom";
import { AvatarBadge } from "./ProfileHeader";
import type { NostrProfile } from "../../types/nostr";

interface ProfileCardProps {
  profile: NostrProfile | null;
  pubkey: string;
  compact?: boolean;
}

export function ProfileCard({ profile, pubkey, compact = false }: ProfileCardProps) {
  // Prefer alias route when nip05 is present
  const linkTarget = profile?.nip05 ? `/profile/${profile.nip05}` : `/profile/${pubkey}`;
  const displayName = profile?.displayName || profile?.name || "Anonymous Node";
  const alias = profile?.nip05;
  const shortKey = `${pubkey.slice(0, 8)}…`;

  return (
    <Link
      to={linkTarget}
      className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors border border-transparent hover:border-border/50"
    >
      <AvatarBadge profile={profile} pubkey={pubkey} size={compact ? "sm" : "md"} />
      <div className="flex flex-col min-w-0">
        <span className="font-semibold truncate">{displayName}</span>
        <span className="text-xs truncate flex items-center gap-1">
          {alias ? (
            <>
              <span className="text-accent">{alias}</span>
              <span className="text-green-400 text-[10px]" title="Verified NIP-05">✓</span>
            </>
          ) : (
            <span className="text-muted font-mono">{shortKey}</span>
          )}
        </span>
      </div>
    </Link>
  );
}
