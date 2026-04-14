import React from 'react';

const MOOD_BAR_COLORS = {
  mood: '#00d4ff',
  energy: '#a6e3a1',
  curiosity: '#f9e2af',
  patience: '#cba6f7',
  satisfaction: '#94e2d5',
  warmth: '#f38ba8',
};

function MoodBar({ label, value, color }) {
  return (
    <div className="mood-bar-row">
      <span className="mood-bar-label">{label}</span>
      <div className="mood-bar-track">
        <div className="mood-bar-fill" style={{ width: `${(value * 100)}%`, background: color }} />
      </div>
      <span className="mood-bar-value">{Math.round(value * 100)}%</span>
    </div>
  );
}

export default function Settings({ settings, emotion, onClose }) {
  const emo = emotion?.state;

  return (
    <div className="settings-panel">
      <h2>⚙︎ Settings</h2>

      <div className="settings-group">
        <h3>AI Engine</h3>
        <div className="settings-row">
          <span className="settings-label">Model</span>
          <span className="settings-value">{settings.model || '—'}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Temperature</span>
          <span className="settings-value">{settings.temperature ?? '—'}</span>
        </div>
      </div>

      <div className="settings-group">
        <h3>Personality</h3>
        <div className="settings-row">
          <span className="settings-label">Name</span>
          <span className="settings-value">{settings.personality || 'Nova'}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Tone</span>
          <span className="settings-value">{settings.tone || 'casual'}</span>
        </div>
      </div>

      {emo && (
        <div className="settings-group">
          <h3>Emotional State</h3>
          <div className="settings-row">
            <span className="settings-label">Feeling</span>
            <span className="settings-value">{emotion.feeling || '—'}</span>
          </div>
          {Object.entries(MOOD_BAR_COLORS).map(([key, color]) => (
            emo[key] != null && <MoodBar key={key} label={key} value={emo[key]} color={color} />
          ))}
        </div>
      )}

      <div className="settings-group">
        <h3>Voice</h3>
        <div className="settings-row">
          <span className="settings-label">Status</span>
          <span className="settings-value">{settings.voice_enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
      </div>

      <div className="settings-group">
        <h3>Security</h3>
        <div className="settings-row">
          <span className="settings-label">Process Watcher</span>
          <span className="settings-value" style={{ color: 'var(--success)' }}>Active</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Integrity Checker</span>
          <span className="settings-value" style={{ color: 'var(--success)' }}>Active</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">File Watcher</span>
          <span className="settings-value" style={{ color: 'var(--success)' }}>Active</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Anomaly Detector</span>
          <span className="settings-value" style={{ color: 'var(--success)' }}>Active</span>
        </div>
      </div>

      <button className="settings-close" onClick={onClose}>← Back to Chat</button>
    </div>
  );
}
