/**
 * InviteEmbed — Discord-style invite card rendered inline in chat messages.
 * Shows server name, icon, member count, description, and a Join button.
 * Fetches invite info via the public invite preview endpoint.
 */
import { useState, useEffect } from "react";
import { Users, ArrowRight, Loader2, AlertCircle, ShieldCheck } from "lucide-react";
import { useServerStore } from "@/store/serverStore";
import type { InviteInfoDto } from "@/types";

interface InviteEmbedProps {
  /** The invite token / code */
  inviteCode: string;
  /** If set, render compact style */
  compact?: boolean;
}

export default function InviteEmbed({ inviteCode, compact: _compact }: InviteEmbedProps) {
  const [info, setInfo] = useState<InviteInfoDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const servers = useServerStore((s) => s.servers);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { getInviteInfo } = await import("@/lib/tauri");
        const data = await getInviteInfo(inviteCode);
        if (!cancelled) setInfo(data);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [inviteCode]);

  // Check if we're already in this server
  const alreadyJoined = info && servers.some(
    (s) => (info.server_id ? s.id === info.server_id : s.name === info.server_name)
  );

  const handleJoin = async () => {
    setJoining(true);
    try {
      const { joinViaInvite } = await import("@/lib/tauri");
      await joinViaInvite(inviteCode);
      const { fetchServers } = useServerStore.getState();
      await fetchServers();
      setJoined(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 max-w-[400px] flex items-center gap-3 animate-pulse">
        <Loader2 size={16} className="animate-spin text-white/30" />
        <span className="text-xs text-white/30">Loading invite...</span>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="bg-white/[0.03] border border-red-500/10 rounded-xl p-4 max-w-[400px] flex items-center gap-3">
        <AlertCircle size={16} className="text-red-400/60 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-red-400/80">Invalid or expired invite</p>
          <p className="text-[10px] text-white/20 font-mono truncate mt-0.5">{inviteCode}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#111218] border border-white/[0.06] rounded-xl overflow-hidden max-w-[400px]">
      {info.server_banner && (
        <div className="h-16 w-full bg-center bg-cover" style={{ backgroundImage: `url(${info.server_banner})` }} />
      )}
      {/* Header */}
      <div className="px-4 pt-3 pb-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/25">
          You've been invited to join a server
        </p>
      </div>

      {/* Server info */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Server icon */}
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold text-white shrink-0 overflow-hidden"
          style={{
            background: info.server_icon
              ? `url(${info.server_icon}) center/cover`
              : "linear-gradient(135deg, #6366f1, #6366f188)",
          }}
        >
          {!info.server_icon && info.server_name.charAt(0).toUpperCase()}
        </div>

        {/* Name + stats */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-white/90 truncate">{info.server_name}</p>
            <ShieldCheck size={12} className="text-dl-accent/60 shrink-0" />
          </div>
          {(info.server_bio || info.server_description) ? (
            <p className="text-[11px] text-white/30 truncate mt-0.5">{info.server_bio ?? info.server_description}</p>
          ) : (
            <p className="text-[11px] text-white/15 italic truncate mt-0.5">No server bio set</p>
          )}
          <div className="flex items-center gap-3 mt-1">
            <span className="flex items-center gap-1 text-[10px] text-white/30">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Online
            </span>
            <span className="flex items-center gap-1 text-[10px] text-white/30">
              <Users size={9} />
              {info.member_count} member{info.member_count !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Join / Joined button */}
        {joined || alreadyJoined ? (
          <span className="px-3 py-1.5 rounded-lg bg-white/[0.06] text-white/40 text-xs font-medium shrink-0">
            Joined
          </span>
        ) : (
          <button
            onClick={handleJoin}
            disabled={joining}
            className="px-4 py-1.5 rounded-lg bg-dl-accent text-white text-xs font-medium hover:bg-dl-accent/80 transition-all disabled:opacity-50 shrink-0 flex items-center gap-1.5"
          >
            {joining ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
            {joining ? "Joining..." : "Join"}
          </button>
        )}
      </div>
    </div>
  );
}
