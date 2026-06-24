import React, { useEffect, useState } from 'react';
import CommandCard from './CommandCard.jsx';
import WidgetGallery from './WidgetGallery.jsx';
import BuiltinDock from './BuiltinDock.jsx';
import { useAppStore } from '@store/appStore.js';
import { useAiStore } from '@store/aiStore.js';
import { useBuiltinStore } from '@store/builtinStore.js';

const QUICK_ACTIONS = [
  { id: 'new-chat',        title: 'New chat',         description: 'Reset conversation, jump to Chat.', icon: '✦', accent: 'accent',  goto: 'chat',          onAct: 'reset' },
  { id: 'build-widget',    title: 'Build a widget',   description: 'Open the Widget Studio.',           icon: '◆', accent: 'accent2', goto: 'widget-studio' },
  { id: 'open-coding',     title: 'Coding workspace', description: 'Monaco editor + AI assistant.',     icon: '⌘', accent: 'ok',       goto: 'coding' },
  { id: 'transparency',    title: 'Transparency log', description: 'Watch what Jarvis is doing.',       icon: '◉', accent: 'accent',   onAct: 'transparency' },
];

export default function CommandCenter() {
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setTransparency = useAppStore((s) => s.setTransparency);
  const reset = useAiStore((s) => s.reset);
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await window.nova?.system?.info?.();
        if (!cancelled && r?.ok) setInfo(r);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  const trigger = (a) => {
    if (a.onAct === 'reset') reset();
    if (a.onAct === 'transparency') setTransparency(true);
    if (a.goto) setActiveTab(a.goto);
  };

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <header className="flex items-end justify-between">
          <div>
            <h1 className="font-display text-2xl text-nova-text">Command Center</h1>
            <p className="text-sm text-nova-muted mt-1">Everything Jarvis can do — at a glance.</p>
          </div>
          {info && (
            <div className="text-[11px] font-mono text-nova-muted">
              {info.platform}/{info.arch} · {info.cpus} cpu · {info.memTotalGB} GB · node {info.node}
              {info.electron ? ` · electron ${info.electron}` : ''}
            </div>
          )}
        </header>

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {QUICK_ACTIONS.map((a) => (
            <CommandCard
              key={a.id}
              title={a.title}
              description={a.description}
              icon={a.icon}
              accent={a.accent}
              onClick={() => trigger(a)}
            />
          ))}
        </section>

        <BuiltinDock />
        <WidgetGallery />
      </div>
    </div>
  );
}
