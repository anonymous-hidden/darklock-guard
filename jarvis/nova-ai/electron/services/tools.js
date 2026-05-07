/**
 * tools.js — central tool registry. Each entry exposes:
 *   - name        canonical dotted id, e.g. "system.volume.set"
 *   - category    grouping for the AI prompt
 *   - description what the tool does
 *   - args        JSON schema-lite for the AI's planning step
 *   - handler     async ({ args, ctx }) => result
 *
 * The TOOLS_MODE prompt is built dynamically from this registry so that
 * adding a new tool here automatically teaches Nova how to use it.
 */
import * as sc from './system-control.js';

export function buildToolRegistry({ notes, todos, reminders, broadcast, openWidget }) {
  /** @type {Array<{name:string,category:string,description:string,args:object,handler:Function,danger?:boolean}>} */
  const tools = [
    /* ---------- apps ---------- */
    { name: 'apps.open',  category: 'apps', description: 'Launch an application by name (chrome, vscode, spotify, terminal, files, discord, slack, firefox) or executable path.',
      args: { name: 'string', args: 'string[]?' },
      handler: ({ args }) => sc.openApp(args.name, args.args || []) },
    { name: 'apps.close', category: 'apps', description: 'Close/quit an app by name.',
      args: { name: 'string' }, handler: ({ args }) => sc.closeApp(args.name) },
    { name: 'apps.openPath', category: 'apps', description: 'Open a file path or URL in the default handler.',
      args: { target: 'string' }, handler: ({ args }) => sc.openPath(args.target) },

    /* ---------- volume / audio ---------- */
    { name: 'system.volume.get', category: 'system', description: 'Get current system volume (0-100) and mute state.',
      args: {}, handler: () => sc.getVolume() },
    { name: 'system.volume.set', category: 'system', description: 'Set system volume to a level 0-100.',
      args: { level: 'number' }, handler: ({ args }) => sc.setVolume(args.level) },
    { name: 'system.volume.mute', category: 'system', description: 'Mute or unmute the default sink.',
      args: { mute: 'boolean' }, handler: ({ args }) => sc.setMute(!!args.mute) },

    /* ---------- brightness ---------- */
    { name: 'system.brightness.get', category: 'system', description: 'Get screen brightness percent.',
      args: {}, handler: () => sc.getBrightness() },
    { name: 'system.brightness.set', category: 'system', description: 'Set screen brightness percent (1-100).',
      args: { level: 'number' }, handler: ({ args }) => sc.setBrightness(args.level) },

    /* ---------- screenshot ---------- */
    { name: 'system.screenshot', category: 'system', description: 'Capture a screenshot. Optional region {x,y,w,h}. Saves to ~/Pictures/Nova Screenshots.',
      args: { region: 'object?' }, handler: ({ args }) => sc.takeScreenshot({ region: args?.region }) },

    /* ---------- power ---------- */
    { name: 'system.power', category: 'system', description: 'Power action: shutdown | restart | sleep | logout, with optional delay seconds.',
      args: { action: 'string', delaySec: 'number?' }, danger: true,
      handler: ({ args }) => sc.powerAction(args.action, { delaySec: args.delaySec || 0 }) },

    /* ---------- shell ---------- */
    { name: 'shell.run', category: 'shell', description: 'Run a shell command and return stdout/stderr. Subject to a safety blocklist.',
      args: { command: 'string', cwd: 'string?', timeoutMs: 'number?' }, danger: true,
      handler: ({ args }) => sc.runShell(args.command, { cwd: args.cwd, timeoutMs: args.timeoutMs }) },

    /* ---------- system stats ---------- */
    { name: 'system.stats', category: 'system', description: 'Snapshot of CPU%, RAM, disk, load, uptime.',
      args: {}, handler: () => sc.systemStats() },

    /* ---------- window control ---------- */
    { name: 'window.snap', category: 'window', description: 'Snap focused window: left|right|top|bottom|maximize|minimize|restore|fullscreen.',
      args: { direction: 'string' }, handler: ({ args }) => sc.snapWindow(args.direction) },

    /* ---------- files ---------- */
    { name: 'files.search', category: 'files', description: 'Find files by name across a root (default $HOME).',
      args: { query: 'string', root: 'string?', type: 'string?', maxResults: 'number?' }, handler: ({ args }) => sc.findFiles(args) },
    { name: 'files.organizeDownloads', category: 'files', description: 'Sort the Downloads folder into subfolders by file type.',
      args: { dir: 'string?' }, handler: ({ args }) => sc.organizeDownloads({ dir: args?.dir }) },

    /* ---------- web ---------- */
    { name: 'web.search', category: 'web', description: 'DuckDuckGo web search; returns top results with title/url/snippet.',
      args: { query: 'string', limit: 'number?' }, handler: ({ args }) => sc.webSearch(args.query, { limit: args.limit }) },
    { name: 'web.fetch', category: 'web', description: 'Fetch a URL and return cleaned text content (max 12k chars).',
      args: { url: 'string' }, handler: ({ args }) => sc.webFetch(args.url) },

    /* ---------- maps ---------- */
    { name: 'maps.search', category: 'maps', description: 'Search for a location and move the map widget to the best match.',
      args: { query: 'string', limit: 'number?' }, handler: async ({ args }) => {
        const result = await sc.mapSearch(args.query, { limit: args.limit || 6 });
        const place = result?.places?.[0] || null;
        if (place) broadcast?.('map:focus', { query: args.query, place, zoom: 12 });
        return result;
      } },
    { name: 'maps.directions', category: 'maps', description: 'Get driving directions between two locations and show the route in the map widget.',
      args: { from: 'string', to: 'string' }, handler: async ({ args }) => {
        const result = await sc.mapDirections(args.from, args.to);
        if (result?.ok) broadcast?.('map:route', { route: result.route });
        return result;
      } },

    /* ---------- news ---------- */
    { name: 'news.today', category: 'news', description: 'Generate today’s news brief from live search results and refresh the news widget.',
      args: { topic: 'string?' }, handler: async ({ args }) => {
        const topic = args.topic || 'top world technology security news today';
        broadcast?.('news:refresh', { topic });
        return sc.webSearch(topic, { limit: 10 });
      } },

    /* ---------- spotify ---------- */
    { name: 'spotify.control', category: 'media', description: 'Control Spotify: play|pause|toggle|next|previous|now-playing.',
      args: { action: 'string' }, handler: ({ args }) => sc.spotifyControl(args.action) },

    /* ---------- room control ---------- */
    { name: 'room.status', category: 'room', description: 'Check Darklock room-control bridge, Pico, and light status.',
      args: {}, handler: () => sc.roomControlRequest('/health') },
    { name: 'room.lights', category: 'room', description: 'Control room lights. action: on|off|color|brightness|scene.',
      args: { action: 'string', color: 'string?', brightness: 'number?', scene: 'string?' }, handler: ({ args }) => sc.roomControlLights(args) },
    { name: 'room.buzzer', category: 'room', description: 'Sound or stop the room buzzer. action: beep|song|stop.',
      args: { action: 'string', ms: 'number?', song: 'string?' }, handler: ({ args }) => sc.roomControlBuzzer(args) },

    /* ---------- notifications ---------- */
    { name: 'system.notify', category: 'system', description: 'Show a desktop notification.',
      args: { title: 'string', body: 'string?' }, handler: ({ args }) => sc.notify(args) },

    /* ---------- notes ---------- */
    { name: 'notes.list',   category: 'notes', description: 'List all notes (id, title, updatedAt).',                                  args: {}, handler: async () => ({ ok: true, notes: await notes.list() }) },
    { name: 'notes.read',   category: 'notes', description: 'Read a note by id.',                                                     args: { id: 'string' }, handler: async ({ args }) => ({ ok: true, note: await notes.get(args.id) }) },
    { name: 'notes.create', category: 'notes', description: 'Create a new note.',                                                     args: { title: 'string', content: 'string?' }, handler: async ({ args }) => ({ ok: true, note: await notes.create(args) }) },
    { name: 'notes.update', category: 'notes', description: 'Update a note (replace content and/or title).',                          args: { id: 'string', title: 'string?', content: 'string?' }, handler: async ({ args }) => ({ ok: true, note: await notes.update(args.id, args) }) },
    { name: 'notes.append', category: 'notes', description: 'Append text to an existing note.',                                       args: { id: 'string', text: 'string' }, handler: async ({ args }) => ({ ok: true, note: await notes.append(args.id, args.text) }) },
    { name: 'notes.delete', category: 'notes', description: 'Delete a note by id.',                                                   args: { id: 'string' }, handler: async ({ args }) => ({ ok: !!(await notes.remove(args.id)) }) },
    { name: 'notes.search', category: 'notes', description: 'Search notes by content/title.',                                         args: { query: 'string' }, handler: async ({ args }) => ({ ok: true, hits: await notes.search(args.query) }) },

    /* ---------- todos ---------- */
    { name: 'todos.list',     category: 'todos', description: 'List all todos.',                                                       args: { includeCompleted: 'boolean?' }, handler: async ({ args }) => ({ ok: true, todos: await todos.list(args || {}) }) },
    { name: 'todos.add',      category: 'todos', description: 'Add a todo.',                                                           args: { title: 'string', priority: 'string?', dueAt: 'number?', tags: 'string[]?' }, handler: async ({ args }) => ({ ok: true, todo: await todos.add(args) }) },
    { name: 'todos.toggle',   category: 'todos', description: 'Toggle a todo completed/uncompleted.',                                  args: { id: 'string' }, handler: async ({ args }) => ({ ok: true, todo: await todos.toggle(args.id) }) },
    { name: 'todos.update',   category: 'todos', description: 'Update fields on a todo.',                                              args: { id: 'string', title: 'string?', priority: 'string?', dueAt: 'number?', tags: 'string[]?' }, handler: async ({ args }) => ({ ok: true, todo: await todos.update(args.id, args) }) },
    { name: 'todos.delete',   category: 'todos', description: 'Delete a todo.',                                                        args: { id: 'string' }, handler: async ({ args }) => ({ ok: !!(await todos.remove(args.id)) }) },
    { name: 'todos.clearCompleted', category: 'todos', description: 'Clear all completed todos.',                                       args: {}, handler: async () => ({ ok: true, removed: await todos.clearCompleted() }) },

    /* ---------- reminders ---------- */
    { name: 'reminders.list',   category: 'reminders', description: 'List active reminders.',                                          args: {}, handler: async () => ({ ok: true, reminders: await reminders.list() }) },
    { name: 'reminders.add',    category: 'reminders', description: 'Add a reminder. Provide either fireAt (ms epoch) or fromNow (ms).', args: { message: 'string', fireAt: 'number?', fromNow: 'number?' }, handler: async ({ args }) => ({ ok: true, reminder: await reminders.add(args) }) },
    { name: 'reminders.cancel', category: 'reminders', description: 'Cancel a reminder.',                                              args: { id: 'string' }, handler: async ({ args }) => ({ ok: !!(await reminders.cancel(args.id)) }) },

    /* ---------- widgets (control built-ins) ---------- */
    { name: 'widgets.dock',    category: 'widgets', description: 'Dock (open in main UI) a built-in widget by id (clock, calculator, notes, todo, calendar, map, news, room-control, sysmon, spotify, weather).',
      args: { id: 'string' }, handler: ({ args }) => { broadcast?.('widgets:dock', args.id); return { ok: true }; } },
    { name: 'widgets.popout',  category: 'widgets', description: 'Pop a built-in widget into its own desktop window.',
      args: { id: 'string' }, handler: ({ args }) => {
        broadcast?.('widgets:popout', args.id);
        try { openWidget?.(args.id); } catch {}
        return { ok: true };
      } },
    { name: 'widgets.close',   category: 'widgets', description: 'Close/undock a docked built-in widget.',
      args: { id: 'string' }, handler: ({ args }) => { broadcast?.('widgets:close', args.id); return { ok: true }; } },

    /* ---------- nova UI (navigation) ---------- */
    { name: 'nova.tab', category: 'nova', description: 'Switch the main Nova window to a tab: chat | command-center | widget-studio | coding.',
      args: { tab: 'string' }, handler: ({ args }) => { broadcast?.('nova:tab', args.tab); return { ok: true }; } },
    { name: 'nova.say', category: 'nova', description: 'Display a status message in the Nova UI.',
      args: { message: 'string' }, handler: ({ args }) => { broadcast?.('nova:say', args.message); return { ok: true }; } },
  ];

  const byName = new Map(tools.map((t) => [t.name, t]));
  return { tools, byName };
}

/**
 * Build the tool description block injected into the AI system prompt.
 */
export function describeTools(tools) {
  const groups = {};
  for (const t of tools) {
    if (!groups[t.category]) groups[t.category] = [];
    groups[t.category].push(t);
  }
  let out = '';
  for (const [cat, list] of Object.entries(groups)) {
    out += `\n## ${cat}\n`;
    for (const t of list) {
      const argLine = Object.keys(t.args || {}).length
        ? `args: { ${Object.entries(t.args).map(([k, v]) => `${k}: ${v}`).join(', ')} }`
        : 'args: {}';
      out += `- **${t.name}** — ${t.description} ${argLine}${t.danger ? ' [DANGER]' : ''}\n`;
    }
  }
  return out;
}
