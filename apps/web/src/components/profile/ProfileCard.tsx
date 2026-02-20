import { Link } from "react-router-dom";
import { AvatarBadge } from "./ProfileHeader";
import type { NostrProfile } from "../../types/nostr";

interface ProfileCardProps {
  profile: NostrProfile | null;
  pubkey: string;
  compact?: boolean;
}

export function ProfileCard({ profile, pubkey, compact = false }: ProfileCardProps) {
  return (
    <Link 
      to={`/profile/${pubkey}`}
      className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors border border-transparent hover:border-border/50"
    >
      <AvatarBadge profile={profile} pubkey={pubkey} size={compact ? "sm" : "md"} />
      <div className="flex flex-col min-w-0">
        <span className="font-semibold truncate">
          {profile?.name || profile?.displayName || "Anonymous Node"}
        </span>
        <span className="text-xs text-muted truncate font-mono">
          {profile?.nip05 || `${pubkey.slice(0, 8)}...`}
        </span>
      </div>
    </Link>
  );
}
