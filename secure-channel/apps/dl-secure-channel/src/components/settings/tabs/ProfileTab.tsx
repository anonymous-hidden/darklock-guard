/**
 * ProfileTab — Discord-style profile customization with live preview card.
 * PFP, banner, display name, bio, pronouns, custom status, accent color.
 * All settings are persisted via setSetting().
 */
import { useEffect, useRef, useState } from "react";
import {
  Camera, ImagePlus, X, Check, Edit2, Loader2, Trash2,
  Smile, Link as LinkIcon, Type, RotateCcw,
} from "lucide-react";
import { getProfile, updateProfile, setSetting } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settingsStore";
import { useAuthStore } from "@/store/authStore";
import clsx from "clsx";
import RoleTag from "@/components/RoleTag";
import { resizeImage, validateImageFile, IMAGE_ACCEPT } from "@/lib/imageUtils";
import { useProfileStore } from "@/stores/profileStore";
import { getNameFontStyle } from "@/components/ProfileEditor";

const MAX_MB = 8;

const STATUS_OPTIONS = [
  { emoji: "🟢", label: "Online", value: "online" },
  { emoji: "🌙", label: "Idle", value: "idle" },
  { emoji: "⛔", label: "Do Not Disturb", value: "dnd" },
  { emoji: "⚫", label: "Invisible", value: "invisible" },
];

const PROFILE_COLORS = [
  "#6366f1", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b",
  "#ec4899", "#ef4444", "#3b82f6", "#14b8a6", "#f97316",
];

const BANNER_COLORS = [
  { value: '',        label: 'None (auto)' },
  { value: '#1e1b4b', label: 'Indigo Night' },
  { value: '#0c1a2e', label: 'Deep Ocean' },
  { value: '#1a0a0a', label: 'Ember Dark' },
  { value: '#0a1a0a', label: 'Forest Dark' },
  { value: '#1a0a1a', label: 'Plum' },
  { value: '#0f172a', label: 'Navy' },
  { value: '#18181b', label: 'Zinc' },
  { value: '#0a0a0a', label: 'Void' },
  { value: '#7c3aed', label: 'Violet' },
  { value: '#0891b2', label: 'Cyan' },
  { value: '#059669', label: 'Emerald' },
  { value: '#dc2626', label: 'Red' },
  { value: '#d97706', label: 'Amber' },
  { value: '#db2777', label: 'Pink' },
];

const BANNER_GRADIENTS = [
  { value: 'linear-gradient(135deg,#0f0c29,#302b63,#24243e)', label: 'Nebula' },
  { value: 'linear-gradient(135deg,#0a2e1a,#0f4c2a)',         label: 'Jungle' },
  { value: 'linear-gradient(135deg,#2e0a0a,#4c1515)',         label: 'Crimson' },
  { value: 'linear-gradient(135deg,#1a0533,#3d0a47)',         label: 'Galaxy' },
  { value: 'linear-gradient(135deg,#080a2e,#0e1560)',         label: 'Deep Sea' },
  { value: 'linear-gradient(135deg,#1a120a,#2e1e0a)',         label: 'Amber' },
  { value: 'linear-gradient(135deg,#7c3aed,#3b82f6)',         label: 'Aurora' },
  { value: 'linear-gradient(135deg,#db2777,#7c3aed)',         label: 'Dusk' },
];

