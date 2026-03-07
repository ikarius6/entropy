import { useState, useEffect, useRef, useMemo } from "react";
import { useEntropyStore } from "../stores/entropy-store";
import { useNostrProfile } from "../hooks/useNostrProfile";
import { useQuotaManager } from "../hooks/useQuotaManager";
import { useTagPreferences } from "../hooks/useTagPreferences";
import { useToast } from "../components/ui/Toast";
import { EditProfileModal } from "../components/profile/EditProfileModal";
import { AvatarBadge } from "../components/profile/ProfileHeader";
import { exportIdentity, importKeypair } from "../lib/extension-bridge";
import { sortPreferencesByRelevance } from "@entropy/core";
import { Save, Trash2, Shield, Activity, HardDrive, UserCircle2, Pencil, Download, Upload, Sparkles, RotateCcw, ThumbsUp, ThumbsDown, Globe, Plus, X } from "lucide-react";
import { getSignAllowlist, addSignOrigin, removeSignOrigin } from "../lib/extension-bridge";

export default function SettingsPage() {
  const { pubkey, relayUrls, initRelays } = useEntropyStore();
  const { profile } = useNostrProfile(pubkey);
  const { usedBytes, quotaBytes, usagePercent, setQuota, evictLRU } = useQuotaManager();
  const { success, error } = useToast();
  const [showEditProfile, setShowEditProfile] = useState(false);
  
  const [relaysText, setRelaysText] = useState(relayUrls.join("\n"));
  const [quotaGB, setQuotaGB] = useState(quotaBytes / (1024 * 1024 * 1024));
  const [identityBusy, setIdentityBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // NIP-07 allowlist state
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [allowlistLoaded, setAllowlistLoaded] = useState(false);
  const [newOrigin, setNewOrigin] = useState("");
  const [allowlistBusy, setAllowlistBusy] = useState(false);

  // Load allowlist once on mount
  useEffect(() => {
    getSignAllowlist()
      .then((payload) => {
        setAllowlist(payload.origins);
        setAllowlistLoaded(true);
      })
      .catch(() => setAllowlistLoaded(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveRelays = async () => {
    try {
      const urls = relaysText.split("\n").map(r => r.trim()).filter(r => r.length > 0);

      const invalid = urls.filter(u => !/^wss?:\/\//i.test(u));
      if (invalid.length > 0) {
        error("Invalid relay URL", `These URLs must start with wss:// or ws://:\n${invalid.join("\n")}`);
        return;
      }

      if (urls.length > 10) {
        error("Too many relays", "A maximum of 10 relays is allowed.");
        return;
      }

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

  const handleExportIdentity = async () => {
    setIdentityBusy(true);
    try {
      const identity = await exportIdentity();
      const json = JSON.stringify({
        pubkey: identity.pubkey,
        privkey: identity.privkey,
        exportedAt: new Date().toISOString()
      }, null, 2);

      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `entropy-identity-${identity.pubkey.slice(0, 8)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      success("Identity exported", "Your identity file has been downloaded. Keep it safe!");
    } catch (err) {
      error("Export failed", err instanceof Error ? err.message : String(err));
    } finally {
      setIdentityBusy(false);
    }
  };

  const handleImportIdentity = async (file: File) => {
    setIdentityBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { privkey?: string };

      if (typeof parsed.privkey !== "string" || parsed.privkey.length === 0) {
        error("Invalid file", "The selected file does not contain a valid Entropy identity.");
        return;
      }

      const result = await importKeypair({ privkey: parsed.privkey });
      success("Identity imported", `Switched to pubkey ${result.pubkey.slice(0, 16)}…`);
    } catch (err) {
      error("Import failed", err instanceof Error ? err.message : String(err));
    } finally {
      setIdentityBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const { preferences, recordSignal } = useTagPreferences();
  const sortedPrefs = useMemo(() => sortPreferencesByRelevance(preferences), [preferences]);
  const maxAbsScore = useMemo(
    () => sortedPrefs.reduce((m, p) => Math.max(m, Math.abs(p.score)), 1),
    [sortedPrefs]
  );

  const handleResetPreferences = () => {
    localStorage.removeItem("entropy-tag-preferences");
    window.location.reload();
  };

  const handleAddOrigin = async () => {
    const trimmed = newOrigin.trim();
    if (!trimmed) return;
    try {
      new URL(trimmed); // validates it is a real URL origin
    } catch {
      error("Invalid origin", "Enter a valid URL origin, e.g. https://myapp.com");
      return;
    }
    setAllowlistBusy(true);
    try {
      const result = await addSignOrigin(trimmed);
      setAllowlist(result.origins);
      setNewOrigin("");
      success("Origin added", `${trimmed} can now sign Nostr events.`);
    } catch (err) {
      error("Failed to add origin", err instanceof Error ? err.message : String(err));
    } finally {
      setAllowlistBusy(false);
    }
  };

  const handleRemoveOrigin = async (origin: string) => {
    setAllowlistBusy(true);
    try {
      const result = await removeSignOrigin(origin);
      setAllowlist(result.origins);
      success("Origin removed", `${origin} can no longer sign events.`);
    } catch (err) {
      error("Failed to remove origin", err instanceof Error ? err.message : String(err));
    } finally {
      setAllowlistBusy(false);
    }
  };

  const formatGB = (bytes: number) => (bytes / (1024 * 1024 * 1024)).toFixed(2);

  const formatAge = (updatedAt: number) => {
    const seconds = Math.floor(Date.now() / 1000) - updatedAt;
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

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

        {pubkey && (
          <div className="border-t border-border pt-4 mt-2">
            <h3 className="text-sm font-semibold text-muted mb-3">Migrate Identity</h3>
            <p className="text-xs text-muted mb-3">
              Export your identity to a JSON file to migrate it to another browser or computer.
              Keep the exported file safe — it contains your private key.
            </p>
            <div className="flex gap-3 flex-wrap">
              <button
                onClick={handleExportIdentity}
                disabled={identityBusy}
                className="flex items-center gap-2 bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 px-4 py-2 rounded-md font-medium transition-colors text-sm disabled:opacity-50"
              >
                <Download size={16} />
                Export Identity
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={identityBusy}
                className="flex items-center gap-2 bg-white/10 text-white hover:bg-white/20 border border-white/10 px-4 py-2 rounded-md font-medium transition-colors text-sm disabled:opacity-50"
              >
                <Upload size={16} />
                Import from File
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportIdentity(file);
                }}
              />
            </div>
          </div>
        )}
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

      {/* Your Algorithm Section */}
      <section className="panel flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-3">
            <Sparkles className="text-primary" />
            <h2 className="text-xl font-bold">Your Algorithm</h2>
          </div>
          {sortedPrefs.length > 0 && (
            <button
              onClick={handleResetPreferences}
              className="flex items-center gap-1.5 text-xs text-muted hover:text-red-400 transition-colors px-2 py-1 rounded-md hover:bg-red-400/10"
            >
              <RotateCcw size={12} />
              Reset
            </button>
          )}
        </div>

        <p className="text-sm text-muted">
          These are the hidden tags Entropy has learned from your activity. Positive scores boost content in your "For You" feed, negative scores suppress it.
        </p>

        {sortedPrefs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
            <Sparkles size={28} className="text-muted/40" />
            <p className="text-muted text-sm">No preferences yet.</p>
            <p className="text-muted/60 text-xs max-w-sm">
              Like, share, or mark content as "not interested" to start building your personal algorithm.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {sortedPrefs.map((pref) => {
              const isPositive = pref.score > 0;
              const isNegative = pref.score < 0;
              const barWidth = Math.min(100, (Math.abs(pref.score) / maxAbsScore) * 100);

              return (
                <div
                  key={pref.name}
                  className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-white/[0.03] transition-colors group"
                >
                  {/* Sentiment icon */}
                  <div className={`shrink-0 ${
                    isPositive ? "text-green-400" : isNegative ? "text-red-400" : "text-muted/40"
                  }`}>
                    {isPositive ? <ThumbsUp size={14} /> : isNegative ? <ThumbsDown size={14} /> : <span className="w-3.5 h-3.5 block rounded-full bg-current opacity-30" />}
                  </div>

                  {/* Tag name */}
                  <span className="text-sm font-medium text-white min-w-[100px] truncate">
                    {pref.name}
                  </span>

                  {/* Score bar */}
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          isPositive ? "bg-green-500/70" : isNegative ? "bg-red-500/70" : "bg-white/20"
                        }`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <span className={`text-xs font-mono w-8 text-right tabular-nums ${
                      isPositive ? "text-green-400" : isNegative ? "text-red-400" : "text-muted"
                    }`}>
                      {isPositive ? "+" : ""}{pref.score}
                    </span>
                  </div>

                  {/* Age */}
                  <span className="text-[10px] text-muted/50 w-14 text-right shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {formatAge(pref.updatedAt)}
                  </span>
                </div>
              );
            })}

            <div className="text-xs text-muted/40 text-right pt-2 pr-3">
              {sortedPrefs.length} tag{sortedPrefs.length !== 1 ? "s" : ""} learned
            </div>
          </div>
        )}
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
      {/* NIP-07 Trusted Origins */}
      <section className="panel flex flex-col gap-4">
        <div className="flex items-center gap-3 border-b border-border pb-3">
          <Globe className="text-primary" />
          <div>
            <h2 className="text-xl font-bold">Trusted Origins (NIP-07 Signing)</h2>
            <p className="text-xs text-muted mt-0.5">
              Only pages from these origins can call <code>window.nostr.signEvent()</code>.
            </p>
          </div>
        </div>

        {!allowlistLoaded ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {allowlist.length === 0 && (
                <li className="text-sm text-muted/60 italic">No origins authorized yet.</li>
              )}
              {allowlist.map((origin) => (
                <li
                  key={origin}
                  className="flex items-center justify-between gap-3 bg-white/5 border border-white/10 px-4 py-2.5 rounded-lg"
                >
                  <code className="text-sm text-accent break-all">{origin}</code>
                  <button
                    onClick={() => handleRemoveOrigin(origin)}
                    disabled={allowlistBusy}
                    className="shrink-0 p-1 rounded hover:bg-red-500/20 text-muted hover:text-red-400 transition-colors disabled:opacity-40"
                    title="Remove"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex gap-2 mt-1">
              <input
                type="url"
                placeholder="https://myapp.com"
                value={newOrigin}
                onChange={(e) => setNewOrigin(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddOrigin()}
                className="flex-1 bg-background/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
              />
              <button
                onClick={handleAddOrigin}
                disabled={allowlistBusy || !newOrigin.trim()}
                className="flex items-center gap-1.5 bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 px-4 py-2 rounded-md font-medium transition-colors text-sm disabled:opacity-50"
              >
                <Plus size={15} />
                Add
              </button>
            </div>
          </>
        )}
      </section>

    </div>
  );
}
