import { useState } from "react";
import { useEntropyStore } from "../stores/entropy-store";
import { useNostrProfile } from "../hooks/useNostrProfile";
import { useQuotaManager } from "../hooks/useQuotaManager";
import { useToast } from "../components/ui/Toast";
import { EditProfileModal } from "../components/profile/EditProfileModal";
import { AvatarBadge } from "../components/profile/ProfileHeader";
import { Save, Trash2, Shield, Activity, HardDrive, UserCircle2, Pencil } from "lucide-react";

export default function SettingsPage() {
  const { pubkey, relayUrls, initRelays } = useEntropyStore();
  const { profile } = useNostrProfile(pubkey);
  const { usedBytes, quotaBytes, usagePercent, setQuota, evictLRU } = useQuotaManager();
  const { success, error } = useToast();
  const [showEditProfile, setShowEditProfile] = useState(false);
  
  const [relaysText, setRelaysText] = useState(relayUrls.join("\n"));
  const [quotaGB, setQuotaGB] = useState(quotaBytes / (1024 * 1024 * 1024));

  const handleSaveRelays = async () => {
    try {
      const urls = relaysText.split("\n").map(r => r.trim()).filter(r => r.length > 0);
      await initRelays(urls);
      success("Relays updated", "Successfully connected to new relays.");
    } catch (err) {
      error("Failed to update relays", err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveQuota = () => {
    try {
      setQuota(quotaGB * 1024 * 1024 * 1024);
      success("Storage quota updated", `New limit is ${quotaGB} GB.`);
    } catch (err) {
      error("Failed to update quota", err instanceof Error ? err.message : String(err));
    }
  };

  const handleClearCache = async () => {
    try {
      const freed = await evictLRU();
      const freedMB = (freed / (1024 * 1024)).toFixed(2);
      success("Cache cleared", `Freed ${freedMB} MB of local storage.`);
    } catch (err) {
      error("Failed to clear cache", err instanceof Error ? err.message : String(err));
    }
  };

  const formatGB = (bytes: number) => (bytes / (1024 * 1024 * 1024)).toFixed(2);

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto w-full pb-10">
      <div className="flex flex-col gap-2 mb-2">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted">Manage your Entropy node configuration.</p>
      </div>

      {/* Profile Section */}
      {pubkey && (
        <section className="panel flex flex-col gap-4">
          <div className="flex items-center gap-3 border-b border-border pb-3">
            <UserCircle2 className="text-primary" />
            <h2 className="text-xl font-bold">Profile</h2>
          </div>

          <div className="flex items-center gap-4">
            <AvatarBadge profile={profile} pubkey={pubkey} size="md" />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="font-semibold truncate">
                {profile?.displayName || profile?.name || "Anonymous Node"}
              </span>
              {profile?.nip05 ? (
                <span className="text-sm text-accent flex items-center gap-1">
                  {profile.nip05}
                  <span className="text-green-400 text-[10px]" title="Verified NIP-05">✓</span>
                </span>
              ) : (
                <span className="text-sm text-muted font-mono">{pubkey.slice(0, 16)}…</span>
              )}
              {profile?.about && (
                <p className="text-sm text-muted mt-1 truncate">{profile.about}</p>
              )}
            </div>
            <button
              onClick={() => setShowEditProfile(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-white/10 hover:bg-white/20 transition-colors shrink-0"
            >
              <Pencil size={14} />
              Edit Profile
            </button>
          </div>

          {showEditProfile && (
            <EditProfileModal
              profile={profile}
              pubkey={pubkey}
              onClose={() => setShowEditProfile(false)}
            />
          )}
        </section>
      )}

      {/* Identity Section */}
      <section className="panel flex flex-col gap-4">
        <div className="flex items-center gap-3 border-b border-border pb-3">
          <Shield className="text-primary" />
          <h2 className="text-xl font-bold">Identity & Extension</h2>
        </div>
        
        <div className="grid md:grid-cols-2 gap-6 pt-2">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-muted">Connected Pubkey</span>
            {pubkey ? (
              <code className="text-sm bg-white/5 p-2 rounded border border-white/10 break-all text-accent">
                {pubkey}
              </code>
            ) : (
              <span className="text-sm text-red-400">Not connected to Entropy extension</span>
            )}
          </div>
          
          <div className="flex flex-col gap-2 justify-center">
            <button className="bg-primary/10 text-primary hover:bg-primary/20 px-4 py-2 rounded-md font-medium transition-colors">
              {pubkey ? "Reconnect Extension" : "Connect Extension"}
            </button>
          </div>
        </div>
      </section>

      {/* Network / Relays Section */}
      <section className="panel flex flex-col gap-4">
        <div className="flex items-center gap-3 border-b border-border pb-3">
          <Activity className="text-primary" />
          <h2 className="text-xl font-bold">Network Relays</h2>
        </div>
        
        <p className="text-sm text-muted">
          These relays are used for discovering content, fetching profiles, and WebRTC signaling.
        </p>
        
        <textarea
          value={relaysText}
          onChange={(e) => setRelaysText(e.target.value)}
          className="bg-background/50 border border-border rounded-md px-4 py-3 text-white font-mono text-sm min-h-[120px] focus:outline-none focus:border-primary"
          placeholder="wss://relay.damus.io&#10;wss://nos.lol"
        />
        
        <div className="flex justify-end mt-2">
          <button 
            onClick={handleSaveRelays}
            className="flex items-center gap-2 bg-primary text-background hover:bg-accent px-5 py-2 rounded-md font-bold transition-colors"
          >
            <Save size={18} />
            Save Relays
          </button>
        </div>
      </section>

      {/* Storage & Quota Section */}
      <section className="panel flex flex-col gap-4">
        <div className="flex items-center gap-3 border-b border-border pb-3">
          <HardDrive className="text-primary" />
          <h2 className="text-xl font-bold">Storage & Quota</h2>
        </div>
        
        <div className="flex flex-col gap-6 pt-2">
          {/* Usage Bar */}
          <div className="flex flex-col gap-2 p-4 bg-background/50 rounded-xl border border-white/5">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted">Local Storage Usage</span>
              <span className="font-mono">
                <span className="text-white">{formatGB(usedBytes)} GB</span>
                <span className="text-muted"> / {formatGB(quotaBytes)} GB</span>
              </span>
            </div>
            
            <div className="h-3 w-full bg-white/5 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-500 ${
                  usagePercent > 90 ? 'bg-red-500' : 
                  usagePercent > 70 ? 'bg-yellow-500' : 'bg-primary'
                }`}
                style={{ width: `${Math.min(100, Math.max(0, usagePercent))}%` }}
              />
            </div>
            
            <div className="text-xs text-muted text-right">
              {usagePercent.toFixed(1)}% used
            </div>
          </div>
          
          <div className="grid md:grid-cols-2 gap-8 items-start">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Maximum Storage Quota (GB)</label>
                <div className="flex items-center gap-3">
                  <input 
                    type="range" 
                    min="1" 
                    max="50" 
                    step="0.5"
                    value={quotaGB}
                    onChange={(e) => setQuotaGB(parseFloat(e.target.value))}
                    className="flex-1 accent-primary"
                  />
                  <span className="font-mono text-primary w-12 text-right">{quotaGB}</span>
                </div>
              </div>
              <button 
                onClick={handleSaveQuota}
                className="self-start flex items-center gap-2 bg-white/10 text-white hover:bg-white/20 px-4 py-1.5 rounded-md font-medium transition-colors text-sm"
              >
                Apply Limit
              </button>
            </div>
            
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-red-400">Clear Space</span>
              <p className="text-xs text-muted mb-2">
                Free up space by evicting the oldest unpinned chunks that you aren't currently seeding.
              </p>
              <button 
                onClick={handleClearCache}
                className="self-start flex items-center gap-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 px-4 py-2 rounded-md font-medium transition-colors text-sm"
              >
                <Trash2 size={16} />
                Clear Unused Cache
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
