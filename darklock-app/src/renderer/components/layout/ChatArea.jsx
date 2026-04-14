import React, { useState } from 'react';
import MessageList from '../chat/MessageList';
import MessageInput from '../chat/MessageInput';
import TypingIndicator from '../chat/TypingIndicator';
import { useServerStore } from '../../store/serverStore';
import { useUIStore } from '../../store/uiStore';

export default function ChatArea({ wsSend, connectionState }) {
  const { activeChannelId, channels, activeServerId } = useServerStore();
  const { toggleMembers, showMembers } = useUIStore();
  const [searchQuery, setSearchQuery] = useState('');

  const serverChannels = channels[activeServerId] || [];
  const activeChannel = serverChannels.find(c => c.id === activeChannelId);

  const connectionColor = {
    connected: 'bg-success',
    connecting: 'bg-warning',
    reconnecting: 'bg-warning',
    disconnected: 'bg-danger'
  }[connectionState] || 'bg-danger';

  if (!activeChannelId) {
    return (
      <div className="flex-1 bg-[#313338] flex items-center justify-center">
        <div className="text-center">
          <div className="w-24 h-24 bg-bg-hover rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-text-primary mb-1">No channel selected</h2>
          <p className="text-text-muted text-sm">Select a channel to start chatting</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[#313338] flex flex-col min-w-0">
      {/* Top bar */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-[#1f2023] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-text-muted text-lg">#</span>
          <span className="font-semibold text-text-primary">{activeChannel?.name || 'Channel'}</span>
          <div className={`w-2 h-2 ${connectionColor} rounded-full`} title={`Connection: ${connectionState}`} />
          <svg className="w-4 h-4 text-success ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          <span className="text-xs text-success">E2EE</span>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-[#1e1f22] text-text-primary text-sm rounded px-2 py-1 w-36 outline-none focus:w-52 transition-all placeholder-text-muted"
          />
          <button
            onClick={toggleMembers}
            className={`w-8 h-8 flex items-center justify-center rounded hover:bg-bg-hover ${showMembers ? 'text-text-primary' : 'text-text-muted'}`}
            title="Toggle Members"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <MessageList channelId={activeChannelId} />

      {/* Typing indicator */}
      <TypingIndicator channelId={activeChannelId} />

      {/* Input */}
      <MessageInput channelId={activeChannelId} wsSend={wsSend} />
    </div>
  );
}
