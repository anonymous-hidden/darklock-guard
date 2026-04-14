import React from 'react';
import { useMessageStore } from '../../store/messageStore';

export default function TypingIndicator({ channelId }) {
  const typingUsers = useMessageStore(s => {
    const users = s.typingUsers[channelId];
    return users ? Array.from(users) : [];
  });

  if (typingUsers.length === 0) return null;

  const text = typingUsers.length === 1
    ? `${typingUsers[0].slice(0, 8)} is typing`
    : typingUsers.length === 2
    ? `${typingUsers[0].slice(0, 8)} and ${typingUsers[1].slice(0, 8)} are typing`
    : `Several people are typing`;

  return (
    <div className="px-4 py-1 shrink-0">
      <div className="flex items-center gap-2 text-text-muted text-xs">
        <div className="flex gap-0.5">
          <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
        <span>{text}...</span>
      </div>
    </div>
  );
}
