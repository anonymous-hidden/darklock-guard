/**
 * Files IPC — read-only project file tree + read/write for the Coding tab.
 * Confined to `rootDir` (the nova-ai project root) for safety.
 */

import fs from 'fs/promises';
import path from 'path';

const IGNORE = new Set(['node_modules', '.git', 'dist', '.cache', '.next', '.vite', '__pycache__']);
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB

function safeJoin(rootDir, rel) {
  const full = path.resolve(rootDir, rel || '');
  if (!full.startsWith(path.resolve(rootDir))) {
    throw new Error('path escapes project root');
  }
  return full;
}

async function readDirRecursive(dir, relBase, depth) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.gitignore' && e.name !== '.env.example') continue;
    if (IGNORE.has(e.name)) continue;
    const rel = path.posix.join(relBase, e.name);
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const children = depth > 0 ? await readDirRecursive(full, rel, depth - 1) : [];
      out.push({ type: 'dir', name: e.name, path: rel, children });
    } else if (e.isFile()) {
      let size = 0;
      try { size = (await fs.stat(full)).size; } catch {}
      out.push({ type: 'file', name: e.name, path: rel, size });
    }
  }
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export function registerFilesIpc(ipcMain, { rootDir }) {
  ipcMain.handle('files:rootPath', async () => ({ ok: true, root: rootDir }));

  ipcMain.handle('files:listTree', async (_evt, relPath) => {
    try {
      const full = safeJoin(rootDir, relPath || '');
      const stat = await fs.stat(full);
      if (!stat.isDirectory()) return { ok: false, error: 'not a directory' };
      const tree = await readDirRecursive(full, relPath || '', 6);
      return { ok: true, tree };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('files:read', async (_evt, relPath) => {
    try {
      const full = safeJoin(rootDir, relPath);
      const stat = await fs.stat(full);
      if (!stat.isFile()) return { ok: false, error: 'not a file' };
      if (stat.size > MAX_FILE_BYTES) return { ok: false, error: 'file too large' };
      const content = await fs.readFile(full, 'utf8');
      return { ok: true, content, size: stat.size };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('files:write', async (_evt, payload) => {
    try {
      const { relPath, content } = payload || {};
      if (typeof relPath !== 'string' || typeof content !== 'string') {
        return { ok: false, error: 'invalid payload' };
      }
      const full = safeJoin(rootDir, relPath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, 'utf8');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
}
