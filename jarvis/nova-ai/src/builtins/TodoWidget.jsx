import React, { useEffect, useState, useCallback } from 'react';

const PRIORITY_COLOR = {
  urgent: 'text-nova-err border-nova-err/50 bg-nova-err/10',
  high:   'text-nova-warn border-nova-warn/50 bg-nova-warn/10',
  normal: 'text-nova-text/80 border-nova-border bg-nova-panel/40',
  low:    'text-nova-muted border-nova-border bg-nova-panel/20',
};
const PRIORITY_DOT = {
  urgent: 'bg-nova-err shadow-[0_0_8px_-1px_rgba(239,68,68,0.7)]',
  high:   'bg-nova-warn shadow-[0_0_8px_-1px_rgba(245,158,11,0.7)]',
  normal: 'bg-nova-accent',
  low:    'bg-nova-muted',
};

export default function TodoWidget() {
  const publish = (action, summary) => {
    try { window.nova?.bus?.publish?.('widget:event', { widget: 'todo', action, summary }); } catch {}
  };

  const [todos, setTodos] = useState([]);
  const [text, setText] = useState('');
  const [priority, setPriority] = useState('normal');
  const [filter, setFilter] = useState('all'); // all|active|done

  const refresh = useCallback(async () => {
    try {
      const t = await window.nova?.todos?.list?.({ includeCompleted: true });
      if (Array.isArray(t)) setTodos(t);
    } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const add = async () => {
    const v = text.trim();
    if (!v) return;
    await window.nova?.todos?.add?.({ title: v, priority });
    publish('added', `Todo added: ${v}`);
    setText('');
    refresh();
  };

  const toggle = async (id) => {
    await window.nova?.todos?.toggle?.(id);
    publish('toggled', 'Todo updated');
    refresh();
  };
  const remove = async (id) => {
    await window.nova?.todos?.delete?.(id);
    publish('deleted', 'Todo removed');
    refresh();
  };

  const view = todos.filter((t) => {
    if (filter === 'active') return !t.completed;
    if (filter === 'done')   return t.completed;
    return true;
  });

  const remaining = todos.filter((t) => !t.completed).length;

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-nova-bg to-nova-panel/30 text-nova-text">
      <header className="px-3 py-2 border-b border-nova-border/50 bg-nova-panel/40 backdrop-blur flex items-center justify-between">
        <div>
          <div className="font-display text-sm flex items-center gap-1.5">
            <span className="text-nova-accent">☑</span> Todos
          </div>
          <div className="text-[10.5px] text-nova-muted font-mono">
            {remaining} remaining · {todos.length - remaining} done
          </div>
        </div>
        <div className="flex gap-0.5 text-[10.5px] bg-nova-panel/60 rounded-md p-0.5 border border-nova-border/40">
          {['all', 'active', 'done'].map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-2 py-0.5 rounded transition-colors ${filter === f ? 'bg-nova-accent/20 text-nova-accent' : 'text-nova-muted hover:text-nova-text'}`}>
              {f}
            </button>
          ))}
        </div>
      </header>

      <div className="flex gap-1.5 p-2 border-b border-nova-border/50 bg-nova-panel/20">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder="Add a task…"
          className="nova-input text-sm flex-1"
        />
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="nova-input text-xs w-auto">
          <option value="low">low</option>
          <option value="normal">normal</option>
          <option value="high">high</option>
          <option value="urgent">urgent</option>
        </select>
        <button onClick={add} className="nova-btn-primary text-xs px-3">Add</button>
      </div>

      <div className="flex-1 overflow-auto px-1.5 py-1 space-y-1">
        {view.length === 0 && (
          <div className="text-center text-nova-muted text-sm py-10">
            <div className="text-3xl mb-1 opacity-50">✨</div>
            All clear!
          </div>
        )}
        {view.map((t) => (
          <div key={t.id}
            className={`group flex items-start gap-2 px-2 py-1.5 rounded-lg border border-transparent hover:border-nova-border/60 hover:bg-nova-panel/40 transition-all ${t.completed ? 'opacity-50' : ''}`}>
            <button
              onClick={() => toggle(t.id)}
              className={`mt-0.5 w-4 h-4 rounded shrink-0 border-2 flex items-center justify-center transition-all ${
                t.completed ? 'bg-nova-ok border-nova-ok' : 'border-nova-border hover:border-nova-accent'
              }`}
              aria-label="toggle"
            >
              {t.completed && <span className="text-[10px] text-nova-bg leading-none">✓</span>}
            </button>
            <div className="flex-1 min-w-0">
              <div className={`text-sm leading-tight ${t.completed ? 'line-through text-nova-muted' : ''}`}>
                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${PRIORITY_DOT[t.priority] || PRIORITY_DOT.normal}`} />
                {t.title}
              </div>
              <div className="flex flex-wrap gap-1 mt-1 text-[9.5px] font-mono">
                <span className={`border px-1 py-px rounded ${PRIORITY_COLOR[t.priority] || ''}`}>{t.priority}</span>
                {t.tags?.map((tag) => <span key={tag} className="border border-nova-border px-1 py-px rounded text-nova-muted">#{tag}</span>)}
                {t.dueAt && <span className="text-nova-accent2">due {new Date(t.dueAt).toLocaleDateString()}</span>}
              </div>
            </div>
            <button onClick={() => remove(t.id)} className="text-[14px] text-nova-muted hover:text-nova-err opacity-0 group-hover:opacity-100 transition-opacity px-1">×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
