import React, { useEffect, useState } from 'react';
import { useNovaStore } from '../store/novaStore';
import EmotionPanel from '../components/nova/EmotionPanel';
import ThoughtStream from '../components/nova/ThoughtStream';
import MemoryPanel from '../components/nova/MemoryPanel';
import IntegrationsPanel from '../components/nova/IntegrationsPanel';
import SecurityPanel from '../components/nova/SecurityPanel';
import TasksPanel from '../components/nova/TasksPanel';
import NovaChat from '../components/nova/NovaChat';
import SystemPanel from '../components/nova/SystemPanel';

const TABS = [
  { id: 'overview', label: 'Overview', icon: '🏠' },
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'mind', label: 'Mind', icon: '🧠' },
  { id: 'memory', label: 'Memory', icon: '🧬' },
  { id: 'tasks', label: 'Tasks', icon: '🎯' },
  { id: 'integrations', label: 'Connect', icon: '🔌' },
  { id: 'security', label: 'Security', icon: '🛡️' },
  { id: 'system', label: 'System', icon: '⚙️' },
];

export default function NovaCommandCenter({ onBack }) {
  const connected = useNovaStore(s => s.connected);
  const emotion = useNovaStore(s => s.emotion);
  const unreadAlerts = useNovaStore(s => s.unreadAlerts);
  const isThinking = useNovaStore(s => s.isThinking);
  const connectWs = useNovaStore(s => s.connectWs);
  const disconnectWs = useNovaStore(s => s.disconnectWs);
  const startPolling = useNovaStore(s => s.startPolling);
  const stopPolling = useNovaStore(s => s.stopPolling);
  const fetchAll = useNovaStore(s => s.fetchAll);
  const [activeTab, setActiveTab] = useState('overview');

  // Connect on mount
  useEffect(() => {
    connectWs();
    startPolling();
    // If WS connection fails, still try REST
    const timer = setTimeout(() => fetchAll(), 1000);
    return () => {
      stopPolling();
      clearTimeout(timer);
    };
  }, []);

  const dominant = emotion?.dominant_feeling || 'content';

  return (
    <div className="h-full flex flex-col bg-bg-tertiary">
      {/* Header */}
      <div className="shrink-0 bg-bg-secondary border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="text-text-muted hover:text-text-primary transition-colors text-sm"
              title="Back to DarkLock"
            >
              ← Back
            </button>
            <div className="w-px h-5 bg-border" />
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                connected
                  ? 'bg-gradient-to-br from-accent to-[#eb459e]'
                  : 'bg-bg-hover'
              }`}>
                {isThinking ? '💭' : '🤖'}
              </div>
              <div>
                <div className="text-sm font-semibold text-text-primary flex items-center gap-2">
                  Nova Command Center
                  <span className={`w-2 h-2 rounded-full ${connected ? 'bg-success' : 'bg-danger'}`} />
                </div>
                <div className="text-[10px] text-text-muted">
                  {connected
                    ? `Online · Feeling ${dominant} · ${isThinking ? 'Thinking...' : 'Ready'}`
                    : 'Offline · Trying to reconnect...'
                  }
                </div>
              </div>
            </div>
          </div>

          {/* Quick stats */}
          <div className="flex items-center gap-3">
            {unreadAlerts > 0 && (
              <span className="text-[10px] px-2 py-1 bg-danger/20 rounded-full text-danger font-medium">
                {unreadAlerts} alert{unreadAlerts !== 1 ? 's' : ''}
              </span>
            )}
            {emotion && (
              <div className="hidden sm:flex items-center gap-1 text-[10px] text-text-muted">
                <span>Energy: {Math.round((emotion.energy || 0) * 100)}%</span>
                <span className="mx-1">·</span>
                <span>Mood: {Math.round((emotion.mood || 0) * 100)}%</span>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-3 -mb-3 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-xs font-medium rounded-t-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'bg-bg-tertiary text-text-primary'
                  : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
              {tab.id === 'security' && unreadAlerts > 0 && (
                <span className="w-4 h-4 bg-danger rounded-full text-[9px] text-white flex items-center justify-center">
                  {unreadAlerts > 9 ? '9+' : unreadAlerts}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden p-4">
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-full">
            <div className="lg:col-span-1 space-y-4 overflow-y-auto">
              <EmotionPanel />
              <SystemPanel />
            </div>
            <div className="lg:col-span-1 h-full min-h-[300px]">
              <NovaChat />
            </div>
            <div className="lg:col-span-1 space-y-4 overflow-y-auto">
              <TasksPanel />
              <SecurityPanel />
            </div>
          </div>
        )}

        {activeTab === 'chat' && (
          <div className="h-full max-w-3xl mx-auto">
            <NovaChat />
          </div>
        )}

        {activeTab === 'mind' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
            <div className="h-full min-h-[300px]">
              <ThoughtStream />
            </div>
            <div className="space-y-4 overflow-y-auto">
              <EmotionPanel />
            </div>
          </div>
        )}

        {activeTab === 'memory' && (
          <div className="h-full max-w-4xl mx-auto">
            <MemoryPanel />
          </div>
        )}

        {activeTab === 'tasks' && (
          <div className="h-full max-w-3xl mx-auto">
            <TasksPanel />
          </div>
        )}

        {activeTab === 'integrations' && (
          <div className="h-full max-w-4xl mx-auto">
            <IntegrationsPanel />
          </div>
        )}

        {activeTab === 'security' && (
          <div className="h-full max-w-4xl mx-auto">
            <SecurityPanel />
          </div>
        )}

        {activeTab === 'system' && (
          <div className="h-full max-w-3xl mx-auto">
            <SystemPanel />
          </div>
        )}
      </div>
    </div>
  );
}
