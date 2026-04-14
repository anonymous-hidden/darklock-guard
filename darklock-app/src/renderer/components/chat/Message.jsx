import React, { useState, useEffect } from 'react';

function formatTime(timestamp) {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(timestamp) {
  const d = new Date(timestamp);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `Today at ${formatTime(timestamp)}`;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${formatTime(timestamp)}`;
  return d.toLocaleDateString([], { month: '2-digit', day: '2-digit', year: 'numeric' }) + ' ' + formatTime(timestamp);
}

function TTLBadge({ ttl, timestamp }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!ttl || ttl <= 0) return;
    const expiresAt = timestamp + ttl * 1000;
    const update = () => {
      const left = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setRemaining(left);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [ttl, timestamp]);

  if (!ttl || ttl <= 0) return null;

  const formatRemaining = (s) => {
    if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${s}s`;
  };

  return (
    <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${remaining <= 10 ? 'bg-danger/20 text-danger' : 'bg-warning/20 text-warning'}`}>
      🔥 {formatRemaining(remaining)}
    </span>
  );
}

export default function Message({ message }) {
  const [showActions, setShowActions] = useState(false);

  if (message.destroyed) {
    return (
      <div className="py-0.5 px-4 animate-pulse">
        <span className="text-text-muted text-sm italic">💥 [message destroyed]</span>
      </div>
    );
  }

  // System messages
  if (message.type === 'system') {
    return (
      <div className="py-1 text-center">
        <span className="text-text-muted text-xs italic">{message.content}</span>
      </div>
    );
  }

  const senderName = message.isOwn ? 'You' : (message.senderPublicKey?.slice(0, 8) || 'Unknown');

  if (message.isGrouped) {
    return (
      <div
        className="pl-[72px] py-0.5 hover:bg-[#2e3035] rounded group relative"
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        <span className="text-text-muted text-[11px] opacity-0 group-hover:opacity-100 absolute left-4 top-1">
          {formatTime(message.timestamp)}
        </span>
        <p className="text-text-primary text-sm leading-relaxed break-words">
          {message.content || <span className="text-text-muted italic">Decrypting...</span>}
        </p>
        {message.ttl > 0 && <TTLBadge ttl={message.ttl} timestamp={message.timestamp} />}
        {showActions && <MessageActions messageId={message.id} />}
      </div>
    );
  }

  return (
    <div
      className="flex gap-4 mt-4 first:mt-0 py-0.5 px-4 hover:bg-[#2e3035] rounded group relative"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Avatar */}
      <div className="shrink-0 mt-0.5">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-white ${message.isOwn ? 'bg-accent' : 'bg-[#5865f2]/60'}`}>
          {senderName.charAt(0).toUpperCase()}
        </div>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`text-sm font-medium ${message.isOwn ? 'text-accent' : 'text-[#f2f3f5]'}`}>
            {senderName}
          </span>
          <span className="text-[11px] text-text-muted">{formatDate(message.timestamp)}</span>
        </div>
        <p className="text-text-primary text-sm leading-relaxed break-words">
          {message.content || <span className="text-text-muted italic">Decrypting...</span>}
        </p>
        {message.ttl > 0 && <TTLBadge ttl={message.ttl} timestamp={message.timestamp} />}
      </div>

      {showActions && <MessageActions messageId={message.id} />}
    </div>
  );
}

function MessageActions() {
  return (
    <div className="absolute -top-3 right-4 bg-[#2b2d31] border border-[#1e1f22] rounded-md flex shadow-lg">
      <button className="w-8 h-8 flex items-center justify-center hover:bg-bg-hover rounded-l text-text-muted hover:text-text-primary text-sm" title="React">
        😀
      </button>
      <button className="w-8 h-8 flex items-center justify-center hover:bg-bg-hover text-text-muted hover:text-text-primary" title="Reply">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
        </svg>
      </button>
      <button className="w-8 h-8 flex items-center justify-center hover:bg-bg-hover rounded-r text-text-muted hover:text-text-primary" title="More">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
        </svg>
      </button>
    </div>
  );
}
