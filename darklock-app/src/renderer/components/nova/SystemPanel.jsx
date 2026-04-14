import React from 'react';
import { useNovaStore } from '../../store/novaStore';

export default function SystemPanel() {
  const settings = useNovaStore(s => s.settings);
  const connected = useNovaStore(s => s.connected);
  const learningStats = useNovaStore(s => s.learningStats);
  const projectOverview = useNovaStore(s => s.projectOverview);
  const setModelMode = useNovaStore(s => s.setModelMode);
  const conversations = useNovaStore(s => s.conversations);

  const currentMode = settings?.auto_route
    ? 'auto'
    : settings?.models?.active === settings?.model_fast ? 'fast' : 'deep';

  return (
    <div className="bg-bg-secondary rounded-xl border border-border flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <span>⚙️</span> System & Models
        </h3>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${
          connected ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'
        }`}>
          {connected ? 'Online' : 'Offline'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 min-h-0">
        {/* Connection Status */}
        <div className="p-3 rounded-lg bg-bg-primary border border-border">
          <div className="text-xs font-medium text-text-primary mb-2">Nova Status</div>
          <div className="grid grid-cols-2 gap-y-2 text-[11px]">
            <span className="text-text-muted">Name</span>
            <span className="text-text-primary">{settings?.personality || 'Nova'}</span>
            <span className="text-text-muted">Tone</span>
            <span className="text-text-primary capitalize">{settings?.tone || '—'}</span>
            <span className="text-text-muted">API Port</span>
            <span className="text-text-primary font-mono">8950</span>
            <span className="text-text-muted">Conversations</span>
            <span className="text-text-primary">{conversations.length}</span>
          </div>
        </div>

        {/* Model Controls */}
        <div className="p-3 rounded-lg bg-bg-primary border border-border">
          <div className="text-xs font-medium text-text-primary mb-2">AI Models</div>
          <div className="grid grid-cols-2 gap-y-2 text-[11px] mb-3">
            <span className="text-text-muted">Deep Model</span>
            <span className="text-text-primary font-mono text-[10px]">{settings?.model || '—'}</span>
            <span className="text-text-muted">Fast Model</span>
            <span className="text-text-primary font-mono text-[10px]">{settings?.model_fast || '—'}</span>
            <span className="text-text-muted">Temperature</span>
            <span className="text-text-primary">{settings?.temperature || '—'}</span>
          </div>

          {/* Mode selector */}
          <div className="flex gap-1">
            {['auto', 'fast', 'deep'].map(mode => (
              <button
                key={mode}
                onClick={() => setModelMode(mode)}
                className={`flex-1 px-2 py-1.5 text-[10px] rounded font-medium transition-colors ${
                  currentMode === mode
                    ? 'bg-accent text-white'
                    : 'bg-bg-hover text-text-muted hover:text-text-primary'
                }`}
              >
                {mode === 'auto' ? '🔄 Auto' : mode === 'fast' ? '⚡ Fast (8B)' : '🧠 Deep (32B)'}
              </button>
            ))}
          </div>
        </div>

        {/* Learning Stats */}
        {learningStats && (
          <div className="p-3 rounded-lg bg-bg-primary border border-border">
            <div className="text-xs font-medium text-text-primary mb-2">Learning & Feedback</div>
            <div className="grid grid-cols-2 gap-y-2 text-[11px]">
              {Object.entries(learningStats).map(([key, val]) => (
                <React.Fragment key={key}>
                  <span className="text-text-muted capitalize">{key.replace(/_/g, ' ')}</span>
                  <span className="text-text-primary">{typeof val === 'number' ? val : JSON.stringify(val)}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        {/* Project Overview */}
        {projectOverview && (
          <div className="p-3 rounded-lg bg-bg-primary border border-border">
            <div className="text-xs font-medium text-text-primary mb-2">Indexed Project</div>
            <div className="text-[11px] text-text-secondary">
              {typeof projectOverview === 'string'
                ? projectOverview
                : <pre className="text-[10px] font-mono whitespace-pre-wrap">{JSON.stringify(projectOverview, null, 2).slice(0, 500)}</pre>
              }
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
