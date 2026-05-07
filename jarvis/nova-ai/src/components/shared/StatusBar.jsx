import React from 'react';
import clsx from 'clsx';
import { useAppStore } from '@store/appStore.js';
import { useAiStore } from '@store/aiStore.js';
import { useWidgetStore } from '@store/widgetStore.js';

export default function StatusBar({ onToggleTransparency }) {
  const health = useAppStore((s) => s.ollamaHealth);
  const model = useAppStore((s) => s.selectedModel);
  const status = useAppStore((s) => s.statusMessage);
  const streaming = useAiStore((s) => s.streaming);
  const building = useWidgetStore((s) => s.build.isBuilding);

  const dot =
    health.ok === true ? 'bg-nova-ok' :
    health.ok === false ? 'bg-nova-err' :
    'bg-nova-muted animate-pulse-soft';

  return (
    <footer className="h-8 bg-nova-panel border-t border-nova-border flex items-center justify-between px-3 text-[11.5px] text-nova-muted font-mono">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span className={clsx('w-2 h-2 rounded-full', dot)} />
          <span>Ollama</span>
          {health.ok && health.version && <span className="text-nova-muted/70">v{health.version}</span>}
          {health.error && <span className="text-nova-err">· {health.error}</span>}
        </span>
        <span className="text-nova-muted/60">·</span>
        <span>model: <span className="text-nova-text">{model}</span></span>
        {streaming && <><span className="text-nova-muted/60">·</span><span className="text-nova-accent animate-pulse-soft">streaming</span></>}
        {building &&  <><span className="text-nova-muted/60">·</span><span className="text-nova-accent2 animate-pulse-soft">building widget</span></>}
        {status && <><span className="text-nova-muted/60">·</span><span>{status}</span></>}
      </div>
      <div>
        <button onClick={onToggleTransparency} className="hover:text-nova-text transition-colors">
          transparency log
        </button>
      </div>
    </footer>
  );
}
