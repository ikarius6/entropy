import { useState, useEffect } from "react";
import { X, Save, User } from "lucide-react";
import { useEntropyStore } from "../../stores/entropy-store";
import type { NostrProfile } from "../../types/nostr";

interface EditProfileModalProps {
  profile: NostrProfile | null;
  pubkey: string;
  onClose: () => void;
}

export function EditProfileModal({ profile, pubkey, onClose }: EditProfileModalProps) {
  const { relayPool, setProfile: setStoreProfile } = useEntropyStore();

  const [name, setName] = useState(profile?.name ?? "");
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [about, setAbout] = useState(profile?.about ?? "");
  const [picture, setPicture] = useState(profile?.picture ?? "");
  const [banner, setBanner] = useState(profile?.banner ?? "");
  const [nip05, setNip05] = useState(profile?.nip05 ?? "");
  const [lud16, setLud16] = useState(profile?.lud16 ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Sync if profile prop changes
  useEffect(() => {
    if (profile) {
      setName(profile.name ?? "");
      setDisplayName(profile.displayName ?? "");
      setAbout(profile.about ?? "");
      setPicture(profile.picture ?? "");
      setBanner(profile.banner ?? "");
      setNip05(profile.nip05 ?? "");
      setLud16(profile.lud16 ?? "");
    }
  }, [profile]);

  const handleSave = async () => {
    if (!relayPool) {
      setError("Not connected to any relays. Please add relays in Settings.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const content: Record<string, string> = {};
      if (name)        content.name         = name;
      if (displayName) content.display_name = displayName;
      if (about)       content.about        = about;
      if (picture)     content.picture      = picture;
      if (banner)      content.banner       = banner;
      if (nip05)       content.nip05        = nip05;
      if (lud16)       content.lud16        = lud16;

      // Build an unsigned kind:0 event, then sign via NIP-07 (window.nostr)
      const unsignedEvent = {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [] as string[][],
        content: JSON.stringify(content),
        pubkey,
      };

      // Use NIP-07 extension signing if available
      const win = window as Window & { nostr?: { signEvent: (e: unknown) => Promise<unknown> } };
      if (!win.nostr?.signEvent) {
        throw new Error("Your Nostr extension doesn't expose window.nostr.signEvent (NIP-07). Profile publishing is not available.");
      }

      const signed = await win.nostr.signEvent(unsignedEvent) as {
        id: string; sig: string; pubkey: string; kind: number;
        created_at: number; tags: string[][]; content: string;
      };

      // Publish to all relays
      relayPool.publish(signed);

      // Optimistically update the store
      const updated: NostrProfile = {
        pubkey,
        name: content.name,
        displayName: content.display_name,
        about: content.about,
        picture: content.picture,
        banner: content.banner,
        nip05: content.nip05,
        lud16: content.lud16,
      };
      setStoreProfile(updated);

      setSaved(true);
      setTimeout(onClose, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish profile.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverted/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-panel border border-border rounded-2xl w-full max-w-lg shadow-2xl flex flex-col gap-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <User size={18} className="text-primary" />
            <h2 className="font-bold text-lg">Edit Profile</h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-main transition-colors p-1 rounded-lg hover:bg-surface/5"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col gap-4 overflow-y-auto max-h-[70vh]">
          {/* Avatar preview */}
          {picture && (
            <div className="flex justify-center mb-2">
              <img
                src={picture}
                alt="avatar preview"
                className="w-20 h-20 rounded-full object-cover border-2 border-primary/50 shadow-lg"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          )}

          <Field label="Display Name" placeholder="Your display name" value={displayName} onChange={setDisplayName} />
          <Field label="Username" placeholder="username (no @)" value={name} onChange={setName} />
          <Field label="Bio" placeholder="A short bio…" value={about} onChange={setAbout} multiline />
          <Field label="Avatar URL" placeholder="https://…/avatar.png" value={picture} onChange={setPicture} />
          <Field label="Banner URL" placeholder="https://…/banner.png" value={banner} onChange={setBanner} />
          <Field label="NIP-05 Alias" placeholder="you@yourdomain.com" value={nip05} onChange={setNip05} hint="Must be configured on your domain's .well-known/nostr.json" />
          <Field label="Lightning Address (lud16)" placeholder="you@walletprovider.com" value={lud16} onChange={setLud16} />

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-muted hover:text-main hover:bg-surface/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || saved}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold bg-primary text-background hover:bg-accent transition-colors disabled:opacity-60"
          >
            {saved ? (
              <span>✓ Saved!</span>
            ) : isSaving ? (
              <>
                <div className="w-4 h-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save size={16} />
                Save Profile
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── inline Field component ───────────────────────────────────────────────────

interface FieldProps {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  hint?: string;
}

function Field({ label, placeholder, value, onChange, multiline, hint }: FieldProps) {
  const base =
    "w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-sm text-main placeholder:text-muted/60 focus:outline-none focus:border-primary transition-colors";

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted uppercase tracking-wide">{label}</label>
      {multiline ? (
        <textarea
          className={`${base} min-h-[80px] resize-none`}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type="text"
          className={base}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint && <p className="text-xs text-muted/60">{hint}</p>}
    </div>
  );
}
