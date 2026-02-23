/**
 * ServerSettingsModal — Full-screen modal for managing a server's roles,
 * channels, members, and audit log. Mirrors the User Settings layout.
 */
import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {  X,
  Info,
  Shield,
  ShieldAlert,
  Users,
  Hash,
  ScrollText,
  Paintbrush,
  Link2,
} from "lucide-react";
import clsx from "clsx";

import { useLayoutStore, type ServerSettingsTab } from "@/store/layoutStore";
import { useServerStore } from "@/store/serverStore";
import { useChatStore } from "@/store/chatStore";
import RolesTab from "./tabs/RolesTab";
import MembersTab from "./tabs/MembersTab";
import ChannelsTab from "./tabs/ChannelsTab";
import OverviewTab from "./tabs/OverviewTab";
import AuditLogTab from "./tabs/AuditLogTab";
import AppearanceTab from "./tabs/AppearanceTab";
import SecurityTab from "./tabs/SecurityTab";
import InvitesTab from "./tabs/InvitesTab";

const TAB_TITLES: Record<ServerSettingsTab, string> = {
  overview: "Overview",
  appearance: "Appearance",
  roles: "Roles",
  members: "Members",
  channels: "Channels",
  invites: "Invites",
  "audit-log": "Audit Log",
  security: "Security",
};

const NAV_ITEMS: { id: ServerSettingsTab; label: string; icon: typeof Info }[] = [
  { id: "overview", label: "Overview", icon: Info },
  { id: "appearance", label: "Appearance", icon: Paintbrush },
  { id: "roles", label: "Roles", icon: Shield },
  { id: "members", label: "Members", icon: Users },
  { id: "channels", label: "Channels", icon: Hash },
  { id: "invites", label: "Invites", icon: Link2 },
  { id: "audit-log", label: "Audit Log", icon: ScrollText },
  { id: "security", label: "Security", icon: ShieldAlert },
];

function TabContent({ tab, serverId }: { tab: ServerSettingsTab; serverId: string }) {
  switch (tab) {
    case "overview":    return <OverviewTab serverId={serverId} />;
    case "appearance":  return <AppearanceTab serverId={serverId} />;
    case "roles":       return <RolesTab serverId={serverId} />;
    case "members":     return <MembersTab serverId={serverId} />;
    case "channels":    return <ChannelsTab serverId={serverId} />;
    case "invites":     return <InvitesTab serverId={serverId} />;
    case "audit-log":   return <AuditLogTab serverId={serverId} />;
    case "security":    return <SecurityTab serverId={serverId} />;
  }
}

export default function ServerSettingsModal() {
  const {
    serverSettingsOpen: isOpen,
    serverSettingsTab: activeTab,
    activeServerId,
    closeServerSettings,
    setServerSettingsTab: setTab,
  } = useLayoutStore();
  const servers = useServerStore((s) => s.servers);
  const groups = useChatStore((s) => s.groups);
  const overlayRef = useRef<HTMLDivElement>(null);

  const server = servers.find((s) => s.id === activeServerId);
  const isLocalGroup = !server && groups.some((g) => g.id === activeServerId);

  console.log("[ServerSettingsModal] render: isOpen=%s activeServerId=%s server=%s isLocalGroup=%s", isOpen, activeServerId, server?.name ?? "(none)", isLocalGroup);

  // (No automatic fetchServers on open — stale state is handled at logout.
  //  Calling fetchServers here was clearing local group IDs and kicking users
  //  off their server every time settings opened.)

  // Escape key to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeServerSettings();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closeServerSettings]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) closeServerSettings();
  };

  if (!activeServerId) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={overlayRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={handleOverlayClick}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-md"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex overflow-hidden rounded-2xl shadow-2xl shadow-black/60 border border-white/[0.06]"
            style={{
              width: "min(1160px, 96vw)",
              height: "min(800px, 92vh)",
              background: "#0f1117",
            }}
          >
            {/* Sidebar nav */}
            <nav className="flex flex-col h-full w-[250px] shrink-0 bg-[#13161e] border-r border-white/[0.06] py-6 select-none">
              <div className="flex-1 overflow-y-auto px-4 space-y-6">
                {/* Server name header */}
                <div className="px-2 mb-2">
                  <p className="text-xs font-semibold text-white/50 uppercase tracking-wider truncate">
                    {server?.name ?? "Server"}
                  </p>
                </div>

                <div>
                  <p className="px-2 mb-1.5 text-[10px] font-semibold tracking-widest uppercase text-white/30">
                    Server Settings
                  </p>
                  <div className="space-y-0.5">
                    {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
                      const isActive = activeTab === id;
                      return (
                        <button
                          key={id}
                          onClick={() => setTab(id)}
                          className={clsx(
                            "group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                            isActive
                              ? "bg-white/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(99,102,241,0.15)]"
                              : "text-white/40 hover:text-white/70 hover:bg-white/[0.04]"
                          )}
                        >
                          <Icon
                            size={15}
                            className={clsx(
                              "shrink-0 transition-colors",
                              isActive ? "text-dl-accent" : "text-white/30 group-hover:text-white/50"
                            )}
                          />
                          <span className="flex-1 text-left">{label}</span>
                          {isActive && (
                            <div className="w-1 h-1 rounded-full bg-dl-accent opacity-80" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </nav>

            {/* Content panel */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-10 pt-9 pb-5 shrink-0">
                <div>
                  <h1 className="text-base font-semibold text-white/90">
                    {TAB_TITLES[activeTab]}
                  </h1>
                  <div className="h-px w-full mt-3 bg-white/[0.06]" />
                </div>
                <button
                  onClick={closeServerSettings}
                  className="absolute top-5 right-5 w-8 h-8 rounded-full flex items-center justify-center text-white/25 hover:text-white/70 hover:bg-white/[0.06] transition-all"
                  aria-label="Close server settings"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-10 pb-10 overscroll-contain">
                {isLocalGroup ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-white/30">
                    <p className="text-sm font-medium text-white/50">Group Chat</p>
                    <p className="text-xs text-center max-w-xs">This is a local encrypted group. Server settings (roles, channels, members) are only available for network servers created via the IDS backend.</p>
                    <button
                      onClick={closeServerSettings}
                      className="text-xs text-dl-accent/70 hover:text-dl-accent transition-colors mt-2"
                    >
                      Close
                    </button>
                  </div>
                ) : !server ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-white/30">
                    <p className="text-sm">Server not found or no longer accessible.</p>
                    <button
                      onClick={closeServerSettings}
                      className="text-xs text-dl-accent/70 hover:text-dl-accent transition-colors"
                    >
                      Close
                    </button>
                  </div>
                ) : (
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.14, ease: "easeOut" }}
                  >
                    <TabContent tab={activeTab} serverId={activeServerId} />
                  </motion.div>
                </AnimatePresence>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
