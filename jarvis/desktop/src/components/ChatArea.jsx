import React, { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble.jsx';

export default function ChatArea({ messages, streaming, convId }) {
  const endRef = useRef(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!messages.length) {
    return (
      <div className="chat-area">
        <div className="chat-welcome">
          <div className="chat-welcome-icon">◆</div>
          <h2>Nova</h2>
          <p>
            Hey Cayden! I'm your local AI assistant. Type a message below
            or hit the mic to talk. I run entirely on your machine — no cloud, no tracking.
          </p>
        </div>
      </div>
    );
  }

  // Track the last user message for feedback context
  let lastUserMsg = '';

  return (
    <div className="chat-area">
      {messages.map((msg, i) => {
        if (msg.role === 'user') lastUserMsg = msg.content;
        return (
          <MessageBubble
            key={i}
            role={msg.role}
            content={msg.content}
            isStreaming={!!msg._streaming}
            imageUrl={msg.imageUrl}
            proactive={msg.proactive}
            category={msg.category}
            convId={convId}
            userMsg={msg.role === 'assistant' ? lastUserMsg : ''}
          />
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
