import React, { useEffect, useRef } from 'react';
import Message from './Message';
import { useMessageStore } from '../../store/messageStore';

export default function MessageList({ channelId }) {
  const messages = useMessageStore(s => s.messages[channelId] || []);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto flex items-end justify-center pb-4">
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">#</div>
          <h3 className="text-xl font-bold text-text-primary mb-1">Welcome to the channel!</h3>
          <p className="text-text-muted text-sm">This is the start of the conversation. All messages are end-to-end encrypted.</p>
        </div>
      </div>
    );
  }

  // Group consecutive messages from the same sender
  const grouped = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prev = i > 0 ? messages[i - 1] : null;
    const isGrouped = prev
      && prev.senderPublicKey === msg.senderPublicKey
      && !prev.destroyed
      && (msg.timestamp - prev.timestamp) < 5 * 60 * 1000; // 5 min grouping window
    grouped.push({ ...msg, isGrouped });
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-2">
      {grouped.map(msg => (
        <Message key={msg.id} message={msg} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
