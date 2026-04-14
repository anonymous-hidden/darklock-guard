import React, { useState, useEffect, useCallback } from 'react';

const API = 'http://127.0.0.1:8950/api';

const STEP_COLOR = {
  done:        '#a6e3a1',
  in_progress: '#89b4fa',
  pending:     '#45475a',
  failed:      '#f38ba8',
  skipped:     '#f9e2af',
};

function GoalCard({ goal, onStepToggle, onCancel }) {
  const steps = goal.steps || [];
  const done = steps.filter(s => s.status === 'done').length;
  const total = steps.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="goal-card">
      <div className="goal-card-header">
        <span className="goal-title">{goal.title}</span>
        <button className="goal-cancel-btn" title="Cancel goal" onClick={() => onCancel(goal.id)}>✕</button>
      </div>

      {total > 0 && (
        <div className="goal-progress-row">
          <div className="goal-progress-track">
            <div className="goal-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="goal-progress-text">{done}/{total}</span>
        </div>
      )}

      <div className="goal-steps">
        {steps.map((step, i) => (
          <div key={i} className="goal-step">
            <div
              className="goal-step-dot"
              style={{ background: STEP_COLOR[step.status] || '#45475a' }}
            />
            <span className="goal-step-title">{step.title}</span>
            {step.status === 'pending' && (
              <button
                className="goal-step-btn"
                title="Mark done"
                onClick={() => onStepToggle(goal.id, i, 'done')}
              >
                ✓
              </button>
            )}
            {step.status === 'done' && (
              <button
                className="goal-step-btn muted"
                title="Mark pending"
                onClick={() => onStepToggle(goal.id, i, 'pending')}
              >
                ↩
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GoalPanel({ onClose }) {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newGoalText, setNewGoalText] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    fetch(`${API}/goals?status=active`)
      .then(r => r.json())
      .then(data => {
        setGoals(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [load]);

  const addGoal = async () => {
    const text = newGoalText.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      await fetch(`${API}/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: text }),
      });
      setNewGoalText('');
      load();
    } catch {}
    setAdding(false);
  };

  const updateStep = async (goalId, stepIdx, status) => {
    try {
      await fetch(`${API}/goals/${goalId}/steps/${stepIdx}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      load();
    } catch {}
  };

  const cancelGoal = async (goalId) => {
    try {
      await fetch(`${API}/goals/${goalId}`, { method: 'DELETE' });
      setGoals(g => g.filter(x => x.id !== goalId));
    } catch {}
  };

  return (
    <div className="goal-panel">
      <div className="goal-panel-header">
        <span>Goals</span>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>

      <div className="goal-add-row">
        <input
          className="goal-input"
          placeholder="Add a new goal..."
          value={newGoalText}
          onChange={e => setNewGoalText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addGoal()}
          disabled={adding}
        />
        <button className="goal-add-btn" onClick={addGoal} disabled={adding || !newGoalText.trim()}>
          +
        </button>
      </div>

      <div className="goal-list">
        {loading ? (
          <div className="goal-empty">Loading...</div>
        ) : goals.length === 0 ? (
          <div className="goal-empty">No active goals — add one above</div>
        ) : (
          goals.map(g => (
            <GoalCard
              key={g.id}
              goal={g}
              onStepToggle={updateStep}
              onCancel={cancelGoal}
            />
          ))
        )}
      </div>
    </div>
  );
}
