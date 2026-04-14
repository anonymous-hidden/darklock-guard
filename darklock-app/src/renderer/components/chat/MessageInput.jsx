import React, { useState, useRef, useCallback } from 'react';
import { useMessages } from '../../hooks/useMessages';
import { useServerStore } from '../../store/serverStore';

const TTL_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
  { label: '30m', value: 1800 },
  { label: '1h', value: 3600 },
  { label: '24h', value: 86400 },
  { label: '7d', value: 604800 },
];

export default function MessageInput({ channelId, wsSend }) {
  const [text, setText] = useState('');
  const [ttl, setTtl] = useState(0);
  const [showTTL, setShowTTL] = useState(false);
  const inputRef = useRef(null);
  const typingRef = useRef(false);
  const typingTimeoutRef = useRef(null);
  const { sendMessage, startTyping, stopTyping } = useMessages(wsSend);
  const { activeServerId, members } = useServerStore();

  const handleTyping = useCallback(() => {
    if (!typingRef.current) {
      typingRef.current = true;
      startTyping(channelId);
    }
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      typingRef.current = false;
      stopTyping(channelId);
    }, 3000);
  }, [channelId, startTyping, stopTyping]);

  const handleSend = async () => {
    const content = text.trim();
    if (!content) return;

    // Handle slash commands
    if (content.startsWith('/')) {
      handleSlashCommand(content);
      setText('');
      return;
    }

    // Get all member public keys for encryption
    const serverMembersList = members[activeServerId] || [];
    const recipientKeys = serverMembersList
      .filter(m => m.public_key)
      .map(m => m.public_key);

    await sendMessage(channelId, content, recipientKeys, ttl);
    setText('');

    if (typingRef.current) {
      typingRef.current = false;
      stopTyping(channelId);
    }
  };

  const handleSlashCommand = (cmd) => {
    const [command, ...args] = cmd.slice(1).split(' ');
    switch (command) {
      case 'ttl': {
        const val = args[0];
        const opt = TTL_OPTIONS.find(o => o.label.toLowerCase() === val?.toLowerCase());
        if (opt) setTtl(opt.value);
        break;
      }
      case 'clear':
        // Clear local messages handled by store
        break;
      default:
        break;
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="px-4 pb-6 shrink-0">
      {/* E2EE indicator */}
      <div className="flex items-center gap-1 mb-1">
        <svg className="w-3 h-3 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
        <span className="text-[11px] text-success">End-to-end encrypted</span>
        {ttl > 0 && (
          <span className="text-[11px] text-warning ml-2">
            🔥 TTL: {TTL_OPTIONS.find(o => o.value === ttl)?.label}
          </span>
        )}
      </div>

      <div className="bg-[#383a40] rounded-lg flex items-end">
        {/* Attach button */}
        <button className="w-11 h-11 flex items-center justify-center text-text-muted hover:text-text-primary shrink-0">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>

        {/* Text input */}
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => { setText(e.target.value); handleTyping(); }}
          onKeyDown={handleKeyDown}
          placeholder={`Message #channel`}
          className="flex-1 bg-transparent text-text-primary text-sm py-3 outline-none resize-none max-h-[200px] placeholder-text-muted"
          rows={1}
          style={{ height: 'auto', minHeight: '24px' }}
          onInput={(e) => {
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
          }}
        />

        {/* Right side buttons */}
        <div className="flex items-center gap-1 px-2 pb-2">
          {/* TTL toggle */}
          <div className="relative">
            <button
              onClick={() => setShowTTL(!showTTL)}
              className={`w-8 h-8 flex items-center justify-center rounded hover:bg-bg-hover ${ttl > 0 ? 'text-warning' : 'text-text-muted hover:text-text-primary'}`}
              title="Self-destruct timer"
            >
              🔥
            </button>
            {showTTL && (
              <div className="absolute bottom-10 right-0 bg-[#111214] rounded-lg shadow-xl p-2 z-50 min-w-[120px]">
                {TTL_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setTtl(opt.value); setShowTTL(false); }}
                    className={`w-full text-left px-3 py-1.5 text-sm rounded hover:bg-bg-hover ${ttl === opt.value ? 'text-accent' : 'text-text-secondary'}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Emoji */}
          <button className="w-8 h-8 flex items-center justify-center rounded hover:bg-bg-hover text-text-muted hover:text-text-primary">
            😊
          </button>

          {/* Send */}
          {text.trim() && (
            <button
              onClick={handleSend}
              className="w-8 h-8 flex items-center justify-center rounded bg-accent hover:bg-accent-hover text-white"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
