/**
 * Registers all "control plane" IPC channels:
 *   tools:list / tools:execute  — central tool dispatcher used by the AI
 *   notes:* / todos:* / reminders:*  — direct CRUD bridges (used by widgets)
 *   control:*  — direct system-control passthroughs
 */
import { NotesStore }     from '../services/notes-store.js';
import { TodosStore }     from '../services/todos-store.js';
import { RemindersStore } from '../services/reminders-store.js';
import { buildToolRegistry, describeTools } from '../services/tools.js';
import * as sc from '../services/system-control.js';

export function registerControlIpc(ipcMain, { rootDir, getMainWindow, openWidget, broadcast: broadcastAll }) {
  const notes     = new NotesStore({ rootDir });
  const todos     = new TodosStore({ rootDir });
  const reminders = new RemindersStore({ rootDir });

  reminders.onFire = (r) => {
    sc.notify({ title: 'Jarvis Reminder', body: r.message });
    const w = getMainWindow?.();
    if (w && !w.isDestroyed()) w.webContents.send('reminder:fired', r);
  };
  reminders.startAll().catch(() => {});

  const broadcast = (channel, payload) => {
    if (typeof broadcastAll === 'function') {
      broadcastAll(channel, payload);
      return;
    }
    const w = getMainWindow?.();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };

  const { tools, byName } = buildToolRegistry({ notes, todos, reminders, broadcast, openWidget });

  /* ---------------- TOOLS dispatcher ---------------- */

  ipcMain.handle('tools:list', () => ({
    ok: true,
    description: describeTools(tools),
    tools: tools.map((t) => ({ name: t.name, category: t.category, description: t.description, args: t.args, danger: !!t.danger })),
  }));

  ipcMain.handle('tools:execute', async (_evt, payload) => {
    const { name, args } = payload || {};
    const tool = byName.get(String(name || ''));
    if (!tool) return { ok: false, error: `unknown tool: ${name}` };
    try {
      const t0 = Date.now();
      const result = await tool.handler({ args: args || {}, ctx: { rootDir } });
      const dt = Date.now() - t0;
      return { ok: true, name, durationMs: dt, result };
    } catch (err) {
      return { ok: false, name, error: String(err?.message || err) };
    }
  });

  /* ---------------- Notes ---------------- */
  ipcMain.handle('notes:list',   () => notes.list());
  ipcMain.handle('notes:get',    (_e, id) => notes.get(id));
  ipcMain.handle('notes:create', (_e, p)  => notes.create(p || {}));
  ipcMain.handle('notes:update', (_e, p)  => notes.update(p.id, p));
  ipcMain.handle('notes:append', (_e, p)  => notes.append(p.id, p.text));
  ipcMain.handle('notes:delete', (_e, id) => notes.remove(id));
  ipcMain.handle('notes:search', (_e, q)  => notes.search(q));

  /* ---------------- Todos ---------------- */
  ipcMain.handle('todos:list',     (_e, opts) => todos.list(opts || {}));
  ipcMain.handle('todos:add',      (_e, p)    => todos.add(p || {}));
  ipcMain.handle('todos:update',   (_e, p)    => todos.update(p.id, p));
  ipcMain.handle('todos:toggle',   (_e, id)   => todos.toggle(id));
  ipcMain.handle('todos:delete',   (_e, id)   => todos.remove(id));
  ipcMain.handle('todos:clearCompleted', () => todos.clearCompleted());

  /* ---------------- Reminders ---------------- */
  ipcMain.handle('reminders:list',   () => reminders.list());
  ipcMain.handle('reminders:add',    (_e, p)  => reminders.add(p || {}));
  ipcMain.handle('reminders:cancel', (_e, id) => reminders.cancel(id));

  /* ---------------- Direct system passthroughs (used by widgets) ---------------- */
  ipcMain.handle('control:stats',         () => sc.systemStats());
  ipcMain.handle('control:volume:get',    () => sc.getVolume());
  ipcMain.handle('control:volume:set',    (_e, lv)   => sc.setVolume(lv));
  ipcMain.handle('control:volume:mute',   (_e, m)    => sc.setMute(m));
  ipcMain.handle('control:brightness:get',() => sc.getBrightness());
  ipcMain.handle('control:brightness:set',(_e, lv)   => sc.setBrightness(lv));
  ipcMain.handle('control:screenshot',    (_e, p)    => sc.takeScreenshot(p || {}));
  ipcMain.handle('control:spotify',       (_e, a)    => sc.spotifyControl(a));
  ipcMain.handle('control:openApp',       (_e, p)    => sc.openApp(p?.name, p?.args || []));
  ipcMain.handle('control:closeApp',      (_e, p)    => sc.closeApp(p?.name));
  ipcMain.handle('control:killApp',       (_e, p)    => sc.killApp(p?.name));
  ipcMain.handle('control:desktopSnapshot', (_e, p)  => sc.desktopSnapshot(p || {}));
  ipcMain.handle('control:desktopFocus',  (_e, p)    => sc.desktopFocus(p || {}));
  ipcMain.handle('control:desktopRead',   (_e, p)    => sc.desktopRead(p || {}));
  ipcMain.handle('control:desktopClick',  (_e, p)    => sc.desktopClick(p || {}));
  ipcMain.handle('control:desktopType',   (_e, p)    => sc.desktopType(p || {}));
  ipcMain.handle('control:desktopKey',    (_e, p)    => sc.desktopKey(p || {}));
  ipcMain.handle('control:desktopScroll', (_e, p)    => sc.desktopScroll(p || {}));
  ipcMain.handle('control:openPath',      (_e, t)    => sc.openPath(t));
  ipcMain.handle('control:shell',         (_e, p)    => sc.runShell(p?.command, p));
  ipcMain.handle('control:webSearch',     (_e, p)    => sc.webSearch(p?.query, p));
  ipcMain.handle('control:webFetch',      (_e, u)    => sc.webFetch(u));
  ipcMain.handle('control:webFetchRaw',   (_e, u)    => sc.webFetchRaw(u));
  ipcMain.handle('control:location',      (_e, p)    => sc.getCurrentLocation(p || {}));
  ipcMain.handle('control:location:set',  (_e, p)    => sc.setCurrentLocationOverride(p || {}));
  ipcMain.handle('control:location:clear',()         => sc.clearCurrentLocationOverride());
  ipcMain.handle('control:mapSearch',     (_e, p)    => sc.mapSearch(p?.query, p));
  ipcMain.handle('control:mapDirections', (_e, p)    => sc.mapDirections(p?.from, p?.to));
  ipcMain.handle('control:room',          (_e, p)    => sc.roomControlRequest(p?.path, p?.method || 'GET', p?.body || null));
  ipcMain.handle('control:power',         (_e, p)    => sc.powerAction(p?.action, p));
  ipcMain.handle('control:snap',          (_e, d)    => sc.snapWindow(d));
  ipcMain.handle('control:notify',        (_e, p)    => sc.notify(p || {}));
  ipcMain.handle('control:findFiles',     (_e, p)    => sc.findFiles(p || {}));
  ipcMain.handle('control:organizeDownloads', (_e, p) => sc.organizeDownloads(p || {}));

  // System logs (used by LogsWidget) — best-effort journalctl tail on Linux,
  // unified log on macOS, Get-EventLog on Windows.
  ipcMain.handle('control:systemLogs', async (_e, p) => {
    const lines = Math.max(10, Math.min(500, Number(p?.lines) || 100));
    try {
      if (process.platform === 'linux') {
        const r = await sc.runShell(`journalctl -n ${lines} --no-pager -o short 2>/dev/null || tail -n ${lines} /var/log/syslog 2>/dev/null || dmesg | tail -n ${lines}`);
        return { ok: true, lines: (r.stdout || '').split('\n').filter(Boolean) };
      }
      if (process.platform === 'darwin') {
        const r = await sc.runShell(`log show --last 5m --style compact 2>/dev/null | tail -n ${lines}`);
        return { ok: true, lines: (r.stdout || '').split('\n').filter(Boolean) };
      }
      if (process.platform === 'win32') {
        const r = await sc.runShell(`powershell -Command "Get-EventLog -LogName System -Newest ${lines} | Format-Table -AutoSize"`);
        return { ok: true, lines: (r.stdout || '').split('\n').filter(Boolean) };
      }
    } catch (e) {
      return { ok: false, error: String(e?.message || e), lines: [] };
    }
    return { ok: false, error: 'unsupported platform', lines: [] };
  });

  return { notes, todos, reminders, tools, byName };
}
