import React, { useState } from 'react';
import { useNovaStore } from '../../store/novaStore';

const PRIORITY_COLORS = {
  high: 'text-danger',
  medium: 'text-warning',
  low: 'text-text-muted',
};

const STATUS_BADGES = {
  pending: { label: 'To Do', color: 'bg-bg-hover text-text-secondary' },
  'in-progress': { label: 'In Progress', color: 'bg-accent/20 text-accent' },
  in_progress: { label: 'In Progress', color: 'bg-accent/20 text-accent' },
  done: { label: 'Done', color: 'bg-success/20 text-success' },
  completed: { label: 'Done', color: 'bg-success/20 text-success' },
};

export default function TasksPanel() {
  const tasks = useNovaStore(s => s.tasks);
  const refreshTasks = useNovaStore(s => s.refreshTasks);
  const addTask = useNovaStore(s => s.addTask);
  const updateTask = useNovaStore(s => s.updateTask);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState('medium');
  const [showAdd, setShowAdd] = useState(false);

  const handleAdd = async () => {
    if (!newTitle.trim()) return;
    await addTask(newTitle, '', newPriority);
    setNewTitle('');
    setShowAdd(false);
  };

  const cycleStatus = async (task) => {
    const order = ['pending', 'in-progress', 'done'];
    const current = task.status || 'pending';
    const idx = order.indexOf(current);
    const next = order[(idx + 1) % order.length];
    await updateTask(task.id, next);
  };

  const activeTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'completed');
  const doneTasks = tasks.filter(t => t.status === 'done' || t.status === 'completed');

  return (
    <div className="bg-bg-secondary rounded-xl border border-border flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <span>🎯</span> Tasks & Goals
          <span className="text-[10px] text-text-muted">({activeTasks.length} active)</span>
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="text-[10px] px-2 py-1 bg-accent/20 rounded text-accent hover:bg-accent/30"
          >+ Add</button>
          <button
            onClick={refreshTasks}
            className="text-xs text-text-muted hover:text-text-primary"
          >↻</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {/* Add task form */}
        {showAdd && (
          <div className="p-3 bg-bg-primary rounded-lg border border-border space-y-2">
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="Task title..."
              className="w-full bg-bg-tertiary text-text-primary text-xs rounded px-3 py-2 border border-border focus:border-accent outline-none"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <select
                value={newPriority}
                onChange={e => setNewPriority(e.target.value)}
                className="bg-bg-tertiary text-text-secondary text-xs rounded px-2 py-1 border border-border"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <button
                onClick={handleAdd}
                className="px-3 py-1 bg-accent text-white text-xs rounded hover:bg-accent-hover"
              >Add Task</button>
            </div>
          </div>
        )}

        {/* Active tasks */}
        {activeTasks.length === 0 && !showAdd ? (
          <div className="text-text-muted text-xs text-center py-4">
            No active tasks. Add one or ask Nova to track something.
          </div>
        ) : (
          activeTasks.map(task => (
            <div
              key={task.id}
              onClick={() => cycleStatus(task)}
              className="p-3 bg-bg-primary rounded-lg border border-border cursor-pointer hover:border-accent/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className={`text-xs ${PRIORITY_COLORS[task.priority] || ''}`}>
                  {task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '⚪'}
                </span>
                <span className="text-xs text-text-primary flex-1">{task.title}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  (STATUS_BADGES[task.status] || STATUS_BADGES.pending).color
                }`}>
                  {(STATUS_BADGES[task.status] || STATUS_BADGES.pending).label}
                </span>
              </div>
              {task.description && (
                <div className="text-[11px] text-text-muted mt-1 pl-5">{task.description}</div>
              )}
            </div>
          ))
        )}

        {/* Done tasks */}
        {doneTasks.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 mt-2">
              Completed ({doneTasks.length})
            </div>
            {doneTasks.slice(0, 5).map(task => (
              <div key={task.id} className="p-2 bg-bg-primary/50 rounded-lg text-xs text-text-muted line-through">
                {task.title}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
