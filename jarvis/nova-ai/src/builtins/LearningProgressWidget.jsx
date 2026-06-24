import React, { useCallback, useEffect, useMemo, useState } from 'react';

const API_BASE = 'http://127.0.0.1:8951';
const LEARNING_STATE_URL = `${API_BASE}/api/learning/state`;
const LEARNING_PROGRESS_URL = `${API_BASE}/api/learning/progress`;
const LEARNING_TASK_URL = `${API_BASE}/api/learning/task`;
const LEARNING_TASK_DONE_URL = `${API_BASE}/api/learning/task/done`;
const LEARNING_NOTE_URL = `${API_BASE}/api/learning/note`;

function pct(v) {
  const n = Number(v || 0);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function topicLabel(topicId, topics) {
  const found = (topics || []).find((t) => t.id === topicId);
  return found?.name || topicId || 'general';
}

export default function LearningProgressWidget() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [topic, setTopic] = useState('Cybersecurity');
  const [progress, setProgress] = useState(15);
  const [status, setStatus] = useState('active');
  const [note, setNote] = useState('');

  const [taskTitle, setTaskTitle] = useState('');
  const [taskTopic, setTaskTopic] = useState('cybersecurity');
  const [taskNote, setTaskNote] = useState('');

  const [journalText, setJournalText] = useState('');
  const [saving, setSaving] = useState(false);

  const publish = useCallback((action, summary, extra = {}) => {
    try {
      window.nova?.bus?.publish?.('widget:event', {
        widget: 'learning-progress',
        action,
        summary,
        ...extra,
      });
    } catch {}
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch(LEARNING_STATE_URL);
      const data = await r.json();
      if (!data?.ok) throw new Error(data?.error || 'failed to load state');
      setState(data.state || null);
      const firstTopic = (data.state?.topics || [])[0];
      if (firstTopic) {
        setTopic(firstTopic.name || firstTopic.id || 'Learning');
        setProgress(pct(firstTopic.progress));
        setStatus(firstTopic.status || 'active');
      }
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const off = window.nova?.bus?.subscribe?.('learning:changed', (payload) => {
      if (payload?.state) {
        setState(payload.state);
      } else {
        load();
      }
    });
    return () => off?.();
  }, [load]);

  const topics = state?.topics || [];
  const tasks = state?.tasks || [];
  const journal = state?.journal || [];
  const summary = state?.summary || {};

  const activeTasks = useMemo(() => tasks.filter((t) => !t.done), [tasks]);

  const submitProgress = async () => {
    setSaving(true);
    setErr('');
    try {
      const r = await fetch(LEARNING_PROGRESS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          percent: pct(progress),
          status,
          note,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) throw new Error(data?.detail || data?.error || 'failed to set progress');
      setState(data.state || state);
      setNote('');
      publish('progress-set', `Updated ${topic} to ${pct(progress)}% (${status})`, {
        topic,
        progress: pct(progress),
        status,
      });
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const submitTask = async () => {
    const title = taskTitle.trim();
    if (!title) return;
    setSaving(true);
    setErr('');
    try {
      const r = await fetch(LEARNING_TASK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, topic: taskTopic || 'general', note: taskNote }),
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) throw new Error(data?.detail || data?.error || 'failed to add task');
      setState(data.state || state);
      setTaskTitle('');
      setTaskNote('');
      publish('task-added', `Learning task added: ${title}`, { task: data.task || null });
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const markTaskDone = async (task) => {
    if (!task?.id) return;
    setSaving(true);
    setErr('');
    try {
      const r = await fetch(LEARNING_TASK_DONE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: task.id }),
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) throw new Error(data?.detail || data?.error || 'failed to complete task');
      setState(data.state || state);
      publish('task-done', `Completed learning task: ${task.title}`, { task: data.task || task });
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const submitJournal = async () => {
    const content = journalText.trim();
    if (!content) return;
    setSaving(true);
    setErr('');
    try {
      const r = await fetch(LEARNING_NOTE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: content, topic: taskTopic || 'general' }),
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) throw new Error(data?.detail || data?.error || 'failed to save note');
      setState(data.state || state);
      setJournalText('');
      publish('note-added', 'Learning note saved.');
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-nova-bg text-nova-text">
      <header className="px-3 py-2 border-b border-nova-border/60 bg-nova-panel/40 backdrop-blur flex items-center justify-between">
        <div>
          <div className="font-display text-sm flex items-center gap-1.5">
            <span className="text-nova-accent2">📈</span> Learning Progress
          </div>
          <div className="text-[10px] text-nova-muted font-mono">
            {summary.tasksDone || 0}/{summary.tasksTotal || 0} tasks done · avg {summary.avgProgress || 0}%
          </div>
        </div>
        <button onClick={load} className="nova-btn text-[10px] px-2 py-1">↻ refresh</button>
      </header>

      {err && (
        <div className="mx-2 mt-2 p-1.5 rounded border border-nova-err/40 bg-nova-err/10 text-[10px] font-mono text-nova-err">
          {err}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        <section className="nova-card p-2 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-nova-accent2 font-mono">Topic Progress</div>
          {loading && <div className="text-[10px] text-nova-muted animate-pulse">Loading learning state…</div>}
          {!loading && topics.length === 0 && <div className="text-[10px] text-nova-muted">No topics yet.</div>}
          {topics.map((t) => (
            <div key={t.id} className="rounded border border-nova-border/50 bg-nova-panel/30 px-2 py-1">
              <div className="flex justify-between text-[11px]">
                <span>{t.name}</span>
                <span className="font-mono text-nova-accent">{pct(t.progress)}%</span>
              </div>
              <div className="h-1.5 rounded bg-nova-panel2/60 mt-1 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-nova-accent to-nova-accent2" style={{ width: `${pct(t.progress)}%` }} />
              </div>
            </div>
          ))}

          <div className="grid grid-cols-2 gap-1.5">
            <input value={topic} onChange={(e) => setTopic(e.target.value)} className="nova-input text-[11px]" placeholder="Topic" />
            <input
              value={progress}
              onChange={(e) => setProgress(e.target.value)}
              className="nova-input text-[11px]"
              type="number"
              min="0"
              max="100"
              placeholder="Percent"
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="nova-input text-[11px]">
              <option value="active">active</option>
              <option value="planned">planned</option>
              <option value="blocked">blocked</option>
              <option value="completed">completed</option>
            </select>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="nova-input text-[11px]" placeholder="Optional note" />
          </div>
          <button onClick={submitProgress} disabled={saving} className="nova-btn-primary text-[11px] px-2 py-1">
            {saving ? 'Saving…' : 'Update progress'}
          </button>
        </section>

        <section className="nova-card p-2 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-nova-accent2 font-mono">Tasks</div>
          {activeTasks.length === 0 && <div className="text-[10px] text-nova-muted">No active tasks.</div>}
          <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
            {activeTasks.map((t) => (
              <div key={t.id} className="rounded border border-nova-border/50 bg-nova-panel/30 px-2 py-1 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] truncate">{t.title}</div>
                  <div className="text-[9.5px] text-nova-muted font-mono">{topicLabel(t.topic, topics)}</div>
                </div>
                <button onClick={() => markTaskDone(t)} className="nova-btn text-[10px] px-2 py-0.5">done</button>
              </div>
            ))}
          </div>

          <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} className="nova-input text-[11px]" placeholder="New task title" />
          <div className="grid grid-cols-2 gap-1.5">
            <input value={taskTopic} onChange={(e) => setTaskTopic(e.target.value)} className="nova-input text-[11px]" placeholder="Task topic" />
            <input value={taskNote} onChange={(e) => setTaskNote(e.target.value)} className="nova-input text-[11px]" placeholder="Task note" />
          </div>
          <button onClick={submitTask} disabled={saving} className="nova-btn-primary text-[11px] px-2 py-1">Add task</button>
        </section>

        <section className="nova-card p-2 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-nova-accent2 font-mono">Learning Journal</div>
          <textarea
            value={journalText}
            onChange={(e) => setJournalText(e.target.value)}
            rows={2}
            className="nova-input text-[11px] resize-none"
            placeholder="What did you learn today?"
          />
          <button onClick={submitJournal} disabled={saving} className="nova-btn-primary text-[11px] px-2 py-1">Save note</button>

          <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
            {(journal || []).slice().reverse().map((j) => (
              <div key={j.id} className="rounded border border-nova-border/50 bg-nova-panel/30 px-2 py-1">
                <div className="text-[11px] text-nova-text/90">{j.note}</div>
                <div className="text-[9px] text-nova-muted font-mono">
                  {topicLabel(j.topic, topics)} · {new Date(j.ts).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
