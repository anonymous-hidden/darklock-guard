/**
 * todos-store.js — local todo / task tracking.
 * Stored as a single JSON file at <root>/data/todos.json.
 */
import path from 'path';
import { promises as fs } from 'fs';
import crypto from 'crypto';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export class TodosStore {
  constructor({ rootDir }) {
    this.file = path.join(rootDir, 'data', 'todos.json');
  }

  async _read() {
    try {
      const raw = await fs.readFile(this.file, 'utf-8');
      const j = JSON.parse(raw);
      return Array.isArray(j.todos) ? j : { version: 1, todos: [] };
    } catch {
      return { version: 1, todos: [] };
    }
  }

  async _write(state) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(state, null, 2));
  }

  async list({ includeCompleted = true } = {}) {
    const s = await this._read();
    const todos = includeCompleted ? s.todos : s.todos.filter((t) => !t.completed);
    return todos.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const pa = PRIORITIES.indexOf(a.priority);
      const pb = PRIORITIES.indexOf(b.priority);
      if (pa !== pb) return pb - pa;
      return b.createdAt - a.createdAt;
    });
  }

  async add({ title, priority = 'normal', dueAt = null, tags = [] }) {
    if (!title) throw new Error('title required');
    const s = await this._read();
    const todo = {
      id: `t_${crypto.randomBytes(5).toString('hex')}`,
      title: String(title),
      priority: PRIORITIES.includes(priority) ? priority : 'normal',
      tags: Array.isArray(tags) ? tags.map(String).slice(0, 8) : [],
      dueAt: dueAt ? Number(dueAt) : null,
      completed: false,
      createdAt: Date.now(),
      completedAt: null,
    };
    s.todos.push(todo);
    await this._write(s);
    return todo;
  }

  async update(id, patch) {
    const s = await this._read();
    const t = s.todos.find((x) => x.id === id);
    if (!t) throw new Error(`todo not found: ${id}`);
    if (patch.title) t.title = String(patch.title);
    if (patch.priority && PRIORITIES.includes(patch.priority)) t.priority = patch.priority;
    if (Array.isArray(patch.tags)) t.tags = patch.tags.map(String).slice(0, 8);
    if (patch.dueAt !== undefined) t.dueAt = patch.dueAt ? Number(patch.dueAt) : null;
    if (patch.completed !== undefined) {
      t.completed = !!patch.completed;
      t.completedAt = t.completed ? Date.now() : null;
    }
    await this._write(s);
    return t;
  }

  async toggle(id) {
    const s = await this._read();
    const t = s.todos.find((x) => x.id === id);
    if (!t) throw new Error(`todo not found: ${id}`);
    t.completed = !t.completed;
    t.completedAt = t.completed ? Date.now() : null;
    await this._write(s);
    return t;
  }

  async remove(id) {
    const s = await this._read();
    const before = s.todos.length;
    s.todos = s.todos.filter((t) => t.id !== id);
    await this._write(s);
    return s.todos.length !== before;
  }

  async clearCompleted() {
    const s = await this._read();
    const removed = s.todos.filter((t) => t.completed).length;
    s.todos = s.todos.filter((t) => !t.completed);
    await this._write(s);
    return removed;
  }
}
