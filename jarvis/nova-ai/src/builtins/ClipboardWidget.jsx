import React, { useState, useEffect, useCallback, useRef } from 'react';

const MAX_ITEMS  = 50;
const PREVIEW_LEN = 120;

function trunc(str, len = PREVIEW_LEN) {
  return str.length > len ? str.slice(0, len) + '…' : str;
}

export default function ClipboardWidget() {
  const publish = (action, summary) => {
    try { window.nova?.bus?.publish?.('widget:event', { widget: 'clipboard', action, summary }); } catch {}
  };

  const [history,  setHistory]  = useState([]);
  const [query,    setQuery]    = useState('');
  const [copied,   setCopied]   = useState(null);   // id of last copied item
  const idSeq  = useRef(0);
  const lastRef = useRef('');

  /* Poll clipboard every 1.5 s for new entries */
  useEffect(() => {
    const poll = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text !== lastRef.current) {
          lastRef.current = text;
          setHistory(prev => {
            // deduplicate
            const filtered = prev.filter(i => i.text !== text);
            const entry = { id: ++idSeq.current, text, ts: Date.now() };
            return [entry, ...filtered].slice(0, MAX_ITEMS);
          });
        }
      } catch {
        /* clipboard API blocked; rely on nova IPC bridge */
      }
    };

    // Also subscribe via Jarvis IPC if available
    const unsub = window.nova?.clipboard?.onCopy?.((text) => {
      if (!text || text === lastRef.current) return;
      lastRef.current = text;
      setHistory(prev => {
        const filtered = prev.filter(i => i.text !== text);
        const entry = { id: ++idSeq.current, text, ts: Date.now() };
        return [entry, ...filtered].slice(0, MAX_ITEMS);
      });
    });

    const t = setInterval(poll, 1500);
    return () => {
      clearInterval(t);
      unsub?.();
    };
  }, []);

  const copyItem = useCallback(async (item) => {
    try {
      await navigator.clipboard.writeText(item.text);
      lastRef.current = item.text;
      setCopied(item.id);
      setTimeout(() => setCopied(c => c === item.id ? null : c), 1800);
      // move to top
      setHistory(prev => [item, ...prev.filter(i => i.id !== item.id)]);
      publish('copy', trunc(item.text, 60));
    } catch (e) {
      console.error('[clipboard] write failed:', e);
    }
  }, []);

  const remove = (id) => {
    setHistory(prev => prev.filter(i => i.id !== id));
  };

  const clearAll = () => {
    setHistory([]);
    lastRef.current = '';
    publish('clear', 'cleared all');
  };

  const filtered = query.trim()
    ? history.filter(i => i.text.toLowerCase().includes(query.toLowerCase()))
    : history;

  return (
    <div className="flex flex-col gap-3 h-full p-3 text-nova-text text-sm font-nova">
      <header className="flex items-center gap-2 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-widest text-nova-accent">
          ⎘ Clipboard
        </span>
        <span className="ml-auto text-[10px] text-nova-muted">{history.length}/{MAX_ITEMS}</span>
        {history.length > 0 && (
          <button
            onClick={clearAll}
            className="text-[10px] text-nova-muted hover:text-nova-err transition-colors"
          >
            Clear all
          </button>
        )}
      </header>

      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search clipboard…"
        className="shrink-0 rounded-lg border border-nova-border bg-nova-panel/60 px-3 py-1.5 text-sm placeholder-nova-muted/50 outline-none focus:border-nova-accent/60 transition-colors"
      />

      <div className="flex-1 overflow-y-auto flex flex-col gap-1.5">
        {filtered.length === 0 && (
          <p className="text-nova-muted text-xs text-center mt-6">
            {history.length === 0 ? 'Nothing copied yet' : 'No matches'}
          </p>
        )}
        {filtered.map((item) => (
          <div
            key={item.id}
            className={`
              group flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-all
              ${copied === item.id
                ? 'border-nova-ok/50 bg-nova-ok/10'
                : 'border-nova-border bg-nova-panel/40 hover:bg-nova-panel hover:border-nova-accent/30'}
            `}
            onClick={() => copyItem(item)}
          >
            <span className="flex-1 text-xs leading-snug break-all whitespace-pre-wrap line-clamp-3">
              {trunc(item.text)}
            </span>
            <div className="flex flex-col items-end gap-1 shrink-0">
              {copied === item.id
                ? <span className="text-[10px] text-nova-ok">✓ copied</span>
                : <span className="text-[10px] text-nova-muted opacity-0 group-hover:opacity-100 transition-opacity">click to copy</span>
              }
              <button
                onClick={e => { e.stopPropagation(); remove(item.id); }}
                className="text-[10px] text-nova-muted hover:text-nova-err transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
