/**
 * ServerSidebar — Discord-style vertical icon rail (far left).
 * Home icon → DMs, server icons (from IDS), + button, settings gear at bottom.
 */
import React, { useEffect, useState } from "react";
import {
  Plus,
  Settings,
  Shield,
} from "lucide-react";
import clsx from "clsx";

import { useLayoutStore } from "@/store/layoutStore";
import { useServerStore } from "@/store/serverStore";
import { useChatStore } from "@/store/chatStore";
import { useSettingsStore } from "@/store/settingsStore";
import ServerProfileModal from "@/components/ServerProfileModal";
import logo from "@/assets/logo.png";

export default function ServerSidebar() {
  const { sidebarView, activeServerId, setActiveServer, openServerSettings } = useLayoutStore();
  const servers = useServerStore((s) => s.servers);
  const unreadByServer = useServerStore((s) => s.unreadByServer);
  const fetchServers = useServerStore((s) => s.fetchServers);
  const fetchServerUnread = useServerStore((s) => s.fetchServerUnread);
  const groups = useChatStore((s) => s.groups);
  const openSettings = useSettingsStore((s) => s.openSettings);

  const [ctxMenu, setCtxMenu] = useState<{ serverId: string; x: number; y: number } | null>(null);
  const [profileServerId, setProfileServerId] = useState<string | null>(null);

  // Load servers from IDS on mount
  useEffect(() => {
    fetchServers().catch(console.error);
  }, [fetchServers]);

  useEffect(() => {
    if (servers.length === 0) return;
    const pull = () => {
      for (const sv of servers) {
        fetchServerUnread(sv.id).catch(() => {});
      }
    };
    pull();
    const iv = setInterval(pull, 10_000);
    return () => clearInterval(iv);
  }, [servers, fetchServerUnread]);

  const handleServerContext = (e: React.MouseEvent, serverId: string) => {
    e.preventDefault();
    setCtxMenu({ serverId, x: e.clientX, y: e.clientY });
  };

  return (
    <div className="server-sidebar">
      {/* Server profile modal */}
      {profileServerId && (
        <ServerProfileModal serverId={profileServerId} onClose={() => setProfileServerId(null)} />
      )}

      {/* Context menu */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setCtxMenu(null)} />
          <div
            className="fixed z-50 w-44 bg-[#1a1d27] border border-white/[0.08] rounded-lg shadow-xl py-1"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button
              onClick={() => {
                setProfileServerId(ctxMenu.serverId);
                setCtxMenu(null);
              }}
              className="w-full text-left px-3 py-2 text-sm text-white/60 hover:bg-white/[0.06] hover:text-white/90"
            >
              View Server Profile
            </button>
            <div className="border-t border-white/[0.06] my-0.5" />
            <button
              onClick={() => {
                setActiveServer(ctxMenu.serverId);
                openServerSettings("overview");
                setCtxMenu(null);
              }}
              className="w-full text-left px-3 py-2 text-sm text-white/60 hover:bg-white/[0.06] hover:text-white/90"
            >
              Server Settings
            </button>
            <button
              onClick={() => {
                setActiveServer(ctxMenu.serverId);
                openServerSettings("roles");
                setCtxMenu(null);
              }}
              className="w-full text-left px-3 py-2 text-sm text-white/60 hover:bg-white/[0.06] hover:text-white/90"
            >
              Manage Roles
            </button>
          </div>
        </>
      )}

      {/* Home / DMs button */}
      <div className="server-sidebar__section">
        <ServerIcon
          active={sidebarView === "home"}
          tooltip="Direct Messages"
          onClick={() => setActiveServer(null)}
        >
          <img src={logo} alt="Home" className="w-7 h-7 object-contain" />
        </ServerIcon>
      </div>

      {/* Separator */}
      <div className="server-sidebar__separator" />

      {/* Server / group list */}
      <div className="server-sidebar__servers">
        {/* IDS-backed servers */}
        {servers.map((sv) => (
          <ServerIcon
            key={sv.id}
            active={activeServerId === sv.id}
            tooltip={sv.name}
            hasUnread={!!unreadByServer[sv.id]?.has_unread}
            mentionCount={unreadByServer[sv.id]?.mention_count ?? 0}
            onClick={() => setActiveServer(sv.id)}
            onContextMenu={(e: React.MouseEvent) => handleServerContext(e, sv.id)}
          >
            {sv.icon ? (
              <img src={sv.icon} alt={sv.name} className="w-7 h-7 rounded-full object-cover" />
            ) : (
              <span className="text-sm font-semibold leading-none">
                {sv.name.charAt(0).toUpperCase()}
              </span>
            )}
          </ServerIcon>
        ))}

        {/* Legacy local groups (backwards-compat) */}
        {groups.map((g) => (
          <ServerIcon
            key={g.id}
            active={activeServerId === g.id}
            tooltip={g.name}
            onClick={() => setActiveServer(g.id)}
          >
            <span className="text-sm font-semibold leading-none">
              {g.name.charAt(0).toUpperCase()}
            </span>
          </ServerIcon>
        ))}

        {/* Add server */}
        <ServerIcon tooltip="Create Server" onClick={() => {/* handled by parent via event */}}
          className="server-icon--add"
          data-action="create-group"
        >
          <Plus size={20} />
        </ServerIcon>
      </div>

      {/* Bottom icons */}
      <div className="server-sidebar__bottom">
        <div className="server-sidebar__separator" />
        <ServerIcon tooltip="Security" onClick={() => openSettings("security")}>
          <Shield size={18} />
        </ServerIcon>
        <ServerIcon tooltip="Settings" onClick={() => openSettings("account")}>
          <Settings size={18} />
        </ServerIcon>
      </div>
    </div>
  );
}

/* ── ServerIcon pill button ─────────────────────────────────────────────── */

function ServerIcon({
  children,
  active = false,
  tooltip,
  hasUnread = false,
  mentionCount = 0,
  onClick,
  onContextMenu,
  className,
  ...rest
}: {
  children: React.ReactNode;
  active?: boolean;
  tooltip: string;
  hasUnread?: boolean;
  mentionCount?: number;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  className?: string;
  [key: string]: unknown;
}) {
  return (
    <div className="server-icon-wrapper group" {...rest}>
      {/* Active pill indicator */}
      <div
        className={clsx(
          "server-icon-pill",
          active && "server-icon-pill--active"
        )}
      />

      <button
        onClick={onClick}
        onContextMenu={onContextMenu}
        className={clsx(
          "server-icon",
          active && "server-icon--active",
          className
        )}
        aria-label={tooltip}
      >
        {children}
        {(hasUnread || mentionCount > 0) && (
          <span className="server-icon-notification">
            {mentionCount > 0 ? (mentionCount > 9 ? "9+" : mentionCount) : ""}
          </span>
        )}
      </button>

      {/* Tooltip */}
      <div className="server-icon-tooltip">
        {tooltip}
      </div>
    </div>
  );
}
