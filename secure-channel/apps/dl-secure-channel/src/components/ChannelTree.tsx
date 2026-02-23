import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Hash, Volume2, Radio, Megaphone, BookOpen, MessageCircle, Lock, Eye, GripVertical, ChevronDown, ChevronRight, FolderOpen, Shield, ShieldAlert } from "lucide-react";
import clsx from "clsx";
import type { ChannelDto, ChannelUnreadDto } from "@/types";
import type { VoiceMemberDto } from "@/store/voiceStore";

interface ChannelTreeProps {
  channels: ChannelDto[];
  activeChannelId?: string | null;
  unreadByChannel?: Record<string, ChannelUnreadDto>;
  voiceMembersByChannel?: Record<string, VoiceMemberDto[]>;
  connectedVoiceChannelId?: string | null;
  canManageChannels?: boolean;
  onSelectChannel?: (channel: ChannelDto) => void;
  onJoinVoice?: (channel: ChannelDto) => void;
  onReorder?: (layout: { id: string; position: number; category_id?: string | null }[]) => Promise<void> | void;
  renderChannelSuffix?: (channel: ChannelDto) => ReactNode;
}

type FlatRow = {
  channel: ChannelDto;
  depth: number;
  categoryId: string | null;
};

const isVoice = (t: string | null) => t === "voice" || t === "stage";

function channelIcon(type: string | null) {
  switch (type) {
    case "voice": return <Volume2 size={15} className="text-white/40 shrink-0" />;
    case "stage": return <Radio size={15} className="text-purple-400/60 shrink-0" />;
    case "announcement": return <Megaphone size={15} className="text-white/40 shrink-0" />;
    case "rules": return <BookOpen size={15} className="text-white/40 shrink-0" />;
    case "forum": return <MessageCircle size={15} className="text-green-400/60 shrink-0" />;
    case "private_encrypted": return <Lock size={15} className="text-red-400/60 shrink-0" />;
    case "read_only_news": return <Eye size={15} className="text-blue-400/60 shrink-0" />;
    case "category": return <FolderOpen size={14} className="text-dl-accent/55 shrink-0" />;
    default: return <Hash size={15} className="text-white/40 shrink-0" />;
  }
}

