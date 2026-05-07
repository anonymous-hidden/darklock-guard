import React, { useEffect } from 'react';
import clsx from 'clsx';

import ChatTab from '@tabs/ChatTab.jsx';
import CommandCenterTab from '@tabs/CommandCenterTab.jsx';
import WidgetStudioTab from '@tabs/WidgetStudioTab.jsx';
import CodingTab from '@tabs/CodingTab.jsx';

import StatusBar from '@components/shared/StatusBar.jsx';
import TransparencyLog from '@components/shared/TransparencyLog.jsx';

import { useAppStore } from '@store/appStore.js';
import { useWidgetStore } from '@store/widgetStore.js';
import { useBuiltinStore } from '@store/builtinStore.js';
import { useOllama } from '@hooks/useOllama.js';
import { useWidgetBuilder } from '@hooks/useWidgetBuilder.js';

const TABS = [
  { id: 'chat',           label: 'Chat',           icon: '✦' },
  { id: 'command-center', label: 'Command Center', icon: '◉' },
  { id: 'widget-studio',  label: 'Widget Studio',  icon: '◆' },
  { id: 'coding',         label: 'Coding',         icon: '⌘' },
];

function NavButton({ tab, active, onClick, badge }) {
  return (
    <button
      onClick={onClick}
      className={clsx('nova-tab', active && 'nova-tab-active')}
    >
      <span className="font-display">{tab.icon}</span>
      <span>{tab.label}</span>
      {badge != null && badge > 0 && (
        <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-nova-accent/20 text-nova-accent border border-nova-accent/40 font-mono">
          {badge}
        </span>
      )}
    </button>
  );
}

export default function App() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const transparencyOpen = useAppStore((s) => s.transparencyOpen);
  const toggleTransparency = useAppStore((s) => s.toggleTransparency);
  const setTransparency = useAppStore((s) => s.setTransparency);
  const widgetCount = useWidgetStore((s) => s.widgets.length);

  // Initialize global hooks once.
  useOllama();
  useWidgetBuilder();
  const dockBuiltin   = useBuiltinStore((s) => s.dock);
  const undockBuiltin = useBuiltinStore((s) => s.undock);
  const setStatus     = useAppStore((s) => s.setStatusMessage);

  // Listen for tool-driven UI broadcasts from the main process.
  useEffect(() => {
    const offs = [];
    if (window.nova?.ui) {
      offs.push(window.nova.ui.onTabChange?.((tab) => { if (tab) setActiveTab(tab); }));
      offs.push(window.nova.ui.onSay?.((msg) => setStatus(String(msg || ''))));
      offs.push(window.nova.ui.onWidgetDock?.((id) => { dockBuiltin(id); setActiveTab('command-center'); }));
      offs.push(window.nova.ui.onWidgetClose?.((id) => undockBuiltin(id)));
      // popout broadcasts are handled by BuiltinDock (it owns the popout map)
    }
    return () => { for (const off of offs) try { off?.(); } catch {} };
  }, [setActiveTab, setStatus, dockBuiltin, undockBuiltin]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.key >= '1' && e.key <= '4') {
        const i = parseInt(e.key, 10) - 1;
        if (TABS[i]) setActiveTab(TABS[i].id);
      }
      if (e.ctrlKey && e.key === '`') {
        toggleTransparency();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setActiveTab, toggleTransparency]);

  return (
    <div className="h-full w-full flex flex-col bg-nova-bg text-nova-text">
      <header className="h-12 shrink-0 bg-nova-panel border-b border-nova-border flex items-center px-3 gap-3">
        <div className="flex items-center gap-2 pr-3 border-r border-nova-border">
          <span className="w-6 h-6 rounded bg-gradient-to-br from-nova-accent to-nova-accent2" />
          <span className="font-display text-sm tracking-wider">NOVA AI</span>
        </div>
        <nav className="flex items-center gap-1">
          {TABS.map((t) => (
            <NavButton
              key={t.id}
              tab={t}
              active={activeTab === t.id}
              onClick={() => setActiveTab(t.id)}
              badge={t.id === 'command-center' ? widgetCount : null}
            />
          ))}
        </nav>
        <div className="ml-auto text-[11px] text-nova-muted font-mono pr-1">
          ctrl+1…4 · ctrl+` log
        </div>
      </header>

      <main className="flex-1 min-h-0">
        {activeTab === 'chat'           && <ChatTab />}
        {activeTab === 'command-center' && <CommandCenterTab />}
        {activeTab === 'widget-studio'  && <WidgetStudioTab />}
        {activeTab === 'coding'         && <CodingTab />}
      </main>

      <StatusBar onToggleTransparency={toggleTransparency} />
      <TransparencyLog open={transparencyOpen} onClose={() => setTransparency(false)} />
    </div>
  );
}
