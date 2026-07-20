/**
 * MyAccountTab — avatar/PFP customisation, display name, identity key, account info.
 */
import { useEffect, useRef, useState } from "react";
import { Copy, Download, Edit2, Check, Loader2, Camera, X } from "lucide-react";
import { getProfile, updateProfile, exportIdentityKey, setSetting } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settingsStore";
import { useAuthStore } from "@/store/authStore";
import RoleTag from "@/components/RoleTag";
import { resizeImage, validateImageFile, IMAGE_ACCEPT } from "@/lib/imageUtils";

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/[0.05] last:border-0">
      <span className="text-xs text-white/40 w-32 shrink-0">{label}</span>
      <span className={`flex-1 text-sm text-white/80 truncate ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </span>
      <button onClick={copy} className="ml-2 text-white/20 hover:text-white/60 transition-colors shrink-0">
        {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

export default function MyAccountTab() {
  const { profile, setProfile, avatarDataUrl, setAvatarDataUrl } = useSettingsStore();
  const { systemRole } = useAuthStore();
  const effectiveRole = profile?.system_role ?? systemRole;
  const [loading, setLoading] = useState(!profile);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportedKey, setExportedKey] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profile) { setDisplayName(profile.username); return; }
    setLoading(true);
    getProfile()
      .then((p) => { setProfile(p); setDisplayName(p.username); })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!displayName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await updateProfile(displayName.trim());
      setEditing(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const key = await exportIdentityKey();
      setExportedKey(key);
    } catch (e) {
      setError(String(e));
    } finally {
      setExportLoading(false);
    }
  };

  const handleAvatarClick = () => {
    setAvatarError(null);
    fileInputRef.current?.click();
  };

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validateImageFile(file, 8);
    if (err) {
      setAvatarError(err);
      return;
    }
    setAvatarUploading(true);
    setAvatarError(null);
    try {
      const dataUrl = await resizeImage(file, 256);
      setAvatarDataUrl(dataUrl);
      await setSetting("avatar", dataUrl);
    } catch (e) {
      setAvatarError("Failed to process image.");
    } finally {
      setAvatarUploading(false);
      // Reset so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveAvatar = async () => {
    setAvatarDataUrl(null);
    await setSetting("avatar", "").catch(() => {});
  };

  if (loading) return (
    <div className="flex-1 flex items-center justify-center pt-12">
      <Loader2 className="animate-spin text-white/30" size={24} />
    </div>
  );

  const p = profile;
  const initials = (p?.username ?? "U").charAt(0).toUpperCase();

  return (
    <div className="space-y-6">
      {/* ── Avatar + Name ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-5 p-5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
        {/* Avatar */}
        <div className="relative shrink-0">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            className="hidden"
            onChange={handleAvatarFile}
          />

          {/* Avatar circle */}
          <div className="relative group w-20 h-20">
            {avatarDataUrl ? (
              <img
                src={avatarDataUrl}
                alt="Profile"
                className="w-20 h-20 rounded-full object-cover ring-2 ring-white/10"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-dl-accent/40 to-indigo-900/60 flex items-center justify-center text-3xl font-bold text-white uppercase shadow-lg shadow-dl-accent/10 select-none">
                {initials}
              </div>
            )}

            {/* Hover overlay */}
            <button
              onClick={handleAvatarClick}
              disabled={avatarUploading}
              className="absolute inset-0 rounded-full bg-black/55 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center gap-0.5 transition-opacity cursor-pointer"
              title="Change avatar"
            >
              {avatarUploading
                ? <Loader2 size={18} className="text-white animate-spin" />
                : <Camera size={18} className="text-white" />}
              <span className="text-[9px] text-white/80 font-medium tracking-wide">
                {avatarUploading ? "Saving…" : "Change"}
              </span>
            </button>
          </div>

          {/* Remove badge */}
          {avatarDataUrl && !avatarUploading && (
            <button
              onClick={handleRemoveAvatar}
              className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#0f1117] border border-white/10 flex items-center justify-center text-white/40 hover:text-red-400 hover:border-red-500/30 transition-colors"
              title="Remove avatar"
            >
              <X size={10} />
            </button>
          )}
        </div>

        {/* Name + email */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
                className="dl-input text-lg font-semibold py-1.5 px-3 w-52"
                autoFocus
              />
              <button onClick={handleSave} disabled={saving} className="dl-btn-primary text-sm px-3 py-1.5 flex items-center gap-1.5">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                Save
              </button>
              <button onClick={() => setEditing(false)} className="text-white/30 hover:text-white/60 transition-colors px-2">
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold text-white truncate">{p?.username}</h2>
              {effectiveRole && <RoleTag role={effectiveRole} className="mt-1" />}
              <button
                onClick={() => setEditing(true)}
                className="text-white/20 hover:text-white/60 transition-colors shrink-0"
                title="Edit display name"
              >
                <Edit2 size={14} />
              </button>
            </div>
          )}
          <p className="text-sm text-white/40 mt-0.5">
            {p?.email ? p.email.replace(/(.{2}).+(@.+)/, "$1…$2") : "—"}
          </p>
          {avatarError && (
            <p className="text-xs text-red-400 mt-1.5">{avatarError}</p>
          )}
          <p className="text-[11px] text-white/20 mt-2">
            Click your avatar to upload a custom profile picture (JPEG · PNG · WebP, max 8 MB)
          </p>
        </div>
      </div>

      {/* ── Account Information ───────────────────────────────────────── */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-white/30 pt-4 pb-2">Account Information</h3>
        {p && (
          <>
            <InfoRow label="User ID" value={p.user_id} mono />
            <InfoRow label="Username" value={p.username} />
            <InfoRow label="Key Version" value="v1" />
            <InfoRow label="Fingerprint" value={p.fingerprint} mono />
            <InfoRow label="Member since" value={new Date(p.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} />
          </>
        )}
      </div>

      {/* ── Actions ───────────────────────────────────────────────────── */}
      <div className="flex gap-3">
        <button
          onClick={handleExport}
          disabled={exportLoading}
          className="dl-btn-ghost flex items-center gap-2 text-sm px-4 py-2"
        >
          {exportLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Export Public Key
        </button>
      </div>

      {exportedKey && (
        <div className="rounded-xl bg-white/[0.03] border border-dl-accent/20 p-4">
          <p className="text-[10px] text-white/40 mb-2 font-semibold uppercase tracking-wider">Public Identity Key (Base64)</p>
          <code className="text-xs font-mono text-green-400 break-all leading-relaxed select-all">
            {exportedKey}
          </code>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