export default function ChannelTree({
  channels,
  activeChannelId,
  unreadByChannel,
  voiceMembersByChannel,
  connectedVoiceChannelId,
  canManageChannels = false,
  onSelectChannel,
  onJoinVoice,
  onReorder,
  renderChannelSuffix,
}: ChannelTreeProps) {
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);

  const flatRows = useMemo(() => {
    const categories = channels.filter((c) => c.type === "category").sort((a, b) => a.position - b.position);
    const nonCategories = channels.filter((c) => c.type !== "category").sort((a, b) => a.position - b.position);
    const used = new Set<string>();
    const rows: FlatRow[] = [];
    for (const cat of categories) {
      rows.push({ channel: cat, depth: 0, categoryId: null });
      if (!collapsedCategories.has(cat.id)) {
        const children = nonCategories.filter((c) => c.category_id === cat.id);
        for (const child of children) {
          used.add(child.id);
          rows.push({ channel: child, depth: 1, categoryId: cat.id });
        }
      } else {
        nonCategories.filter((c) => c.category_id === cat.id).forEach((c) => used.add(c.id));
      }
    }
    for (const ch of nonCategories.filter((c) => !used.has(c.id))) {
      rows.push({ channel: ch, depth: 0, categoryId: null });
    }
    return rows;
  }, [channels, collapsedCategories]);

  const commitReorder = async (fromId: string, targetId: string) => {
    if (!onReorder) return;
    const ordered = [...channels].sort((a, b) => a.position - b.position);
    const fromIdx = ordered.findIndex((c) => c.id === fromId);
    const toIdx = ordered.findIndex((c) => c.id === targetId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;

    const next = [...ordered];
    const [removed] = next.splice(fromIdx, 1);
    if (!removed) return;
    const moved = { ...removed };
    const target = next[toIdx];
    if (target) {
      if (target.type === "category" && moved.type !== "category") {
        moved.category_id = target.id;
      } else if (moved.type !== "category") {
        moved.category_id = target.category_id ?? null;
      } else {
        moved.category_id = null;
      }
    }
    next.splice(toIdx, 0, moved);
    const payload = next.map((c, idx) => ({ id: c.id, position: idx, category_id: c.category_id ?? null }));
    await onReorder(payload);
  };

  return (
    <div className="space-y-0.5">
      {flatRows.map(({ channel, depth }) => {
        const unread = unreadByChannel?.[channel.id];
        const unreadCount = unread?.unread_count ?? 0;
        const mentionCount = unread?.mention_count ?? 0;
        const voiceMembers = voiceMembersByChannel?.[channel.id] ?? [];
        const isConnected = connectedVoiceChannelId === channel.id;
        const isCategory = channel.type === "category";
        const isCollapsed = isCategory && collapsedCategories.has(channel.id);
        const indent = depth > 0 ? "pl-7" : "pl-3";

        return (
          <div
            key={channel.id}
            draggable={canManageChannels}
            onDragStart={(e) => {
              if (!canManageChannels) return;
              e.dataTransfer.setData("text/plain", channel.id);
              e.dataTransfer.effectAllowed = "move";
              setDragId(channel.id);
            }}
            onDragOver={(e) => {
              if (!canManageChannels) return;
              e.preventDefault();
              setDropId(channel.id);
            }}
            onDrop={async (e) => {
              if (!canManageChannels) return;
              e.preventDefault();
              const fromId = e.dataTransfer.getData("text/plain");
              await commitReorder(fromId, channel.id);
              setDragId(null);
              setDropId(null);
            }}
            onDragEnd={() => { setDragId(null); setDropId(null); }}
            className={clsx(
              "relative rounded-md transition-all",
              dragId === channel.id && "opacity-40",
              dropId === channel.id && dragId && dragId !== channel.id && "ring-1 ring-inset ring-dl-accent/40"
            )}
          >
            {canManageChannels && (
              <GripVertical size={11} className="absolute left-1 top-1/2 -translate-y-1/2 text-white/20 pointer-events-none" />
            )}
            <button
              onClick={() => {
                if (isCategory) {
                  setCollapsedCategories((prev) => {
                    const next = new Set(prev);
                    next.has(channel.id) ? next.delete(channel.id) : next.add(channel.id);
                    return next;
                  });
                  return;
                }
                if (isVoice(channel.type)) onJoinVoice?.(channel);
                else onSelectChannel?.(channel);
              }}
              className={clsx(
                "w-full flex items-center gap-2 py-1.5 pr-2 text-left rounded-md text-sm",
                indent,
                activeChannelId === channel.id || isConnected
                  ? "bg-white/[0.08] text-white"
                  : "text-white/55 hover:bg-white/[0.04] hover:text-white/80"
              )}
            >
              {isCategory && (isCollapsed ? <ChevronRight size={10} className="text-white/35 shrink-0" /> : <ChevronDown size={10} className="text-white/35 shrink-0" />)}
              {channelIcon(channel.type)}
              <span className={clsx("truncate", isCategory && "uppercase text-[11px] tracking-wide font-semibold")}>
                {channel.name}
              </span>
              {/* Secure channel indicator */}
              {channel.is_secure && !isCategory && (
                channel.lockdown ? (
                  <span title="Lockdown Active"><ShieldAlert size={12} className="text-red-400 shrink-0 ml-0.5" /></span>
                ) : (
                  <span title="Secure Channel"><Shield size={12} className="text-emerald-400 shrink-0 ml-0.5" /></span>
                )
              )}

              {voiceMembers.length > 0 && isVoice(channel.type) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400/70 border border-green-500/15 ml-auto">
                  {voiceMembers.length}
                </span>
              )}
              {!isVoice(channel.type) && unreadCount > 0 && (
                <span className={clsx(
                  "text-[10px] px-1.5 py-0.5 rounded-full ml-auto",
                  mentionCount > 0 ? "bg-red-500/20 text-red-300" : "bg-white/[0.1] text-white/65"
                )}>
                  {mentionCount > 0 ? `@${mentionCount}` : unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
              {renderChannelSuffix?.(channel)}
            </button>
          </div>
        );
      })}
      {flatRows.length === 0 && (
        <div className="text-xs text-white/25 italic px-3 py-2">No channels yet</div>
      )}
    </div>
  );
}
