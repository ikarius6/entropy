import { ReactNode, useState } from "react";
import { User, Users, Pencil } from "lucide-react";
import type { NostrProfile } from "../../types/nostr";
import { EditProfileModal } from "./EditProfileModal";

interface ProfileHeaderProps {
  profile: NostrProfile | null;
  pubkey: string | null;
  followersCount?: number;
  followingCount?: number;
  isCurrentUser?: boolean;
  isFollowing?: boolean;
  isFollowPending?: boolean;
  onFollow?: () => void;
}

export function ProfileHeader({ 
  profile, 
  pubkey, 
  followersCount = 0, 
  followingCount = 0,
  isCurrentUser = false,
  isFollowing = false,
  isFollowPending = false,
  onFollow,
}: ProfileHeaderProps) {
  const [showEditModal, setShowEditModal] = useState(false);
  if (!pubkey) return null;

  return (
    <div className="panel overflow-hidden p-0 relative">
      {/* Banner */}
      <div 
        className="h-32 bg-gradient-to-r from-primary/20 to-accent/20 border-b border-border/50 bg-cover bg-center"
        style={profile?.banner ? { backgroundImage: `url(${profile.banner})` } : {}}
      />
      
      {/* Profile Info */}
      <div className="p-6 pt-0 relative">
        <div className="flex justify-between items-end mb-4">
          <div className="relative -mt-12">
            <AvatarBadge profile={profile} pubkey={pubkey} size="lg" />
          </div>
          
          <div>
            {isCurrentUser ? (
              <button
                onClick={() => setShowEditModal(true)}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium bg-white/10 hover:bg-white/20 transition-colors"
              >
                <Pencil size={14} />
                Edit Profile
              </button>
            ) : (
              <button
                onClick={onFollow}
                disabled={isFollowPending}
                className={`px-4 py-1.5 rounded-full transition-colors text-sm font-medium disabled:opacity-50 ${
                  isFollowing
                    ? "bg-primary/20 text-primary hover:bg-red-500/20 hover:text-red-400"
                    : "bg-white/10 hover:bg-white/20"
                }`}
              >
                {isFollowPending ? "…" : isFollowing ? "Following" : "Follow"}
              </button>
            )}
          </div>
        </div>
        
        <div>
          <h1 className="text-2xl font-bold">{profile?.name || profile?.displayName || "Anonymous Node"}</h1>
          <div className="flex items-center gap-2 text-muted text-sm mt-1 mb-4">
              <span className="font-mono bg-white/5 px-2 py-0.5 rounded text-xs"
              >{pubkey.slice(0, 12)}...{pubkey.slice(-4)}</span>
            {profile?.nip05 && (
              <span className="flex items-center gap-1 text-accent">
                {profile.nip05}
                <span className="text-green-400 text-[10px]" title="Verified NIP-05">✓</span>
              </span>
            )}
          </div>
          
          <p className="text-white/90 mb-4 whitespace-pre-wrap">
            {profile?.about || "No bio provided."}
          </p>
          
          <div className="flex items-center gap-4 text-sm text-muted">
            <div className="flex items-center gap-1.5">
              <Users size={16} />
              <span className="font-bold text-white">{followersCount}</span> Followers
            </div>
            <div className="flex items-center gap-1.5">
              <User size={16} />
              <span className="font-bold text-white">{followingCount}</span> Following
            </div>
          </div>
        </div>
      </div>

      {showEditModal && pubkey && (
        <EditProfileModal
          profile={profile}
          pubkey={pubkey}
          onClose={() => setShowEditModal(false)}
        />
      )}
    </div>
  );
}

interface AvatarBadgeProps {
  profile: NostrProfile | null;
  pubkey: string;
  size?: "sm" | "md" | "lg";
}

export function AvatarBadge({ profile, pubkey, size = "md" }: AvatarBadgeProps) {
  const sizeClasses = {
    sm: "w-8 h-8 text-xs",
    md: "w-12 h-12 text-sm",
    lg: "w-24 h-24 text-2xl border-4 border-panel",
  };
  
  // Use first letter of name or pubkey
  const initial = (profile?.name || profile?.displayName || pubkey).charAt(0).toUpperCase();

  return (
    <div 
      className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center font-bold text-background bg-cover bg-center shrink-0 shadow-lg`}
      style={profile?.picture ? { backgroundImage: `url(${profile.picture})` } : {}}
      title={profile?.name || pubkey}
    >
      {!profile?.picture && initial}
    </div>
  );
}
