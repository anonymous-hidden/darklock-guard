/**
 * InvitesTab — Manage server invites: create, view, revoke.
 * Shows active invites with usage stats and expiration.
 */
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Link2,
  Copy,
  Trash2,
  Plus,
  Clock,
  Users,
  Check,
  Search,
  Globe,
  ShieldCheck,
  QrCode,
  Eye,
} from "lucide-react";
import { useServerStore } from "@/store/serverStore";

interface InviteEntry {
  inviteId: string;
  code: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number;
  uses: number;
  temporary: boolean;
}

const EXPIRY_OPTIONS = [
  { label: "30 minutes", value: 1800 },
  { label: "1 hour", value: 3600 },
  { label: "6 hours", value: 21600 },
  { label: "12 hours", value: 43200 },
  { label: "1 day", value: 86400 },
  { label: "7 days", value: 604800 },
  { label: "Never", value: 0 },
];

const MAX_USES_OPTIONS = [0, 1, 5, 10, 25, 50, 100];

export default function InvitesTab({ serverId }: { serverId: string }) {
  const invites = useServerStore((s) => s.invites[serverId] ?? []);
  const servers = useServerStore((s) => s.servers);
  const fetchInvites = useServerStore((s) => s.fetchInvites);
  const createInvite = useServerStore((s) => s.createInvite);
  const revokeInvite = useServerStore((s) => s.revokeInvite);
  const serverName = servers.find((s) => s.id === serverId)?.name ?? "Server";
  const memberCount = servers.find((s) => s.id === serverId)?.member_count ?? 0;

  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newMaxAge, setNewMaxAge] = useState(86400);
  const [newMaxUses, setNewMaxUses] = useState(0);
  const [newTemporary, setNewTemporary] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null);
  const [previewCode, setPreviewCode] = useState<string | null>(null);

  useEffect(() => {
    fetchInvites(serverId);
  }, [serverId, fetchInvites]);

  // Map backend invites to our display format
  const displayInvites: InviteEntry[] = useMemo(() => {
    return invites.map((inv: any) => ({
      inviteId: inv.id,
      code: inv.token ?? inv.code ?? inv.id,
      createdBy: inv.creator_name ?? inv.created_by_name ?? inv.inviter_name ?? "Unknown",
      createdAt: inv.created_at ?? new Date().toISOString(),
      expiresAt: inv.expires_at ?? null,
      maxUses: inv.max_uses ?? 0,
      uses: inv.use_count ?? inv.uses ?? 0,
      temporary: inv.temporary ?? false,
    }));
  }, [invites]);

  const filtered = useMemo(() => {
    if (!search) return displayInvites;
    const q = search.toLowerCase();
    return displayInvites.filter(
      (i) => i.code.toLowerCase().includes(q) || i.createdBy.toLowerCase().includes(q)
    );
  }, [displayInvites, search]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      await createInvite(serverId, String(newMaxAge), newMaxUses);
      // Grab the latest invite (just created) for preview
      const latest = useServerStore.getState().invites[serverId];
      if (latest && latest.length > 0) {
        const newest = latest[latest.length - 1] as any;
        setPreviewCode(newest.token ?? newest.code ?? newest.id ?? null);
      }
      setShowCreate(false);
      setNewMaxAge(86400);
      setNewMaxUses(0);
      setNewTemporary(false);
    } catch (e) {
      console.error("[InvitesTab] create failed:", e);
    } finally {
      setCreating(false);
    }
  }, [serverId, newMaxAge, newMaxUses, createInvite]);

  const handleCopy = useCallback((code: string) => {
    navigator.clipboard.writeText(`darklock.app/invite/${code}`);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 1500);
  }, []);

  const handleRevoke = useCallback(async (inviteId: string) => {
    try {
      await revokeInvite(serverId, inviteId);
      setRevokeConfirm(null);
    } catch (e) {
      console.error("[InvitesTab] revoke failed:", e);
    }
  }, [serverId, revokeInvite]);

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  const formatExpiry = (expiresAt: string | null) => {
    if (!expiresAt) return "Never";
    const d = new Date(expiresAt);
    if (d < new Date()) return "Expired";
    const diff = d.getTime() - Date.now();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return `${Math.floor(diff / 60000)}m left`;
    if (hours < 24) return `${hours}h left`;
    return `${Math.floor(hours / 24)}d left`;
  };

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Header: search + create button */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invites…"
            className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg pl-9 pr-4 py-2.5 text-sm text-white/90 placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-dl-accent/50 transition-all"
          />
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-dl-accent text-white text-sm font-medium hover:bg-dl-accent/80 transition-all"
        >
          <Plus size={14} />
          Create Invite
        </button>
      </div>

      {/* Create invite panel */}
      {showCreate && (
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-white/50 uppercase tracking-wider">
            <Link2 size={12} />
            New Invite
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-white/30 mb-1.5">Expire After</label>
              <select
                value={newMaxAge}
                onChange={(e) => setNewMaxAge(Number(e.target.value))}
                className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-white/60 focus:outline-none focus:ring-1 focus:ring-dl-accent/50"
              >
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-white/30 mb-1.5">Max Uses</label>
              <select
                value={newMaxUses}
                onChange={(e) => setNewMaxUses(Number(e.target.value))}
                className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-white/60 focus:outline-none focus:ring-1 focus:ring-dl-accent/50"
              >
                {MAX_USES_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n === 0 ? "No limit" : `${n} uses`}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Temporary membership toggle */}
          <label className="flex items-center gap-3 cursor-pointer bg-white/[0.02] rounded-lg p-3 border border-white/[0.04]">
            <div
              className={`w-9 h-5 rounded-full transition-all relative shrink-0 ${newTemporary ? "bg-amber-500" : "bg-white/10"}`}
              onClick={(e) => { e.preventDefault(); setNewTemporary(!newTemporary); }}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${newTemporary ? "left-[18px]" : "left-0.5"}`} />
            </div>
            <div>
              <p className="text-xs text-white/60">Temporary Membership</p>
              <p className="text-[10px] text-white/25">Members who join via this invite are kicked when they disconnect</p>
            </div>
          </label>

          {/* Invite Preview Card */}
          <div className="bg-[#111218] border border-white/[0.06] rounded-xl p-4 space-y-3">
            <p className="text-[10px] text-white/25 uppercase tracking-wider font-semibold flex items-center gap-1.5">
              <Eye size={10} /> Invite Preview
            </p>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-dl-accent/20 flex items-center justify-center text-lg font-bold text-dl-accent shrink-0">
                {serverName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white/80 truncate">{serverName}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="flex items-center gap-1 text-[10px] text-white/30">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    Online
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-white/30">
                    <Users size={9} /> {memberCount} member{memberCount !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
              <div className="px-3 py-1.5 rounded-lg bg-dl-accent text-white text-xs font-medium">
                Join
              </div>
            </div>
            <p className="text-[10px] text-white/15 font-mono">darklock.app/invite/{'•'.repeat(8)}</p>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 rounded-lg text-xs text-white/30 hover:text-white/50 hover:bg-white/[0.04] transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-dl-accent text-white hover:bg-dl-accent/80 disabled:opacity-50 transition-all"
            >
              {creating ? "Creating…" : "Generate Link"}
            </button>
          </div>
        </div>
      )}

      {/* Created invite success card */}
      {previewCode && !showCreate && (
        <div className="bg-green-500/[0.05] border border-green-500/20 rounded-xl p-4 space-y-3 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-green-400/80 flex items-center gap-1.5">
              <Check size={12} /> Invite Created
            </p>
            <button
              onClick={() => setPreviewCode(null)}
              className="text-[10px] text-white/25 hover:text-white/50 transition-colors"
            >
              Dismiss
            </button>
          </div>
          <div className="flex items-center gap-3 bg-black/20 rounded-lg p-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-dl-accent/20 flex items-center justify-center shrink-0">
                <QrCode size={18} className="text-dl-accent/60" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-mono font-medium text-white/80 truncate">
                  darklock.app/invite/{previewCode}
                </p>
                <p className="text-[10px] text-white/25 mt-0.5">
                  Share this link to invite people to {serverName}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleCopy(previewCode)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-dl-accent text-white hover:bg-dl-accent/80 transition-all flex items-center gap-1.5 shrink-0"
            >
              {copiedCode === previewCode ? (
                <><Check size={12} /> Copied</>
              ) : (
                <><Copy size={12} /> Copy</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div className="flex items-center gap-4 text-xs text-white/25">
        <span className="flex items-center gap-1"><Link2 size={11} />{displayInvites.length} invite{displayInvites.length !== 1 ? "s" : ""}</span>
        <span className="flex items-center gap-1"><Users size={11} />{displayInvites.reduce((a, i) => a + i.uses, 0)} total uses</span>
      </div>

      {/* Invite list */}
      <div className="space-y-1">
        {filtered.length === 0 && (
          <div className="text-center py-8 text-white/20 text-sm">
            {search ? "No invites match your search." : "No active invites. Create one to share with others!"}
          </div>
        )}

        {filtered.map((invite) => {
          const expired = isExpired(invite.expiresAt);
          return (
            <div
              key={invite.code}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-white/[0.03] transition-all group ${expired ? "opacity-50" : ""}`}
            >
              <div className="w-9 h-9 rounded-full bg-white/[0.04] flex items-center justify-center shrink-0">
                {expired ? (
                  <Clock size={14} className="text-white/20" />
                ) : invite.temporary ? (
                  <ShieldCheck size={14} className="text-amber-400/60" />
                ) : (
                  <Globe size={14} className="text-dl-accent/60" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-medium text-white/70">
                    darklock.app/invite/{invite.code}
                  </span>
                  {invite.temporary && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400/60 border border-amber-500/15">
                      Temporary
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-[10px] text-white/25">by {invite.createdBy}</span>
                  <span className="text-[10px] text-white/15">·</span>
                  <span className="text-[10px] text-white/25 flex items-center gap-1">
                    <Users size={9} />
                    {invite.uses}{invite.maxUses > 0 ? `/${invite.maxUses}` : ""} uses
                  </span>
                  <span className="text-[10px] text-white/15">·</span>
                  <span className={`text-[10px] flex items-center gap-1 ${expired ? "text-red-400/50" : "text-white/25"}`}>
                    <Clock size={9} />
                    {formatExpiry(invite.expiresAt)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleCopy(invite.code)}
                  className="p-1.5 rounded-md text-white/25 hover:text-white/60 hover:bg-white/[0.06] transition-all"
                  title="Copy invite link"
                >
                  {copiedCode === invite.code ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                </button>

                {revokeConfirm === invite.inviteId ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleRevoke(invite.inviteId)}
                      className="text-[10px] px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                    >
                      Revoke
                    </button>
                    <button
                      onClick={() => setRevokeConfirm(null)}
                      className="text-[10px] px-2 py-1 rounded bg-white/[0.04] text-white/40 hover:bg-white/[0.08] transition-colors"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setRevokeConfirm(invite.inviteId)}
                    className="p-1.5 rounded-md text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-all"
                    title="Revoke invite"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
