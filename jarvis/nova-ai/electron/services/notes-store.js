/**
 * notes-store.js — file-backed notes the AI can read/write.
 *
 * Notes live as plain markdown files in `<root>/data/notes/`.
 * IDs are slug + 6-char hex. Metadata lives in `index.json`.
 */
import path from 'path';
import { promises as fs } from 'fs';
import crypto from 'crypto';

function slug(s) {
  return String(s || 'note').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'note';
}

export class NotesStore {
  constructor({ rootDir }) {
    this.dir = path.join(rootDir, 'data', 'notes');
    this.indexFile = path.join(this.dir, 'index.json');
  }

  async _ensure() {
    await fs.mkdir(this.dir, { recursive: true });
    try { await fs.access(this.indexFile); }
    catch { await fs.writeFile(this.indexFile, JSON.stringify({ version: 1, notes: [] }, null, 2)); }
  }

  async _readIndex() {
    await this._ensure();
    const raw = await fs.readFile(this.indexFile, 'utf-8');
    try { return JSON.parse(raw); } catch { return { version: 1, notes: [] }; }
  }

  async _writeIndex(idx) {
    await fs.writeFile(this.indexFile, JSON.stringify(idx, null, 2));
  }

  async list() {
    const idx = await this._readIndex();
    return idx.notes.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id) {
    const idx = await this._readIndex();
    const meta = idx.notes.find((n) => n.id === id);
    if (!meta) return null;
    const file = path.join(this.dir, meta.file);
    let content = '';
    try { content = await fs.readFile(file, 'utf-8'); } catch {}
    return { ...meta, content };
  }

  async create({ title, content }) {
    const idx = await this._readIndex();
    const id = `n_${crypto.randomBytes(6).toString('hex')}`;
    const file = `${slug(title)}-${id.slice(2, 8)}.md`;
    const now = Date.now();
    const meta = { id, title: title || 'Untitled', file, createdAt: now, updatedAt: now };
    await fs.writeFile(path.join(this.dir, file), String(content || ''));
    idx.notes.push(meta);
    await this._writeIndex(idx);
    return { ...meta, content: String(content || '') };
  }

  async update(id, { title, content }) {
    const idx = await this._readIndex();
    const meta = idx.notes.find((n) => n.id === id);
    if (!meta) throw new Error(`note not found: ${id}`);
    if (title) meta.title = title;
    if (typeof content === 'string') {
      await fs.writeFile(path.join(this.dir, meta.file), content);
    }
    meta.updatedAt = Date.now();
    await this._writeIndex(idx);
    return this.get(id);
  }

  async append(id, text) {
    const cur = await this.get(id);
    if (!cur) throw new Error(`note not found: ${id}`);
    return this.update(id, { content: (cur.content || '') + '\n' + String(text || '') });
  }

  async remove(id) {
    const idx = await this._readIndex();
    const meta = idx.notes.find((n) => n.id === id);
    if (!meta) return false;
    try { await fs.unlink(path.join(this.dir, meta.file)); } catch {}
    idx.notes = idx.notes.filter((n) => n.id !== id);
    await this._writeIndex(idx);
    return true;
  }

  async search(query) {
    const q = String(query || '').toLowerCase();
    if (!q) return [];
    const all = await this.list();
    const hits = [];
    for (const meta of all) {
      const file = path.join(this.dir, meta.file);
      let content = '';
      try { content = await fs.readFile(file, 'utf-8'); } catch {}
      if (meta.title.toLowerCase().includes(q) || content.toLowerCase().includes(q)) {
        hits.push({ ...meta, snippet: extractSnippet(content, q) });
      }
    }
    return hits;
  }
}

function extractSnippet(text, q) {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text.slice(0, 160);
  const start = Math.max(0, i - 60);
  const end = Math.min(text.length, i + q.length + 60);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}
