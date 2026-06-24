import React, { useMemo, useState } from 'react';
import clsx from 'clsx';

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderInline(text) {
  let t = esc(text);
  t = t.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
    '<img src="$2" alt="$1" class="max-h-56 max-w-full rounded-md border border-nova-border my-2" />');
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a class="text-nova-accent underline hover:text-nova-accent2" href="$2" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/`([^`]+)`/g, '<code class="bg-nova-bg border border-nova-border/70 px-1.5 py-0.5 rounded text-nova-accent text-[12px]">$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-nova-text">$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return t;
}

function renderMarkdown(src) {
  const lines = String(src || '').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre class="bg-nova-bg border border-nova-border rounded-md p-3 my-2 overflow-x-auto"><code class="text-[12.5px] block">${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s\-:|]+\|\s*$/.test(lines[i + 1])) {
      const head = line.split('|').slice(1, -1).map((c) => c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) rows.push(lines[i++].split('|').slice(1, -1).map((c) => c.trim()));
      out.push(`<div class="overflow-x-auto my-2"><table class="border-collapse text-[12px]"><thead><tr>${head.map((c) => `<th class="border border-nova-border bg-nova-panel2 px-2 py-1 text-left">${renderInline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td class="border border-nova-border/70 px-2 py-1">${renderInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      const cls = h[1].length === 1 ? 'text-base font-display mt-2' : h[1].length === 2 ? 'text-sm font-display text-nova-accent mt-2' : 'text-[12.5px] font-display text-nova-accent2 mt-1.5';
      out.push(`<div class="${cls}">${renderInline(h[2])}</div>`);
      i++;
      continue;
    }

    if (/^>\s/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote class="border-l-2 border-nova-accent2/60 pl-3 my-2 text-nova-text/85">${renderInline(buf.join(' '))}</blockquote>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(`<li>${renderInline(lines[i++].replace(/^\s*[-*]\s+/, ''))}</li>`);
      out.push(`<ul class="list-disc pl-5 space-y-1 my-2">${items.join('')}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) items.push(`<li>${renderInline(lines[i++].replace(/^\s*\d+\.\s+/, ''))}</li>`);
      out.push(`<ol class="list-decimal pl-5 space-y-1 my-2">${items.join('')}</ol>`);
      continue;
    }

    if (!line.trim()) {
      out.push('<div class="h-1"></div>');
      i++;
      continue;
    }

    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,3}\s|>\s|\s*[-*]\s|\s*\d+\.\s|\s*\|.+\|\s*$)/.test(lines[i])) {
      buf.push(lines[i++]);
    }
    out.push(`<p class="my-1">${renderInline(buf.join(' '))}</p>`);
  }
  return out.join('');
}

function splitThinking(content, streaming = false) {
  const text = String(content || '');
  const open = text.indexOf('<thinking>');
  if (open === -1) return { thinking: '', body: text, streamingThinking: false };
  const close = text.indexOf('</thinking>', open);
  if (close === -1) {
    return {
      thinking: text.slice(open + 10).trim(),
      body: text.slice(0, open).trim(),
      streamingThinking: streaming,
    };
  }
  return {
    thinking: text.slice(open + 10, close).trim(),
    body: (text.slice(0, open) + text.slice(close + 12)).trim(),
    streamingThinking: false,
  };
}

function extractLinks(text) {
  const links = [];
  const seen = new Set();
  const rx = /https?:\/\/[^\s)\]]+/g;
  let m;
  while ((m = rx.exec(text || '')) && links.length < 4) {
    const url = m[0].replace(/[.,;:]+$/, '');
    if (!seen.has(url)) {
      seen.add(url);
      links.push(url);
    }
  }
  return links;
}

function ThinkingPanel({ text, streaming }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="mb-2 rounded-md border border-nova-accent2/30 bg-nova-accent2/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider text-nova-accent2 hover:bg-nova-accent2/10"
      >
        <span className={clsx('transition-transform', open && 'rotate-90')}>▸</span>
        <span>{streaming ? 'thinking' : 'thought process'}</span>
        {streaming && <span className="nova-typing-dots"><i /><i /><i /></span>}
      </button>
      {open && (
        <div className="border-t border-nova-accent2/20 px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-nova-text/80">
          {text}
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 text-nova-muted">
      <span>Jarvis is typing</span>
      <span className="nova-typing-dots"><i /><i /><i /></span>
    </span>
  );
}

export default function MessageBubble({ message }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const streaming = !!message._streaming;
  const split = !isUser && !isSystem && !message.error
    ? splitThinking(message.content || '', streaming)
    : { thinking: '', body: message.content || '', streamingThinking: false };
  const body = split.body || '';
  const links = useMemo(() => extractLinks(body), [body]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body || message.content || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  return (
    <div className={clsx('group flex w-full animate-slide-up', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'max-w-[82%] rounded-xl px-4 py-3 text-sm leading-relaxed shadow-sm',
          isUser  && 'bg-nova-accent/15 border border-nova-accent/30 text-nova-text',
          !isUser && !isSystem && 'bg-nova-panel/95 border border-nova-border text-nova-text',
          isSystem && 'bg-nova-err/10 border border-nova-err/30 text-nova-err',
        )}
      >
        {!isUser && !isSystem && (
          <div className="mb-2 flex items-center justify-between gap-3 border-b border-nova-border/50 pb-1.5">
            <div className="text-[10.5px] uppercase tracking-wider text-nova-accent2 font-mono">Jarvis</div>
            <button onClick={copy} className="opacity-0 group-hover:opacity-100 transition-opacity text-[10.5px] text-nova-muted hover:text-nova-accent">
              {copied ? 'copied' : 'copy'}
            </button>
          </div>
        )}

        <ThinkingPanel text={split.thinking} streaming={split.streamingThinking} />

        {body ? (
          <div className="prose-nova" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
        ) : streaming ? (
          <TypingIndicator />
        ) : null}

        {streaming && body && <span className="nova-stream-cursor" />}

        {links.length > 0 && !isUser && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {links.map((url, idx) => (
              <button
                key={url}
                onClick={() => window.nova?.control?.openPath?.(url) || window.open(url, '_blank')}
                className="rounded border border-nova-border bg-nova-bg/70 px-2 py-1 text-[10.5px] text-nova-muted hover:border-nova-accent/50 hover:text-nova-accent"
              >
                open source {idx + 1}
              </button>
            ))}
          </div>
        )}

        {message.error && (
          <div className="mt-2 text-[11px] text-nova-err font-mono">error: {message.error}</div>
        )}
        {message.model && (
          <div className="mt-2 text-[10.5px] text-nova-muted/80 font-mono border-t border-nova-border/40 pt-1.5">
            {message.model}{message.evalCount ? ` · ${message.evalCount} tok` : ''}
            {message.durationMs ? ` · ${(message.durationMs / 1000).toFixed(1)}s` : ''}
          </div>
        )}
      </div>
    </div>
  );
}
