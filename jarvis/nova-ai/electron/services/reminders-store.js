/**
 * reminders-store.js — timed reminders that fire as system notifications
 * and broadcast a 'reminder:fired' IPC event.
 */
import path from 'path';
import { promises as fs } from 'fs';
import crypto from 'crypto';

export class RemindersStore {
  constructor({ rootDir }) {
    this.file = path.join(rootDir, 'data', 'reminders.json');
    this.timers = new Map();
    this.onFire = null;
  }

  async _read() {
    try {
      const raw = await fs.readFile(this.file, 'utf-8');
      const j = JSON.parse(raw);
      return Array.isArray(j.reminders) ? j : { version: 1, reminders: [] };
    } catch {
      return { version: 1, reminders: [] };
    }
  }

  async _write(s) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(s, null, 2));
  }

  async list() {
    const s = await this._read();
    const now = Date.now();
    const active = s.reminders.filter((r) => !r.fired && Number(r.fireAt) > now);
    if (active.length !== s.reminders.length) {
      s.reminders = active;
      await this._write(s);
    }
    for (const r of active) this._schedule(r);
    return active.sort((a, b) => a.fireAt - b.fireAt);
  }

  async add({ message, fireAt, fromNow }) {
    if (!message) throw new Error('message required');
    let when = Number(fireAt);
    if (!when && fromNow) when = Date.now() + Number(fromNow);
    if (!when || when < Date.now()) throw new Error('fireAt must be in the future');
    const s = await this._read();
    const r = {
      id: `r_${crypto.randomBytes(5).toString('hex')}`,
      message: String(message),
      fireAt: when,
      createdAt: Date.now(),
      fired: false,
    };
    s.reminders.push(r);
    await this._write(s);
    this._schedule(r);
    return r;
  }

  async cancel(id) {
    const s = await this._read();
    s.reminders = s.reminders.filter((r) => r.id !== id);
    await this._write(s);
    const t = this.timers.get(id);
    if (t) { clearTimeout(t); this.timers.delete(id); }
    return true;
  }

  _schedule(r) {
    if (this.timers.has(r.id)) return;
    const ms = r.fireAt - Date.now();
    if (ms <= 0) return;
    const t = setTimeout(async () => {
      this.timers.delete(r.id);
      try { this.onFire?.(r); } catch {}
      // mark fired & purge
      const s = await this._read();
      s.reminders = s.reminders.filter((x) => x.id !== r.id);
      await this._write(s);
    }, Math.min(ms, 0x7fffffff));
    this.timers.set(r.id, t);
  }

  async startAll() {
    const s = await this._read();
    for (const r of s.reminders) this._schedule(r);
  }
}
