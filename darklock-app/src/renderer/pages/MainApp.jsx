import React, { useEffect, useCallback } from 'react';
import ServerSidebar from '../components/layout/ServerSidebar';
import ChannelSidebar from '../components/layout/ChannelSidebar';
import ChatArea from '../components/layout/ChatArea';
import MembersList from '../components/layout/MembersList';
import StatusBar from '../components/layout/StatusBar';
import UserSettingsModal from '../components/modals/UserSettingsModal';
import CreateServerModal from '../components/modals/CreateServerModal';
import InviteModal from '../components/modals/InviteModal';
import ServerSettingsModal from '../components/modals/ServerSettingsModal';
import TwoFactorModal from '../components/modals/TwoFactorModal';
import NovaCommandCenter from './NovaCommandCenter';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePresence } from '../hooks/usePresence';
import { useAuthStore } from '../store/authStore';
import { useServerStore } from '../store/serverStore';
import { useUIStore } from '../store/uiStore';
import { config } from '../config';

export default function MainApp() {
  const { connectionState, send } = useWebSocket();
  const { getStatus } = usePresence(send);
  const auth = useAuthStore();
  const { servers, activeServerId, setServers, setActiveServer, setChannels, setActiveChannel, setMembers } = useServerStore();
  const { showSettings, showCreateServer, showInvite, showServerSettings, showTwoFactor, showMembers, showNovaCommandCenter, toggleNovaCommandCenter, closeAll } = useUIStore();

  // Load servers on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${config.apiUrl}/api/servers`, {
          headers: { 'Authorization': `Bearer ${auth.accessToken}` }
        });
        if (res.ok) {
          const data = await res.json();
          setServers(data);
          if (data.length > 0 && !activeServerId) {
            selectServer(data[0].id);
          }
        }
      } catch { /* offline */ }
    })();
  }, [auth.accessToken]);

  const selectServer = useCallback(async (serverId) => {
    setActiveServer(serverId);
    try {
      const [channelsRes, membersRes] = await Promise.all([
        fetch(`${config.apiUrl}/api/servers/${serverId}/channels`, {
          headers: { 'Authorization': `Bearer ${auth.accessToken}` }
        }),
        fetch(`${config.apiUrl}/api/servers/${serverId}/members`, {
          headers: { 'Authorization': `Bearer ${auth.accessToken}` }
        })
      ]);
      if (channelsRes.ok) {
        const channels = await channelsRes.json();
        setChannels(serverId, channels);
        if (channels.length > 0) {
          setActiveChannel(channels[0].id);
          send({ type: 'JOIN_CHANNEL', channelId: channels[0].id });
        }
      }
      if (membersRes.ok) {
        setMembers(serverId, await membersRes.json());
      }
    } catch { /* offline */ }
  }, [auth.accessToken, send, setActiveServer, setChannels, setActiveChannel, setMembers]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        useUIStore.getState().toggleSettings();
      }
      if (e.key === 'Escape') {
        closeAll();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [closeAll]);

  return (
    <div className="h-screen flex flex-col bg-bg-tertiary">
      {/* Titlebar */}
      <div className="titlebar-drag h-8 flex items-center justify-between bg-bg-primary shrink-0">
        <div className="pl-3 text-xs text-text-muted font-medium">DarkLock</div>
        <div className="flex">
          <button onClick={() => window.darklock.window.minimize()} className="w-12 h-8 flex items-center justify-center hover:bg-bg-hover text-text-muted">
            <svg width="10" height="10" viewBox="0 0 12 12"><rect y="5" width="12" height="2" fill="currentColor"/></svg>
          </button>
          <button onClick={() => window.darklock.window.maximize()} className="w-12 h-8 flex items-center justify-center hover:bg-bg-hover text-text-muted">
            <svg width="10" height="10" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
          </button>
          <button onClick={() => window.darklock.window.close()} className="w-12 h-8 flex items-center justify-center hover:bg-danger text-text-muted hover:text-white">
            <svg width="10" height="10" viewBox="0 0 12 12"><line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5"/><line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1.5"/></svg>
          </button>
        </div>
      </div>

      {/* Main content — 4 columns or Nova Command Center */}
      <div className="flex-1 flex overflow-hidden">
        <ServerSidebar servers={servers} activeServerId={activeServerId} onSelectServer={selectServer} />
        {showNovaCommandCenter ? (
          <div className="flex-1 overflow-hidden">
            <NovaCommandCenter onBack={toggleNovaCommandCenter} />
          </div>
        ) : (
          <>
            <ChannelSidebar wsSend={send} />
            <ChatArea wsSend={send} connectionState={connectionState} />
            {showMembers && <MembersList getStatus={getStatus} />}
          </>
        )}
      </div>

      {/* Modals */}
      {showSettings && <UserSettingsModal />}
      {showCreateServer && <CreateServerModal />}
      {showServerSettings && <ServerSettingsModal />}
      {showInvite && <InviteModal />}
      {showTwoFactor && <TwoFactorModal />}
    </div>
  );
}
