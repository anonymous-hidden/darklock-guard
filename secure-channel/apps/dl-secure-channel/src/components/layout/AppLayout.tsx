/**
 * AppLayout — Discord-style 4-column layout:
 * [Server Rail] [Channel Sidebar] [Chat Area] [Right Panel]
 */
import { useEffect, useRef } from "react";
import { Outlet } from "react-router-dom";

import { getContacts, pollInbox, syncContacts } from "@/lib/tauri";
import { useChatStore } from "@/store/chatStore";
import { startPresenceHeartbeat, stopPresenceHeartbeat } from "@/store/presenceStore";
import { initializeAllCommands } from "@/commands";
import ServerSidebar from "./ServerSidebar";
import ChannelSidebar from "./ChannelSidebar";
import RightPanel from "./RightPanel";
import SettingsModal from "@/components/settings/SettingsModal";
import ServerSettingsModal from "@/components/server-settings/ServerSettingsModal";
import PinPanel from "@/components/PinPanel";
import InviteDialog from "@/components/InviteDialog";

export default function AppLayout() {
  const { appendMessages, setContacts } = useChatStore();
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  /* ── Slash commands ─────────────────────────────────── */
  useEffect(() => {
    initializeAllCommands();
  }, []);

  /* ── Presence heartbeat ─────────────────────────────── */
  useEffect(() => {
    startPresenceHeartbeat();
    return () => stopPresenceHeartbeat();
  }, []);

  /* ── Inbox polling + contacts ──────────────────────── */
  useEffect(() => {
    const doPoll = async () => {
      try {
        const msgs = await pollInbox();
        if (msgs.length > 0) {
          appendMessages(msgs);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[DM_INBOX_POLL_FAILED]');
      }
    };

    const init = async () => {
      // Keep contacts warm before first decrypt pass.
      await syncContacts().catch(() => console.error('[RIDGELINE_ASYNC_OPERATION_FAILED]'));
      await getContacts().then(setContacts).catch(() => console.error('[RIDGELINE_ASYNC_OPERATION_FAILED]'));
      await doPoll();
      pollRef.current = setInterval(doPoll, 4000);
    };

    init();
    return () => clearInterval(pollRef.current);
  }, [appendMessages, setContacts]);

  return (
    <div className="app-layout">
      {/* Global overlays */}
      <SettingsModal />
      <ServerSettingsModal />
      <InviteDialog />
      <PinPanel />

      {/* 1. Server icon rail (far left) */}
      <ServerSidebar />

      {/* 2. Channel / DM sidebar */}
      <ChannelSidebar />

      {/* 3. Main chat area */}
      <main className="app-layout__main">
        <Outlet />
      </main>

      {/* 4. Right panel (collapsible) */}
      <RightPanel />
    </div>
  );
}
