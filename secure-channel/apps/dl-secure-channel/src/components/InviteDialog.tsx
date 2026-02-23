/**
 * InviteDialog — Modal for creating, viewing, and sharing server invites.
 * Also handles joining a server via invite code.
 */
import { useEffect, useState } from "react";
import {
  Link2,
  Copy,
  Check,
  Trash2,
  X,
  Clock,
  Users,
  Plus,
} from "lucide-react";
import { format, parseISO } from "date-fns";

import { useLayoutStore } from "@/store/layoutStore";
import { useServerStore } from "@/store/serverStore";
import type { InviteDto } from "@/types";

type ExpiresIn = "1h" | "24h" | "7d" | "never";

const EXPIRY_LABELS: Record<ExpiresIn, string> = {
  "1h": "1 hour",
  "24h": "24 hours",
  "7d": "7 days",
  "never": "Never",
};

export default function InviteDialog() {
  const { inviteDialogOpen, setInviteDialogOpen, activeServerId } = useLayoutStore();
  const fetchInvites = useServerStore((s) => s.fetchInvites);
  const createInvite = useServerStore((s) => s.createInvite);
  const revokeInvite = useServerStore((s) => s.revokeInvite);
  const invites = useServerStore((s) => activeServerId ? (s.invites[activeServerId] ?? []) : []);
  const servers = useServerStore((s) => s.servers);

  const [expiresIn, setExpiresIn] = useState<ExpiresIn>("24h");
  const [maxUses, setMaxUses] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [tab, setTab] = useState<"create" | "join">("create");

  const server = servers.find((s) => s.id === activeServerId);

  useEffect(() => {
    if (inviteDialogOpen && activeServerId) {
      fetchInvites(activeServerId).catch(console.error);
    }
  }, [inviteDialogOpen, activeServerId, fetchInvites]);

  if (!inviteDialogOpen) return null;

  const handleCreate = async () => {
    if (!activeServerId) return;
    setCreating(true);
    try {
      await createInvite(
        activeServerId,
        expiresIn === "never" ? undefined : expiresIn,
        maxUses ?? undefined,
      );
    } catch (e) {
      console.error("Create invite failed:", e);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (inviteId: string) => {
    if (!activeServerId) return;
    try {
      await revokeInvite(activeServerId, inviteId);
    } catch (e) {
      console.error("Revoke invite failed:", e);
    }
  };

  const handleCopy = async (invite: InviteDto) => {
    try {
      await navigator.clipboard.writeText(`darklock.app/invite/${invite.token}`);
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* */ }
  };

  const handleJoin = async () => {
    if (!joinCode.trim()) return;
    setJoining(true);
    setJoinError(null);
    try {
      const { joinViaInvite } = await import("@/lib/tauri");
      await joinViaInvite(joinCode.trim());
      const { fetchServers } = useServerStore.getState();
      await fetchServers();
      setInviteDialogOpen(false);
    } catch (e) {
      setJoinError(String(e));
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#111218] rounded-xl border border-white/[0.06] shadow-2xl w-[480px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <Link2 size={18} className="text-dl-accent" />
            <h2 className="text-base font-semibold text-white/90">
              {tab === "create" ? `Invite to ${server?.name ?? "Server"}` : "Join a Server"}
            </h2>
          </div>
          <button
            onClick={() => setInviteDialogOpen(false)}
            className="w-7 h-7 rounded-full flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/[0.06]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pb-3">
          <button
            onClick={() => setTab("create")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === "create"
                ? "bg-white/[0.08] text-white/80"
                : "text-white/30 hover:text-white/50 hover:bg-white/[0.04]"
            }`}
          >
            Create Invite
          </button>
          <button
            onClick={() => setTab("join")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === "join"
                ? "bg-white/[0.08] text-white/80"
                : "text-white/30 hover:text-white/50 hover:bg-white/[0.04]"
            }`}
          >
            Join Server
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {tab === "create" ? (
            <>
              {/* Create form */}
              <div className="space-y-3 mb-4">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1 block">
                    Expires After
                  </label>
                  <div className="flex gap-1.5">
                    {(Object.keys(EXPIRY_LABELS) as ExpiresIn[]).map((key) => (
                      <button
                        key={key}
                        onClick={() => setExpiresIn(key)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          expiresIn === key
                            ? "bg-dl-accent/20 text-dl-accent border border-dl-accent/30"
                            : "bg-white/[0.04] text-white/40 hover:bg-white/[0.06] border border-transparent"
                        }`}
                      >
                        {EXPIRY_LABELS[key]}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1 block">
                    Max Uses (0 = unlimited)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={maxUses ?? 0}
                    onChange={(e) => setMaxUses(parseInt(e.target.value) || null)}
                    className="w-20 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-white/80 focus:outline-none focus:border-dl-accent/40"
                  />
                </div>
                <button
                  onClick={handleCreate}
                  disabled={creating || !activeServerId}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-dl-accent/90 hover:bg-dl-accent text-white text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <Plus size={14} />
                  {creating ? "Creating..." : "Generate Invite Link"}
                </button>
              </div>

              {/* Existing invites */}
              {invites.length > 0 && (
                <>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-2">
                    Active Invites ({invites.length})
                  </div>
                  <div className="space-y-2">
                    {invites.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center justify-between bg-white/[0.03] rounded-lg p-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <code className="text-sm text-dl-accent font-mono truncate">
                              {inv.token}
                            </code>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-[10px] text-white/30">
                            {inv.expires_at && (
                              <span className="flex items-center gap-1">
                                <Clock size={10} />
                                {formatExpiry(inv.expires_at)}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Users size={10} />
                              {inv.use_count}{inv.max_uses ? `/${inv.max_uses}` : ""} uses
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          <button
                            onClick={() => handleCopy(inv)}
                            className="w-7 h-7 rounded flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06]"
                            title="Copy"
                          >
                            {copiedId === inv.id ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                          </button>
                          <button
                            onClick={() => handleRevoke(inv.id)}
                            className="w-7 h-7 rounded flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-white/[0.06]"
                            title="Revoke"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            /* Join tab */
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1 block">
                  Invite Code
                </label>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="Paste invite code here..."
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-dl-accent/40"
                  onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                />
              </div>
              {joinError && (
                <p className="text-xs text-red-400">{joinError}</p>
              )}
              <button
                onClick={handleJoin}
                disabled={joining || !joinCode.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-dl-accent/90 hover:bg-dl-accent text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {joining ? "Joining..." : "Join Server"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatExpiry(iso: string): string {
  try {
    return format(parseISO(iso), "MMM d 'at' HH:mm");
  } catch {
    return iso;
  }
}
