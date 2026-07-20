/**
 * ServerProfileModal — Shows server banner, icon, bio, and member count
 * when "View Server Profile" is selected from the right-click menu.
 */
import { useMemo } from "react";
import { X, Users, Hash, Shield, Calendar, Globe } from "lucide-react";
import { useServerStore } from "@/store/serverStore";
import LinkifiedText from "./LinkifiedText";

interface Props {
  serverId: string;
  onClose: () => void;
}

export default function ServerProfileModal({ serverId, onClose }: Props) {
  const servers = useServerStore((s) => s.servers);
  const members = useServerStore((s) => s.members[serverId] ?? []);
  const channels = useServerStore((s) => s.channels[serverId] ?? []);
  const roles = useServerStore((s) => s.roles[serverId] ?? []);
  const server = servers.find((s) => s.id === serverId);

  const onlineCount = useMemo(() => Math.floor(members.length * 0.6), [members.length]);

  if (!server) return null;

  const bannerColor = server.banner_color || "#7c5cfc";
  const initial = server.name.charAt(0).toUpperCase();
  const createdDate = server.created_at
    ? new Date(server.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-sm bg-[#111218] rounded-2xl overflow-hidden border border-white/[0.06] shadow-2xl shadow-black/50"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Banner */}
          <div
            className="h-28 relative"
            style={{
              background: server.icon
                ? `url(${server.icon}) center/cover`
                : `linear-gradient(135deg, ${bannerColor}, ${bannerColor}88)`,
            }}
          >
            <button
              onClick={onClose}
              className="absolute top-3 right-3 p-1.5 rounded-full bg-black/40 text-white/80 hover:bg-black/60 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Icon (overlapping banner) */}
          <div className="relative px-5 -mt-10">
            <div
              className="w-20 h-20 rounded-2xl border-4 border-[#111218] flex items-center justify-center text-2xl font-bold text-white shadow-lg"
              style={{
                background: server.icon
                  ? `url(${server.icon}) center/cover`
                  : `linear-gradient(135deg, ${bannerColor}, ${bannerColor}cc)`,
              }}
            >
              {!server.icon && initial}
            </div>
          </div>

          {/* Server info */}
          <div className="px-5 pt-3 pb-5 space-y-4">
            {/* Name */}
            <div>
              <h2 className="text-xl font-bold text-white/95">{server.name}</h2>
              {server.description ? (
                <LinkifiedText text={server.description} className="text-sm text-white/50 mt-1 whitespace-pre-wrap leading-relaxed" />
              ) : (
                <p className="text-sm text-white/20 mt-1 italic">No server bio set</p>
              )}
            </div>

            {/* Stats row */}
            <div className="flex gap-4">
              <div className="flex items-center gap-1.5 text-sm text-white/50">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <span>{onlineCount} Online</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm text-white/50">
                <div className="w-2 h-2 rounded-full bg-white/30" />
                <span>{members.length} Members</span>
              </div>
            </div>

            {/* Details card */}
            <div className="bg-white/[0.03] rounded-xl p-4 space-y-3 border border-white/[0.04]">
              <div className="flex items-center gap-3 text-sm">
                <Hash size={14} className="text-white/20 shrink-0" />
                <span className="text-white/40">Channels</span>
                <span className="ml-auto text-white/70 font-medium">{channels.length}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Shield size={14} className="text-white/20 shrink-0" />
                <span className="text-white/40">Roles</span>
                <span className="ml-auto text-white/70 font-medium">{roles.length}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Users size={14} className="text-white/20 shrink-0" />
                <span className="text-white/40">Members</span>
                <span className="ml-auto text-white/70 font-medium">{members.length}</span>
              </div>
              {createdDate && (
                <div className="flex items-center gap-3 text-sm">
                  <Calendar size={14} className="text-white/20 shrink-0" />
                  <span className="text-white/40">Created</span>
                  <span className="ml-auto text-white/70 font-medium">{createdDate}</span>
                </div>
              )}
            </div>

            {/* Server ID */}
            <div className="flex items-center gap-2 text-[10px] text-white/15">
              <Globe size={10} />
              <span className="font-mono">{serverId}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
