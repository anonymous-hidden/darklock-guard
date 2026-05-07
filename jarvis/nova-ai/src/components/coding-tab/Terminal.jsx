import React, { useEffect, useState } from 'react';
import { useAiStore } from '@store/aiStore.js';

/**
 * Terminal — display-only output panel. Mirrors the AI store's transparency
 * log entries that originate from the 'coding' source, plus any system
 * messages broadcast over IPC.
 */
export default function Terminal() {
  const [extra, setExtra] = useState([]);
  const log = useAiStore((s) => s.log);

  useEffect(() => {
    const off = window.nova?.system?.onTerminalLine?.((line) => {
      setExtra((p) => [...p, { ts: Date.now(), text: String(line || '') }].slice(-500));
    });
    return () => { try { off?.(); } catch {} };
  }, []);

  const lines = [
    ...log.filter((e) => e.source === 'coding' || e.source === 'ollama').map((e) => ({
      ts: e.ts, text: `[${e.source}] ${e.text}`, level: e.level,
    })),
    ...extra.map((e) => ({ ts: e.ts, text: e.text, level: 'info' })),
  ].sort((a, b) => a.ts - b.ts).slice(-200);

  return (
    <div className="h-full flex flex-col bg-nova-bg border-t border-nova-border">
      <header className="px-3 py-1.5 border-b border-nova-border flex items-center justify-between">
        <span className="font-display text-xs uppercase tracking-wider text-nova-accent">Terminal</span>
        <span className="text-[10.5px] font-mono text-nova-muted">read-only · {lines.length} lines</span>
      </header>
      <div className="flex-1 overflow-auto p-2 font-mono text-[11.5px] leading-relaxed">
        {lines.length === 0 ? (
          <div className="text-nova-muted">No output.</div>
        ) : lines.map((l, i) => (
          <div key={i} className={
            l.level === 'error' ? 'text-nova-err' :
            l.level === 'warn'  ? 'text-nova-warn' :
            'text-nova-text/80'
          }>
            <span className="text-nova-muted">{new Date(l.ts).toLocaleTimeString([], { hour12: false })} </span>
            {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}
