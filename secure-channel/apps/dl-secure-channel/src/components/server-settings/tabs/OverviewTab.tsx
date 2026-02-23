/**
 * OverviewTab — Server name, description, bio, accent color, vanity invite,
 * stats, and delete button. Tracks dirty state so Save only appears when
 * something changed.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Trash2, Check, RotateCcw, AlertTriangle,
  Palette, Link2, Users, Hash, Shield, BarChart3,
  Copy, ExternalLink, Globe,
} from "lucide-react";
import { useServerStore } from "@/store/serverStore";
import { useLayoutStore } from "@/store/layoutStore";

const NAME_MIN = 2;
const NAME_MAX = 100;
const BIO_MAX = 1000;

const ACCENT_PRESETS = [
  "#7c5cfc", "#5865F2", "#57F287", "#FEE75C",
  "#EB459E", "#ED4245", "#FF7A33", "#3BA0FF",
];

export default function OverviewTab({ serverId }: { serverId: string }) {
  const servers = useServerStore((s) => s.servers);
  const updateServer = useServerStore((s) => s.updateServer);
  const deleteServer = useServerStore((s) => s.deleteServer);
  const closeServerSettings = useLayoutStore((s) => s.closeServerSettings);
  const setActiveServer = useLayoutStore((s) => s.setActiveServer);

  const server = servers.find((s) => s.id === serverId);

  const [name, setName] = useState(server?.name ?? "");
  const [bio, setBio] = useState(server?.description ?? "");
  const [accentColor, setAccentColor] = useState("#7c5cfc");
  const [vanityUrl, setVanityUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);

  // Simulated server stats (will be wired to backend)
  const members = useServerStore((s) => s.members[serverId] ?? []);
  const channels = useServerStore((s) => s.channels[serverId] ?? []);
  const roles = useServerStore((s) => s.roles[serverId] ?? []);

  const stats = useMemo(() => ({
    totalMembers: members.length,
    onlineMembers: Math.floor(members.length * 0.6), // simulated
    totalChannels: channels.length,
    totalRoles: roles.length,
    createdAt: server?.created_at ?? new Date().toISOString(),
  }), [members.length, channels.length, roles.length, server?.created_at]);

  // Reset local state when server prop changes
  useEffect(() => {
    setName(server?.name ?? "");
    setBio(server?.description ?? "");
  }, [server?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(
    () => name !== (server?.name ?? "") || bio !== (server?.description ?? ""),
    [name, bio, server?.name, server?.description]
  );

  // Validation
  const nameError = useMemo(() => {
    const t = name.trim();
    if (t.length < NAME_MIN) return `Name must be at least ${NAME_MIN} characters`;
    if (t.length > NAME_MAX) return `Name must be at most ${NAME_MAX} characters`;
    return null;
  }, [name]);

  const bioError = useMemo(() => {
    if (bio.length > BIO_MAX) return `Bio must be at most ${BIO_MAX} characters`;
    return null;
  }, [bio]);

  const canSave = dirty && !nameError && !bioError;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateServer(
        serverId,
        name.trim(),
        bio.trim(),
      );
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [serverId, name, bio, updateServer, canSave]);

  const handleReset = useCallback(() => {
    setName(server?.name ?? "");
    setBio(server?.description ?? "");
  }, [server?.name, server?.description]);

  const handleDelete = async () => {
    try {
      await deleteServer(serverId);
      closeServerSettings();
      setActiveServer(null);
    } catch (e) {
      setSaveError(String(e));
    }
  };

  return (
    <div className="space-y-8 max-w-lg">
      {/* ── Server Stats ─────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { icon: Users, label: "Members", value: stats.totalMembers, sub: `${stats.onlineMembers} online` },
          { icon: Hash, label: "Channels", value: stats.totalChannels },
          { icon: Shield, label: "Roles", value: stats.totalRoles },
          { icon: BarChart3, label: "Created", value: new Date(stats.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" }) },
        ].map((s) => (
          <div key={s.label} className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-3 text-center">
            <s.icon size={14} className="mx-auto text-white/20 mb-1" />
            <div className="text-sm font-semibold text-white/80">{s.value}</div>
            <div className="text-[10px] text-white/25">{s.label}</div>
            {s.sub && <div className="text-[9px] text-green-400/50 mt-0.5">{s.sub}</div>}
          </div>
        ))}
      </div>

      {/* Server Name */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-semibold text-white/40 uppercase tracking-wider">
            Server Name
          </label>
          <span className={`text-[10px] tabular-nums ${name.trim().length < NAME_MIN ? 'text-red-400/60' : 'text-white/20'}`}>
            {name.trim().length}/{NAME_MAX}
          </span>
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`w-full bg-white/[0.04] border rounded-lg px-4 py-2.5 text-sm text-white/90 focus:outline-none focus:ring-1 transition-all ${
            nameError ? 'border-red-500/40 focus:ring-red-500/50' : 'border-white/[0.06] focus:ring-dl-accent/50'
          }`}
          maxLength={NAME_MAX}
        />
        {nameError && dirty && (
          <p className="flex items-center gap-1.5 text-xs text-red-400/70 mt-1.5">
            <AlertTriangle size={11} />{nameError}
          </p>
        )}
      </div>

      {/* ── Server Bio ─────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-semibold text-white/40 uppercase tracking-wider">
            Server Bio
          </label>
          <span className={`text-[10px] tabular-nums ${bio.length > BIO_MAX ? 'text-red-400/60' : 'text-white/20'}`}>
            {bio.length}/{BIO_MAX}
          </span>
        </div>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={4}
          placeholder="Tell people what your server is about. You can use markdown for formatting."
          className={`w-full bg-white/[0.04] border rounded-lg px-4 py-2.5 text-sm text-white/90 focus:outline-none focus:ring-1 resize-none transition-all placeholder:text-white/15 ${
            bioError ? 'border-red-500/40 focus:ring-red-500/50' : 'border-white/[0.06] focus:ring-dl-accent/50'
          }`}
          maxLength={BIO_MAX + 50}
        />
        {bioError && (
          <p className="flex items-center gap-1.5 text-xs text-red-400/70 mt-1.5">
            <AlertTriangle size={11} />{bioError}
          </p>
        )}
        <p className="text-[10px] text-white/15 mt-1">Supports **bold**, *italic*, and other markdown formatting.</p>
      </div>

      {/* ── Accent Color ─────────────────────────────── */}
      <div>
        <label className="block text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">
          <Palette size={12} className="inline mr-1.5 -mt-0.5" />
          Accent Color
        </label>
        <div className="flex items-center gap-3">
          <div className="flex gap-2">
            {ACCENT_PRESETS.map((color) => (
              <button
                key={color}
                onClick={() => setAccentColor(color)}
                className="w-7 h-7 rounded-full border-2 transition-all hover:scale-110"
                style={{
                  backgroundColor: color,
                  borderColor: accentColor === color ? "white" : "transparent",
                  boxShadow: accentColor === color ? `0 0 8px ${color}50` : "none",
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              className="w-7 h-7 rounded-md cursor-pointer bg-transparent border-0"
            />
            <span className="text-xs text-white/25 font-mono">{accentColor}</span>
          </div>
        </div>
        <div className="mt-3 h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}44)` }} />
      </div>

      {/* ── Vanity Invite URL ────────────────────────── */}
      <div>
        <label className="block text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">
          <Link2 size={12} className="inline mr-1.5 -mt-0.5" />
          Vanity Invite URL
        </label>
        <div className="flex items-center gap-2">
          <div className="flex items-center flex-1 bg-white/[0.04] border border-white/[0.06] rounded-lg overflow-hidden">
            <span className="text-xs text-white/20 px-3 py-2.5 bg-white/[0.02] border-r border-white/[0.04]">
              <Globe size={12} className="inline mr-1 -mt-0.5" />
              darklock.app/
            </span>
            <input
              type="text"
              value={vanityUrl}
              onChange={(e) => setVanityUrl(e.target.value.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase())}
              placeholder="your-server"
              className="flex-1 bg-transparent text-sm text-white/90 px-3 py-2.5 focus:outline-none placeholder:text-white/15"
              maxLength={32}
            />
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(`darklock.app/${vanityUrl || serverId}`);
              setCopiedInvite(true);
              setTimeout(() => setCopiedInvite(false), 1500);
            }}
            className="p-2.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-white/30 hover:text-white/60 hover:bg-white/[0.08] transition-all"
            title="Copy invite link"
          >
            {copiedInvite ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          </button>
        </div>
        {vanityUrl && (
          <p className="text-[10px] text-white/15 mt-1.5 flex items-center gap-1">
            <ExternalLink size={9} />
            Your invite link: darklock.app/{vanityUrl}
          </p>
        )}
      </div>

      {/* Save / Reset / Saved flash */}
      {saveError && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <AlertTriangle size={13} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-400/80">{saveError}</p>
        </div>
      )}
      <div className="flex items-center gap-3">
        {dirty ? (
          <>
            <button
              onClick={handleSave}
              disabled={saving || !canSave}
              className="px-6 py-2 rounded-lg bg-dl-accent text-white text-sm font-medium hover:bg-dl-accent/80 disabled:opacity-50 transition-all"
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-white/30 text-xs hover:text-white/60 hover:bg-white/[0.04] transition-all"
            >
              <RotateCcw size={12} />
              Reset
            </button>
          </>
        ) : savedFlash ? (
          <span className="flex items-center gap-2 text-sm text-green-400/80">
            <Check size={14} />
            Saved!
          </span>
        ) : (
          <span className="text-xs text-white/20">No unsaved changes</span>
        )}
      </div>

      {/* Danger Zone */}
      <div className="pt-6 border-t border-white/[0.06]">
        <h3 className="text-sm font-semibold text-red-400 mb-3">Danger Zone</h3>
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-500/30 text-red-400 text-sm hover:bg-red-500/10 transition-all"
          >
            <Trash2 size={14} />
            Delete Server
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm text-red-400">Are you sure? This cannot be undone.</span>
            <button
              onClick={handleDelete}
              className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-all"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-4 py-2 rounded-lg bg-white/[0.06] text-white/60 text-sm hover:bg-white/[0.1] transition-all"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