export default function ProfileTab() {
  const {
    profile, setProfile,
    avatarDataUrl, setAvatarDataUrl,
    bannerDataUrl, setBannerDataUrl,
    bannerColor, setBannerColor,
    bioText, setBioText,
    setOnlineStatus: storeSetOnlineStatus,
    setProfileColor: storeSetProfileColor,
  } = useSettingsStore();

  const { systemRole } = useAuthStore();
  const effectiveRole = profile?.system_role ?? systemRole;
  const liveProfile = useProfileStore(s => s.profile);

  const [loading, setLoading] = useState(!profile);
  const [editingName, setEditingName] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [editingBio, setEditingBio] = useState(false);
  const [bioInput, setBioInput] = useState("");
  const [savingBio, setSavingBio] = useState(false);
  const [pfpUploading, setPfpUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extended profile fields
  const [pronouns, setPronouns] = useState("");
  const [customStatus, setCustomStatus] = useState("");
  const [statusEmoji, setStatusEmoji] = useState("");
  // Read initial values from store (so they're in sync after loadSettings)
  const storeOnlineStatus = useSettingsStore((s) => s.onlineStatus);
  const storeProfileColor = useSettingsStore((s) => s.profileColor);
  const [onlineStatus, setOnlineStatusLocal] = useState(storeOnlineStatus);
  const [profileColor, setProfileColorLocal] = useState(storeProfileColor);

  // Keep local state in sync when store changes (e.g. after loadSettings)
  useEffect(() => { setOnlineStatusLocal(storeOnlineStatus); }, [storeOnlineStatus]);
  useEffect(() => { setProfileColorLocal(storeProfileColor); }, [storeProfileColor]);

  /** Change online status — updates both local state and store (sidebar reacts). */
  const changeOnlineStatus = (val: string) => {
    setOnlineStatusLocal(val);
    storeSetOnlineStatus(val);
    saveField("online_status", val);
  };

  /** Change profile color — updates both local state and store (sidebar/preview reacts). */
  const changeProfileColor = (val: string) => {
    setProfileColorLocal(val);
    storeSetProfileColor(val);
    saveField("profile_color", val);
    syncToIDS({ color: val });
  };
  const [savingField, setSavingField] = useState<string | null>(null);

  const pfpRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profile) { setDisplayName(profile.username); setBioInput(bioText ?? ""); return; }
    setLoading(true);
    getProfile()
      .then((p) => { setProfile(p); setDisplayName(p.username); })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { setBioInput(bioText ?? ""); }, [bioText]);

  // Load extended profile fields from settings store
  useEffect(() => {
    const load = async () => {
      try {
        const { getSettings } = await import("@/lib/tauri");
        const db = await getSettings();
        if (db.pronouns) setPronouns(db.pronouns);
        if (db.custom_status) setCustomStatus(db.custom_status);
        if (db.status_emoji) setStatusEmoji(db.status_emoji);
        // online_status and profile_color are loaded into the store by loadSettings;
        // the useEffect hooks above will sync the local state from the store.
      } catch {}
    };
    load();
  }, []);

  const saveField = async (key: string, value: string) => {
    setSavingField(key);
    try { await setSetting(key, value); } catch {}
    finally { setSavingField(null); }
  };

  /** Push public profile fields to IDS so contacts can see them. */
  const syncToIDS = async (patch: {
    bio?: string; color?: string; pronouns?: string; customStatus?: string;
    avatar?: string | null; banner?: string | null;
  } = {}) => {
    try {
      const { updatePublicProfile } = await import("@/lib/tauri");
      const cs = patch.customStatus !== undefined ? patch.customStatus
        : (statusEmoji ? `${statusEmoji} ${customStatus}`.trim() : customStatus);
      await updatePublicProfile({
        profileBio: patch.bio !== undefined ? patch.bio : (bioText ?? ""),
        profileColor: patch.color !== undefined ? patch.color : profileColor,
        pronouns: patch.pronouns !== undefined ? patch.pronouns : pronouns,
        customStatus: cs || null,
        avatar: patch.avatar !== undefined ? patch.avatar : (avatarDataUrl ?? null),
        banner: patch.banner !== undefined ? patch.banner : (bannerDataUrl ?? null),
      });
    } catch {}
  };

  const handlePfpFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validateImageFile(file, MAX_MB);
    if (err) { setError(err); return; }
    setPfpUploading(true); setError(null);
    try {
      const dataUrl = await resizeImage(file, 256, 256);
      setAvatarDataUrl(dataUrl);
      await setSetting("avatar", dataUrl);
      syncToIDS({ avatar: dataUrl });
    } catch { setError("Failed to process image."); }
    finally { setPfpUploading(false); if (pfpRef.current) pfpRef.current.value = ""; }
  };

  const handleBannerFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validateImageFile(file, MAX_MB);
    if (err) { setError(err); return; }
    setBannerUploading(true); setError(null);
    try {
      const dataUrl = await resizeImage(file, 720, 192, 0.72);
      setBannerDataUrl(dataUrl);
      await setSetting("banner", dataUrl);
      await syncToIDS({ banner: dataUrl });
    } catch { setError("Failed to save banner. Try a smaller image."); }
    finally { setBannerUploading(false); if (bannerRef.current) bannerRef.current.value = ""; }
  };

  const handleSaveName = async () => {
    if (!displayName.trim()) return;
    setSavingName(true); setError(null);
    try {
      await updateProfile(displayName.trim());
      // Update store so preview card and sidebar reflect new name immediately
      if (profile) setProfile({ ...profile, username: displayName.trim() });
      setEditingName(false);
    }
    catch (e) { setError(String(e)); }
    finally { setSavingName(false); }
  };

  const handleResetCustomization = async () => {
    setPronouns(""); setCustomStatus(""); setStatusEmoji("");
    changeOnlineStatus("online"); changeProfileColor("#6366f1");
    await Promise.allSettled([
      setSetting("pronouns", ""),
      setSetting("custom_status", ""),
      setSetting("status_emoji", ""),
    ]);
  };

  const handleSaveBio = async () => {
    const trimmed = bioInput.slice(0, 200);
    setSavingBio(true); setError(null);
    try { setBioText(trimmed); await setSetting("bio", trimmed); setEditingBio(false); syncToIDS({ bio: trimmed }); }
    catch (e) { setError(String(e)); }
    finally { setSavingBio(false); }
  };

  const handleRemovePfp = async () => { setAvatarDataUrl(null); await setSetting("avatar", "").catch(() => {}); syncToIDS({ avatar: null }); };
  const handleRemoveBanner = async () => { setBannerDataUrl(null); await setSetting("banner", "").catch(() => {}); syncToIDS({ banner: null }); };

  const initials = (profile?.username ?? "U").charAt(0).toUpperCase();

  if (loading) return (
    <div className="flex items-center justify-center pt-12">
      <Loader2 className="animate-spin text-white/30" size={24} />
    </div>
  );

  return (
    <div className="flex gap-6">
      {/* ── Left: Edit Fields ──────────────────────────────────────── */}
      <div className="flex-1 space-y-5 min-w-0">

        {/* Banner + PFP Card */}
        <div className="rounded-xl overflow-hidden border border-white/[0.06] bg-white/[0.02]">
          {/* Banner */}
          <div className="relative group h-32">
            {bannerDataUrl ? (
              <img src={bannerDataUrl} alt="Profile banner" className="w-full h-full object-cover" />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center"
                style={{ background: bannerColor || `linear-gradient(135deg, ${profileColor}33 0%, ${profileColor}11 50%, transparent 100%)` }}
              >
                {!bannerColor && <span className="text-xs text-white/20">Click to add banner</span>}
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <input ref={bannerRef} type="file" accept={IMAGE_ACCEPT} className="hidden" onChange={handleBannerFile} />
              <button
                onClick={() => bannerRef.current?.click()}
                disabled={bannerUploading}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-black/50 text-white/80 hover:bg-black/70 border border-white/10 transition-all"
              >
                {bannerUploading ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
                {bannerUploading ? "Uploading…" : "Upload Banner"}
              </button>
              {bannerDataUrl && !bannerUploading && (
                <button
                  onClick={handleRemoveBanner}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/30 text-red-300 hover:bg-red-500/50 border border-red-500/20 transition-all"
                >
                  <Trash2 size={12} /> Remove
                </button>
              )}
            </div>
          </div>

          {/* PFP + Name */}
          <div className="relative px-5 pb-5 pt-0">
            <div className="relative -mt-10 mb-3 inline-block">
              <input ref={pfpRef} type="file" accept={IMAGE_ACCEPT} className="hidden" onChange={handlePfpFile} />
              <div className="relative group w-20 h-20">
                {avatarDataUrl ? (
                  <img src={avatarDataUrl} alt="Profile" className="w-20 h-20 rounded-full object-cover ring-4 ring-[#0f1117] shadow-xl" />
                ) : (
                  <div
                    className="w-20 h-20 rounded-full ring-4 ring-[#0f1117] flex items-center justify-center text-3xl font-bold text-white shadow-xl select-none"
                    style={{ background: `linear-gradient(135deg, ${profileColor}66, ${profileColor}33)` }}
                  >
                    {initials}
                  </div>
                )}
                <button
                  onClick={() => pfpRef.current?.click()}
                  disabled={pfpUploading}
                  className="absolute inset-0 rounded-full bg-black/55 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-opacity cursor-pointer"
                >
                  {pfpUploading ? <Loader2 size={18} className="text-white animate-spin" /> : <Camera size={18} className="text-white" />}
                  <span className="text-[9px] text-white/80 font-medium mt-0.5">{pfpUploading ? "Saving…" : "Change"}</span>
                </button>
              </div>
              {avatarDataUrl && !pfpUploading && (
                <button onClick={handleRemovePfp} className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#0f1117] border border-white/10 flex items-center justify-center text-white/40 hover:text-red-400 hover:border-red-500/30 transition-colors" title="Remove avatar">
                  <X size={10} />
                </button>
              )}
            </div>

            {editingName ? (
              <div className="flex items-center gap-2 mb-1">
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleSaveName(); if (e.key === "Escape") setEditingName(false); }} className="dl-input text-base font-semibold py-1.5 px-3 w-48" autoFocus />
                <button onClick={handleSaveName} disabled={savingName} className="dl-btn-primary text-xs px-3 py-1.5 flex items-center gap-1">
                  {savingName ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
                </button>
                <button onClick={() => setEditingName(false)} className="text-white/30 hover:text-white/60 px-1"><X size={14} /></button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-lg font-semibold text-white">{profile?.username}</span>
                <button onClick={() => setEditingName(true)} className="text-white/20 hover:text-white/60 transition-colors"><Edit2 size={13} /></button>
              </div>
            )}
            {effectiveRole && <RoleTag role={effectiveRole} className="mb-1" />}
            <p className="text-xs text-white/30">
              {profile?.email ? profile.email.replace(/(.{2}).+(@.+)/, "$1…$2") : "—"} · #{profile?.user_id.slice(-6)}
            </p>
          </div>
        </div>

        {/* Online Status */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30">Online Status</h3>
          <div className="grid grid-cols-2 gap-2">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s.value}
                onClick={() => { changeOnlineStatus(s.value); }}
                className={clsx(
                  "flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm transition-all",
                  onlineStatus === s.value
                    ? "border-dl-accent/30 bg-dl-accent/5 text-white"
                    : "border-white/[0.06] bg-white/[0.02] text-white/50 hover:border-white/20 hover:text-white/70"
                )}
              >
                <span className="text-base">{s.emoji}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Custom Status */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30">Custom Status</h3>
            {customStatus && (
              <button
                onClick={() => { setCustomStatus(""); setStatusEmoji(""); saveField("custom_status", ""); saveField("status_emoji", ""); syncToIDS({ customStatus: "" }); }}
                className="text-[10px] text-white/30 hover:text-white/60"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const emojis = ["😀","😎","🚀","💻","🎮","🎵","📚","☕","🔥","💤","🏖️","🎯"];
                const next = emojis[(emojis.indexOf(statusEmoji) + 1) % emojis.length];
                setStatusEmoji(next);
                saveField("status_emoji", next);
                syncToIDS({ customStatus: next ? `${next} ${customStatus}`.trim() : customStatus });
              }}
              className="w-10 h-10 rounded-lg bg-dl-elevated border border-white/[0.06] flex items-center justify-center text-lg hover:bg-white/[0.08] transition-colors shrink-0"
              title="Pick emoji"
            >
              {statusEmoji || <Smile size={16} className="text-white/30" />}
            </button>
            <input
              value={customStatus}
              onChange={(e) => setCustomStatus(e.target.value.slice(0, 128))}
              onBlur={() => { saveField("custom_status", customStatus); syncToIDS({ customStatus: statusEmoji ? `${statusEmoji} ${customStatus}`.trim() : customStatus }); }}
              placeholder="Set a custom status…"
              className="dl-input text-sm flex-1"
              maxLength={128}
            />
          </div>
          <p className="text-[11px] text-white/20">{customStatus.length}/128</p>
        </div>

        {/* Bio */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30">About Me</h3>
            {!editingBio && (
              <button onClick={() => { setBioInput(bioText ?? ""); setEditingBio(true); }} className="text-white/25 hover:text-white/60 transition-colors">
                <Edit2 size={13} />
              </button>
            )}
          </div>
          {editingBio ? (
            <div className="space-y-2">
              <textarea value={bioInput} onChange={(e) => setBioInput(e.target.value.slice(0, 200))} placeholder="Write something about yourself…" rows={4} className="dl-input text-sm resize-none" autoFocus />
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/20">{bioInput.length}/200</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setEditingBio(false)} className="text-white/30 hover:text-white/60 text-xs px-3 py-1.5 rounded-lg hover:bg-white/[0.05]">Cancel</button>
                  <button onClick={handleSaveBio} disabled={savingBio} className="dl-btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5">
                    {savingBio ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div onClick={() => { setBioInput(bioText ?? ""); setEditingBio(true); }} className="min-h-[64px] text-sm text-white/60 leading-relaxed cursor-text rounded-lg p-3 hover:bg-white/[0.03] transition-colors border border-transparent hover:border-white/[0.06]">
              {bioText ? <span>{bioText}</span> : <span className="text-white/20 italic">Click to add a bio…</span>}
            </div>
          )}
        </div>

        {/* ── Banner Color & Gradient Picker ─────── */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30 flex items-center gap-2">
            <ImagePlus size={12} /> Banner Color
          </h3>
          <p className="text-[11px] text-white/20">Sets the banner background color. Uploading an image overrides this.</p>

          {/* Solid colors */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/20 mb-2">Solid</p>
            <div className="flex flex-wrap gap-2">
              {BANNER_COLORS.map(bc => (
                <button
                  key={bc.value}
                  onClick={() => { setBannerColor(bc.value); saveField('banner_color', bc.value); }}
                  title={bc.label}
                  className="relative w-7 h-7 rounded-md border-2 transition-all"
                  style={{
                    background: bc.value || 'transparent',
                    borderColor: bannerColor === bc.value ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.12)',
                  }}
                >
                  {!bc.value && <span className="text-[8px] text-white/30 leading-none">auto</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Gradient presets */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/20 mb-2">Gradient</p>
            <div className="flex flex-wrap gap-2">
              {BANNER_GRADIENTS.map(bg => (
                <button
                  key={bg.value}
                  onClick={() => { setBannerColor(bg.value); saveField('banner_color', bg.value); }}
                  title={bg.label}
                  className="w-12 h-7 rounded-md border-2 transition-all"
                  style={{
                    background: bg.value,
                    borderColor: bannerColor === bg.value ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.12)',
                  }}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30 flex items-center gap-2">
            <Type size={12} /> Pronouns
          </h3>
          <input
            value={pronouns}
            onChange={(e) => setPronouns(e.target.value.slice(0, 40))}
            onBlur={() => { saveField("pronouns", pronouns); syncToIDS({ pronouns }); }}
            placeholder="e.g. they/them, she/her, he/him"
            className="dl-input text-sm"
            maxLength={40}
          />
          <p className="text-[11px] text-white/20">Shown on your profile card</p>
        </div>

        {/* Profile Color */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-white/30 flex items-center gap-2">
            <LinkIcon size={12} /> Profile Color
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            {PROFILE_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => { changeProfileColor(c); }}
                className={clsx(
                  "w-7 h-7 rounded-full transition-all",
                  profileColor === c ? "ring-2 ring-white/50 ring-offset-2 ring-offset-[#0f1117] scale-110" : "hover:scale-110"
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <p className="text-[11px] text-white/20">Used as your default avatar background and profile accent</p>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {savingField && <p className="text-[11px] text-white/20 animate-pulse">Saving…</p>}

        {/* Reset customization */}
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-white/50">Reset profile customization</p>
            <p className="text-xs text-white/25 mt-0.5">Clears pronouns, status, profile color — keeps name and avatar</p>
          </div>
          <button
            onClick={handleResetCustomization}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 hover:bg-white/[0.04] transition-all shrink-0 ml-4"
          >
            <RotateCcw size={12} /> Reset
          </button>
        </div>
      </div>

      {/* ── Right: Live Preview Card ──────────────────────────────── */}
      <div className="w-[280px] shrink-0 sticky top-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 mb-3">Preview</p>
        <div className="rounded-xl overflow-hidden border border-white/[0.06] bg-[#111218] shadow-xl">
          {/* Banner — clickable in preview to open picker */}
          <div
            className="h-[60px] relative group cursor-pointer"
            onClick={() => bannerRef.current?.click()}
            title="Click to change banner"
          >
            {bannerDataUrl ? (
              <img src={bannerDataUrl} className="w-full h-full object-cover" alt="" />
            ) : (
              <div className="w-full h-full" style={{ background: bannerColor || `linear-gradient(135deg, ${profileColor}44 0%, ${profileColor}11 100%)` }} />
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <ImagePlus size={14} className="text-white/70" />
            </div>
          </div>

          {/* Avatar — clickable in preview to open picker */}
          <div className="px-4 -mt-8 relative">
            <div className="relative inline-block">
              <div
                className="relative group cursor-pointer"
                onClick={() => pfpRef.current?.click()}
                title="Click to change avatar"
              >
                {avatarDataUrl ? (
                  <img src={avatarDataUrl} className="w-[64px] h-[64px] rounded-full object-cover ring-[5px] ring-[#111218]" alt="" />
                ) : (
                  <div
                    className="w-[64px] h-[64px] rounded-full ring-[5px] ring-[#111218] flex items-center justify-center text-2xl font-bold text-white"
                    style={{ background: `linear-gradient(135deg, ${profileColor}88, ${profileColor}44)` }}
                  >
                    {initials}
                  </div>
                )}
                <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Camera size={14} className="text-white" />
                </div>
              </div>
              {/* Status dot */}
              <div className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-[#111218] flex items-center justify-center">
                <div className={clsx(
                  "w-3 h-3 rounded-full",
                  onlineStatus === "online" && "bg-green-500",
                  onlineStatus === "idle" && "bg-amber-500",
                  onlineStatus === "dnd" && "bg-red-500",
                  onlineStatus === "invisible" && "bg-gray-500",
                )} />
              </div>
            </div>
          </div>

          {/* Info */}
          <div className="px-4 pt-2 pb-4">
            <div className="bg-[#0b0c10] rounded-lg p-3 space-y-2.5">
              <div>
                <span
                  className="text-sm font-bold text-white"
                  style={getNameFontStyle(liveProfile?.displayNameFont ?? 'default')}
                >{profile?.username ?? "User"}</span>
                {pronouns && <span className="text-[11px] text-white/30 ml-1.5">{pronouns}</span>}
              </div>
              {effectiveRole && <RoleTag role={effectiveRole} />}

              {/* Custom status */}
              {(customStatus || statusEmoji) && (
                <div className="flex items-center gap-1.5 text-xs text-white/50">
                  {statusEmoji && <span>{statusEmoji}</span>}
                  {customStatus && <span>{customStatus}</span>}
                </div>
              )}

              {/* Separator */}
              <div className="h-px bg-white/[0.06]" />

              {/* About Me */}
              {bioText ? (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-1">About Me</p>
                  <p className="text-xs text-white/60 leading-relaxed whitespace-pre-wrap">{bioText}</p>
                </div>
              ) : (
                <p className="text-[10px] text-white/20 italic">No bio set</p>
              )}

              {/* Member Since */}
              {profile?.created_at && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-1">Member Since</p>
                  <p className="text-xs text-white/50">{new Date(profile.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                </div>
              )}
            </div>
          </div>
        </div>
        <p className="text-[10px] text-white/15 mt-2 text-center">This is how others see your profile</p>
      </div>
    </div>
  );
}
