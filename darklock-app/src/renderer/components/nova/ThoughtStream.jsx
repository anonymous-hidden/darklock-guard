import React, { useEffect, useRef } from 'react';
import { useNovaStore } from '../../store/novaStore';

function ThoughtBubble({ item }) {
  const typeColors = {
    token: 'text-text-secondary',
    done: 'text-accent',
    proactive: 'text-warning',
    state: 'text-text-muted',
  };

  const typeIcons = {
    token: '💭',
    done: '✅',
    proactive: '💡',
    state: '🔄',
  };

  const time = new Date(item.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="flex gap-2 py-1 px-2 hover:bg-bg-hover rounded text-xs group">
      <span className="shrink-0">{typeIcons[item.type] || '·'}</span>
      <span className={`flex-1 break-words ${typeColors[item.type] || 'text-text-secondary'}`}>
        {item.type === 'done' ? (
          <span className="text-accent font-medium">
            {(item.content || '').slice(0, 200)}{item.content?.length > 200 ? '…' : ''}
          </span>
        ) : (
          item.content || ''
        )}
      </span>
      <span className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {time}
      </span>
    </div>
  );
}

export default function ThoughtStream() {
  const thoughtStream = useNovaStore(s => s.thoughtStream);
  const isThinking = useNovaStore(s => s.isThinking);
  const currentThought = useNovaStore(s => s.currentThought);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thoughtStream.length, currentThought]);

  return (
    <div className="bg-bg-secondary rounded-xl border border-border flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <span>💭</span> Thought Stream
          {isThinking && (
            <span className="inline-flex items-center gap-1 text-xs text-accent">
              <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
              thinking...
            </span>
          )}
        </h3>
        <span className="text-xs text-text-muted">{thoughtStream.length} events</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5 min-h-0">
        {thoughtStream.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">
            <div className="text-center">
              <div className="text-3xl mb-2">🤖</div>
              <div>Nova's thoughts will appear here</div>
              <div className="text-xs mt-1">Send her a message to see her think</div>
            </div>
          </div>
        ) : (
          thoughtStream.map((item, i) => (
            <ThoughtBubble key={i} item={item} />
          ))
        )}

        {/* Live typing indicator */}
        {isThinking && currentThought && (
          <div className="px-2 py-1 text-xs text-accent/80 italic break-words">
            {currentThought.slice(-300)}
            <span className="animate-pulse">▊</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
