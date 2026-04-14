import React from 'react';
import { useServerStore } from '../../store/serverStore';
import { useUIStore } from '../../store/uiStore';
import StatusBar from './StatusBar';

export default function ChannelSidebar({ wsSend }) {
  const { activeServerId, channels, activeChannelId, setActiveChannel, servers } = useServerStore();
  const toggleServerSettings = useUIStore(s => s.toggleServerSettings);

  const serverChannels = channels[activeServerId] || [];
  const activeServer = servers.find(s => s.id === activeServerId);

  const handleSelectChannel = (channelId) => {
    if (activeChannelId) {
      wsSend({ type: 'LEAVE_CHANNEL', channelId: activeChannelId });
    }
    setActiveChannel(channelId);
    wsSend({ type: 'JOIN_CHANNEL', channelId });
  };

  return (
    <div className="w-60 bg-[#2b2d31] flex flex-col shrink-0">
      {/* Server name header */}
      <button
        onClick={toggleServerSettings}
        className="h-12 px-4 flex items-center justify-between border-b border-[#1f2023] hover:bg-bg-hover transition-colors shrink-0"
      >
        <span className="font-semibold text-text-primary truncate">
          {activeServer?.name || 'DarkLock'}
        </span>
        <svg className="w-4 h-4 text-text-muted shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
        </svg>
      </button>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-2">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">
              Text Channels
            </span>
            <button className="text-text-muted hover:text-text-primary">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {serverChannels.filter(c => c.type === 'text').map(channel => (
            <button
              key={channel.id}
              onClick={() => handleSelectChannel(channel.id)}
              className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-sm transition-colors ${
                activeChannelId === channel.id
                  ? 'bg-[#404249] text-white'
                  : 'text-text-secondary hover:bg-[#35373c] hover:text-text-primary'
              }`}
            >
              <span className="text-text-muted text-lg leading-none">#</span>
              <span className="truncate">{channel.name}</span>
            </button>
          ))}
        </div>

        {serverChannels.some(c => c.type === 'voice') && (
          <div className="mb-2">
            <div className="flex items-center justify-between px-1 mb-1">
              <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">
                Voice Channels
              </span>
            </div>
            {serverChannels.filter(c => c.type === 'voice').map(channel => (
              <button
                key={channel.id}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-sm text-text-secondary hover:bg-[#35373c] hover:text-text-primary transition-colors"
              >
                <span className="text-text-muted">🔊</span>
                <span className="truncate">{channel.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* User status bar at bottom */}
      <StatusBar />
    </div>
  );
}
