import React from 'react';
import clsx from 'clsx';

/**
 * Tiny markdown renderer (no deps). Handles fenced code, inline code,
 * bold, italic, links, and line breaks. Good enough for chat bubbles.
 */
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function md(text) {
  if (!text) return '';
  return esc(text)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre class="bg-nova-bg border border-nova-border rounded-md p-3 my-2 overflow-x-auto"><code class="text-[12.5px] block">${code}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code class="bg-nova-bg px-1.5 py-0.5 rounded text-nova-accent text-[12.5px]">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a class="text-nova-accent underline" href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br/>');
}

export default function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <div className={clsx('flex w-full animate-slide-up', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'max-w-[78%] rounded-xl px-4 py-2.5 text-sm leading-relaxed',
          isUser  && 'bg-nova-accent/15 border border-nova-accent/30 text-nova-text',
          !isUser && !isSystem && 'bg-nova-panel border border-nova-border text-nova-text',
          isSystem && 'bg-nova-err/10 border border-nova-err/30 text-nova-err',
        )}
      >
        <div dangerouslySetInnerHTML={{ __html: md(message.content || '') }} />
        {message.error && (
          <div className="mt-2 text-[11px] text-nova-err font-mono">error: {message.error}</div>
        )}
        {message.model && (
          <div className="mt-1 text-[10.5px] text-nova-muted/80 font-mono">
            {message.model}{message.evalCount ? ` · ${message.evalCount} tok` : ''}
            {message.durationMs ? ` · ${(message.durationMs / 1000).toFixed(1)}s` : ''}
          </div>
        )}
      </div>
    </div>
  );
}
