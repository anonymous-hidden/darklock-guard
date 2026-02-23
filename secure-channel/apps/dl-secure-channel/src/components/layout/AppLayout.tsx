/**
 * AppLayout — Discord-style 4-column layout:
 * [Server Rail] [Channel Sidebar] [Chat Area] [Right Panel]
 */
import { useEffect, useRef } from "react";
import { Outlet } from "react-router-dom";

import { getContacts, getIdsBaseUrl, getRealtimeToken, pollInbox, syncContacts } from "@/lib/tauri";
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
import { useProfileStore } from "@/store/profileStore";
import { useServerStore } from "@/store/serverStore";
import { useAuthStore } from "@/store/authStore";

export default function AppLayout() {
  const { appendMessages, setContacts } = useChatStore();
  const userId = useAuthStore((s) => s.userId);
  const invalidateProfile = useProfileStore((s) => s.invalidateProfile);
  const fetchMentionNotifications = useServerStore((s) => s.fetchMentionNotifications);
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
        console.warn("[secure-channel] global pollInbox ✗", msg);
      }
    };

    const init = async () => {
      // Keep contacts warm before first decrypt pass.
      await syncContacts().catch(console.error);
      await getContacts().then(setContacts).catch(console.error);
      await doPoll();
      pollRef.current = setInterval(doPoll, 4000);
    };

    init();
    return () => clearInterval(pollRef.current);
  }, [appendMessages, setContacts]);

  /* ── Mention notification polling ───────────────────────────── */
  useEffect(() => {
    fetchMentionNotifications(50).catch(() => {});
    const iv = setInterval(() => {
      fetchMentionNotifications(50).catch(() => {});
    }, 12_000);
    return () => clearInterval(iv);
  }, [fetchMentionNotifications]);

  /* ── Global profile update stream (PROFILE_UPDATED) ─────────── */
  useEffect(() => {
    if (!userId) return;
    const ctrl = new AbortController();

    (async () => {
      try {
        const [token, baseUrl] = await Promise.all([getRealtimeToken(), getIdsBaseUrl()]);
        const resp = await fetch(`${baseUrl}/events`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        if (!resp.ok || !resp.body) return;

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = "";
        let currentData = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              currentData = line.slice(6);
            } else if (line === "") {
              if (currentEvent === "PROFILE_UPDATED" && currentData) {
                try {
                  const payload = JSON.parse(currentData) as { user_id?: string };
                  if (payload.user_id) {
                    invalidateProfile(payload.user_id);
                  }
                } catch {}
              }
              currentEvent = "";
              currentData = "";
            }
          }
        }
      } catch {}
    })();

    return () => ctrl.abort();
  }, [userId, invalidateProfile]);

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
