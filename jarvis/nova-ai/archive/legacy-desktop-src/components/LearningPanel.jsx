import React, { useState, useEffect, useCallback } from 'react';

const API = 'http://127.0.0.1:8950/api';

const TABS = [
  { id: 'overview', label: '▣ Overview' },
  { id: 'training', label: '◆ Training Data' },
  { id: 'patterns', label: '◈ Patterns' },
  { id: 'feedback', label: '▸ Feedback Log' },
];

export default function LearningPanel({ onClose }) {
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState({});
  const [pending, setPending] = useState([]);
  const [approved, setApproved] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  const refresh = useCallback(() => {
    fetch(`${API}/learning/stats`).then(r => r.json()).then(setStats).catch(() => {});
    fetch(`${API}/learning/training/pending`).then(r => r.json()).then(setPending).catch(() => {});
    fetch(`${API}/learning/training/approved`).then(r => r.json()).then(setApproved).catch(() => {});
    fetch(`${API}/learning/patterns`).then(r => r.json()).then(setPatterns).catch(() => {});
    fetch(`${API}/learning/feedback?limit=50`).then(r => r.json()).then(setFeedback).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 10000);
    return () => clearInterval(iv);
  }, [refresh]);

  const approvePair = async (id) => {
    await fetch(`${API}/learning/training/${id}/approve`, { method: 'POST' });
    refresh();
  };

  const rejectPair = async (id) => {
    await fetch(`${API}/learning/training/${id}/reject`, { method: 'POST' });
    refresh();
  };

  const startEdit = (pair) => {
    setEditingId(pair.id);
    setEditText(pair.nova_msg);
  };

  const saveEdit = async (id) => {
    await fetch(`${API}/learning/training/${id}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nova_msg: editText }),
    });
    setEditingId(null);
    refresh();
  };

  const harvest = async () => {
    const res = await fetch(`${API}/learning/training/harvest`, { method: 'POST' });
    const data = await res.json();
    alert(`Harvested ${data.pairs_created || 0} training pair candidates`);
    refresh();
  };

  const exportData = async () => {
    const res = await fetch(`${API}/learning/training/export`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) alert(`Exported to: ${data.path}`);
    else alert(data.error || 'Export failed');
  };

  const genModelfile = async () => {
    const res = await fetch(`${API}/learning/finetune/modelfile`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) alert(`Modelfile generated: ${data.path}`);
  };

  const discoverPatterns = async () => {
    const res = await fetch(`${API}/learning/patterns/discover`, { method: 'POST' });
    const data = await res.json();
    alert(`Discovered ${data.patterns || 0} new patterns`);
    refresh();
  };

  const deactivatePattern = async (id) => {
    await fetch(`${API}/learning/patterns/${id}/deactivate`, { method: 'POST' });
    refresh();
  };

  const renderOverview = () => (
    <div className="dash-overview">
      <div className="dash-cards">
        <div className="dash-card">
          <div className="card-icon">▸</div>
          <div className="card-label">Total Feedback</div>
          <div className="card-value">{stats.total_feedback || 0}</div>
        </div>
        <div className="dash-card">
          <div className="card-icon">◆</div>
          <div className="card-label">Pending Review</div>
          <div className="card-value">{stats.pending_pairs || 0}</div>
        </div>
        <div className="dash-card card-ok">
          <div className="card-icon">◉</div>
          <div className="card-label">Approved Pairs</div>
          <div className="card-value">{stats.approved_pairs || 0}</div>
        </div>
        <div className="dash-card">
          <div className="card-icon">◈</div>
          <div className="card-label">Active Patterns</div>
          <div className="card-value">{stats.active_patterns || 0}</div>
        </div>
      </div>

      <div className="learn-actions">
        <h3>Actions</h3>
        <button className="learn-btn" onClick={harvest}>◆ Harvest Training Pairs</button>
        <button className="learn-btn" onClick={discoverPatterns}>◈ Run Pattern Discovery</button>
        <button className="learn-btn" onClick={exportData} disabled={!stats.approved_pairs}>↓ Export Training Data</button>
        <button className="learn-btn" onClick={genModelfile} disabled={!stats.approved_pairs}>⌁ Generate Modelfile</button>
      </div>

      <div className="learn-info">
        <h3>How It Works</h3>
        <p><strong>Layer 1 — Feedback:</strong> Thumbs up/down on messages trains Nova's preferences in real-time.</p>
        <p><strong>Layer 2 — Patterns:</strong> Nightly analysis discovers behavioral patterns from conversations.</p>
        <p><strong>Layer 3 — Fine-Tuning:</strong> Approve conversation pairs → export JSONL → create LoRA adapter.</p>
      </div>
    </div>
  );

  const renderTraining = () => (
    <div className="learn-training">
      <h3>Pending Review ({pending.length})</h3>
      {pending.length === 0 && <p className="learn-empty">No pairs pending review. Hit "Harvest" to scan conversations.</p>}
      {pending.map(pair => (
        <div key={pair.id} className="train-pair">
          <div className="train-user">
            <span className="train-label">User:</span>
            <span className="train-text">{pair.user_msg}</span>
          </div>
          <div className="train-nova">
            <span className="train-label">Nova:</span>
            {editingId === pair.id ? (
              <div className="train-edit">
                <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} />
                <button className="learn-btn-sm" onClick={() => saveEdit(pair.id)}>Save</button>
                <button className="learn-btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            ) : (
              <span className="train-text">{pair.nova_msg}</span>
            )}
          </div>
          <div className="train-actions">
            <button className="learn-btn-sm btn-approve" onClick={() => approvePair(pair.id)}>✓ Approve</button>
            <button className="learn-btn-sm btn-edit" onClick={() => startEdit(pair)}>✎ Edit</button>
            <button className="learn-btn-sm btn-reject" onClick={() => rejectPair(pair.id)}>✕ Reject</button>
          </div>
        </div>
      ))}

      <h3 style={{ marginTop: 24 }}>Approved ({approved.length})</h3>
      {approved.slice(0, 20).map(pair => (
        <div key={pair.id} className="train-pair approved">
          <div className="train-user">
            <span className="train-label">User:</span>
            <span className="train-text">{pair.user_msg}</span>
          </div>
          <div className="train-nova">
            <span className="train-label">Nova:</span>
            <span className="train-text">{pair.nova_msg}</span>
          </div>
        </div>
      ))}
    </div>
  );

  const renderPatterns = () => (
    <div className="learn-patterns">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3>Learned Patterns ({patterns.length})</h3>
        <button className="learn-btn-sm" onClick={discoverPatterns}>Run Discovery</button>
      </div>
      {patterns.length === 0 && <p className="learn-empty">No patterns discovered yet. Run pattern discovery or wait for the nightly job.</p>}
      {patterns.map(p => (
        <div key={p.id} className="pattern-card">
          <div className="pattern-meta">
            <span className="pattern-cat">{p.category}</span>
            <span className="pattern-conf">{Math.round((p.confidence || 0) * 100)}%</span>
          </div>
          <div className="pattern-text">{p.pattern}</div>
          <button className="learn-btn-sm btn-reject" onClick={() => deactivatePattern(p.id)}>Deactivate</button>
        </div>
      ))}
    </div>
  );

  const renderFeedback = () => (
    <div className="learn-feedback">
      <h3>Recent Feedback ({feedback.length})</h3>
      {feedback.length === 0 && <p className="learn-empty">No feedback recorded yet. Use ▲/▼ on messages.</p>}
      {feedback.map((f, i) => (
        <div key={i} className="feedback-row">
          <span className={`fb-signal fb-${f.signal}`}>
            {f.signal === 'positive' ? '▲' : f.signal === 'negative' ? '▼' : f.signal === 'correction' ? '✎' : '◈'}
          </span>
          <div className="fb-detail">
            <div className="fb-cat">{f.category} — {f.created_at?.slice(0, 16)}</div>
            {f.user_msg && <div className="fb-msg">User: {f.user_msg.slice(0, 100)}</div>}
            {f.correction && <div className="fb-correction">Correction: {f.correction.slice(0, 100)}</div>}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="settings-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Learning System</h2>
      </div>
      <div className="dash-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`dash-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </div>
      <div className="dash-content">
        {tab === 'overview' && renderOverview()}
        {tab === 'training' && renderTraining()}
        {tab === 'patterns' && renderPatterns()}
        {tab === 'feedback' && renderFeedback()}
      </div>
      <button className="settings-close" onClick={onClose}>← Back to Chat</button>
    </div>
  );
}
