import React from 'react';

export default function Sidebar({ conversations, activeId, onSelect, onNew, onDelete, onSettings, onMemories, onVoiceCall, onDashboard, onLearning, alertCount, mobileOpen }) {
  return (
    <aside className={`sidebar ${mobileOpen ? 'sidebar-mobile-open' : ''}`}>
      <div className="sidebar-header">
        <span className="sidebar-brand">◆ NOVA</span>
        <button className="sidebar-new" onClick={onNew}>+ New</button>
      </div>

      <div className="sidebar-list">
        {conversations.map(c => (
          <div
            key={c.id}
            className={`sidebar-item ${c.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(c.id)}
          >
            <span className="sidebar-item-title">{c.title || 'New Conversation'}</span>
            <button
              className="sidebar-item-delete"
              onClick={e => { e.stopPropagation(); onDelete(c.id); }}
              title="Delete"
            >×</button>
          </div>
        ))}
        {conversations.length === 0 && (
          <div style={{ padding: '20px 10px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
            No conversations yet.<br />Press <strong>+ New</strong> to start.
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button className="sidebar-dashboard-btn" onClick={onDashboard}>◉ Dashboard</button>
        <button className="sidebar-voice-btn" onClick={onVoiceCall}>⌁ Voice Call</button>
        <button className="sidebar-memories-btn" onClick={onMemories}>◈ Memories</button>
        <button className="sidebar-learning-btn" onClick={onLearning}>◆ Learning</button>
        <button className="sidebar-settings-btn" onClick={onSettings}>
          ⌖ Settings
          {alertCount > 0 && <span className="alert-badge">{alertCount}</span>}
        </button>
      </div>
    </aside>
  );
}
