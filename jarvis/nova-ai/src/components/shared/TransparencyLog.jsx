import React from 'react';
import clsx from 'clsx';
import { useAiStore } from '@store/aiStore.js';

const LEVEL_STYLES = {
  info:  'text-nova-muted',
  warn:  'text-nova-warn',
  error: 'text-nova-err',
  token: 'text-nova-accent2',
};

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false });
}

export default function TransparencyLog({ open, onClose }) {
  const log = useAiStore((s) => s.log);
  const clearLog = useAiStore((s) => s.clearLog);

  return (
    <aside
      className={clsx(
        'fixed top-0 right-0 h-full w-[380px] bg-nova-panel border-l border-nova-border z-30 flex flex-col transition-transform',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-nova-border">
        <div className="font-display text-sm uppercase tracking-wider text-nova-accent">Transparency</div>
        <div className="flex items-center gap-2">
          <button onClick={clearLog} className="nova-btn">Clear</button>
          <button onClick={onClose}  className="nova-btn">Close</button>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-3 space-y-1 font-mono text-[11.5px] leading-relaxed">
        {log.length === 0 ? (
          <div className="text-nova-muted text-center pt-12">No log entries yet.</div>
        ) : log.map((e) => (
          <div key={e.id} className={clsx('flex gap-2', LEVEL_STYLES[e.level] || 'text-nova-muted')}>
            <span className="text-nova-muted shrink-0">{fmtTime(e.ts)}</span>
            <span className="text-nova-muted shrink-0 w-14 truncate">[{e.source}]</span>
            <span className="break-words whitespace-pre-wrap">{e.text}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
