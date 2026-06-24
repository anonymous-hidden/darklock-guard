/**
 * tools.js — central tool registry. Each entry exposes:
 *   - name        canonical dotted id, e.g. "system.volume.set"
 *   - category    grouping for the AI prompt
 *   - description what the tool does
 *   - args        JSON schema-lite for the AI's planning step
 *   - handler     async ({ args, ctx }) => result
 *
 * The TOOLS_MODE prompt is built dynamically from this registry so that
 * adding a new tool here automatically teaches Jarvis how to use it.
 */
import * as sc from './system-control.js';

const BUILTIN_WIDGETS = [
  { id: 'nova-call', name: 'Call Jarvis', aliases: ['jarvis-call', 'call'] },
  { id: 'nova-chat', name: 'Chat with Jarvis', aliases: ['jarvis-chat', 'chat'] },
  { id: 'widget-theme', name: 'Widget Themes' },
  { id: 'clock', name: 'Clock' },
  { id: 'calculator', name: 'Calculator' },
  { id: 'notes', name: 'Notes' },
  { id: 'todo', name: 'Todos' },
  { id: 'calendar', name: 'Calendar' },
  { id: 'emotions', name: 'Mood Journal' },
  { id: 'sysmon', name: 'System Monitor' },
  { id: 'spotify', name: 'Spotify' },
  { id: 'weather', name: 'Weather' },
  { id: 'map', name: 'Map' },
  { id: 'news', name: 'News' },
  { id: 'room-control', name: 'Room Control' },
  { id: 'quick-actions', name: 'Quick Actions' },
  { id: 'reminders', name: 'Reminders' },
  { id: 'clipboard', name: 'Clipboard' },
  { id: 'logs', name: 'Logs' },
];

function paramNames(args = {}) {
  return Object.entries(args || {}).reduce((acc, [key, type]) => {
    const optional = String(type || '').includes('?') || key.endsWith('?');
    acc[optional ? 'optional' : 'required'].push(key.replace(/\?$/, ''));
    return acc;
  }, { required: [], optional: [] });
}

function exampleForTool(tool) {
  const name = String(tool?.name || '');
  if (name.startsWith('notes.')) return 'use the notes widget for this';
  if (name.startsWith('widgets.')) return 'open the relevant widget';
  if (name.startsWith('maps.')) return 'show this place on the map';
  if (name.startsWith('weather.')) return 'check the weather';
  if (name.startsWith('spotify.')) return 'play music for me';
  if (name.startsWith('desktop.')) return 'use the desktop app';
  if (name.startsWith('terminal.')) return 'run this in the terminal';
  if (name.startsWith('web.')) return 'search the web for this';
  if (name.startsWith('room.')) return 'control my room lights';
  if (name.startsWith('apps.')) return 'open this app';
  return `use ${name}`;
}

function enrichTool(tool) {
  const params = paramNames(tool.args || {});
  return {
    requiredParameters: tool.requiredParameters || params.required,
    optionalParameters: tool.optionalParameters || params.optional,
    examples: tool.examples || [exampleForTool(tool)],
    combinable: tool.combinable !== false,
    requiresConfirmation: tool.requiresConfirmation ?? !!tool.danger,
    ...tool,
  };
}

export function buildToolRegistry({ notes, todos, reminders, broadcast, openWidget }) {
  /** @type {Array<{name:string,category:string,description:string,args:object,handler:Function,danger?:boolean}>} */
  const tools = [
    /* ---------- apps ---------- */
    { name: 'apps.open',  category: 'apps', description: 'Launch an application by name. Supports common aliases plus installed Linux .desktop apps, Flatpak apps, and executable paths.',
      args: { name: 'string', args: 'string[]?' },
      handler: ({ args }) => sc.openApp(args.name, args.args || []) },
    { name: 'apps.close', category: 'apps', description: 'Gracefully close/quit an app by name. Prefer this before force killing.',
      args: { name: 'string' }, handler: ({ args }) => sc.closeApp(args.name) },
    { name: 'apps.kill', category: 'apps', description: 'Force kill an app/process by name when close does not work.',
      args: { name: 'string' }, danger: true, handler: ({ args }) => sc.killApp(args.name) },
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
    { name: 'system.screenshot', category: 'system', description: 'Capture a screenshot. Optional region {x,y,w,h}. Saves to ~/Pictures/Jarvis Screenshots.',
      args: { region: 'object?' }, handler: ({ args }) => sc.takeScreenshot({ region: args?.region }) },

    /* ---------- power ---------- */
    { name: 'system.power', category: 'system', description: 'Power action: shutdown | restart | sleep | logout, with optional delay seconds.',
      args: { action: 'string', delaySec: 'number?' }, danger: true,
      handler: ({ args }) => sc.powerAction(args.action, { delaySec: args.delaySec || 0 }) },

    /* ---------- shell ---------- */
    { name: 'shell.run', category: 'shell', description: 'Run a shell command and return stdout/stderr. Subject to a safety blocklist.',
      args: { command: 'string', cwd: 'string?', timeoutMs: 'number?' }, danger: true,
      handler: ({ args }) => sc.runShell(args.command, { cwd: args.cwd, timeoutMs: args.timeoutMs }) },
    { name: 'terminal.open', category: 'shell', description: 'Open a real terminal, optionally running a command. Protected commands require the user to type RUN in that terminal. sudo/privilege escalation is blocked.',
      args: { command: 'string?', cwd: 'string?' }, danger: true,
      handler: ({ args }) => sc.openTerminal(args.command || '', { cwd: args.cwd }) },
    { name: 'terminal.ai', category: 'shell', description: 'Open a real terminal running Jarvis terminal AI, optionally with a task preloaded. Uses the same terminal safety layer.',
      args: { task: 'string?' }, danger: true,
      handler: ({ args, ctx }) => sc.openTerminalAi(args.task || '', { rootDir: ctx.rootDir }) },

    /* ---------- system stats ---------- */
    { name: 'system.stats', category: 'system', description: 'Snapshot of CPU%, RAM, disk, load, uptime.',
      args: {}, handler: () => sc.systemStats() },
    { name: 'location.current', category: 'location', description: 'Get Jarvis’s current location for weather, maps, and nearby data. Prefers saved/device location and only falls back to approximate IP.',
      args: {}, handler: () => sc.getCurrentLocation() },
    { name: 'location.set', category: 'location', description: 'Save the user’s real location by place name or coordinates so weather/maps stop using inaccurate IP location.',
      args: { location: 'string?', lat: 'number?', lon: 'number?', label: 'string?' },
      handler: ({ args }) => sc.setCurrentLocationOverride(args || {}) },
    { name: 'location.clear', category: 'location', description: 'Clear Jarvis’s saved location override and return to device/IP lookup.',
      args: {}, handler: () => sc.clearCurrentLocationOverride() },
    { name: 'weather.current', category: 'weather', description: 'Get current weather and a short forecast for a location. Use location="my location" for Jarvis’s approximate current location.',
      args: { location: 'string?' }, handler: ({ args }) => sc.weatherCurrent({ location: args?.location || 'my location' }) },
    { name: 'desktop.snapshot', category: 'system', description: 'See what is open on the desktop: active window, visible windows, running apps/processes, and optionally save a screenshot.',
      args: { includeScreenshot: 'boolean?' }, handler: ({ args }) => sc.desktopSnapshot({ includeScreenshot: !!args?.includeScreenshot }) },
    { name: 'desktop.read', category: 'desktop', description: 'Read the current desktop/app by taking a screenshot and OCR text when tesseract is installed. Returns active window, windows, apps, screenshot path, and OCR text.',
      args: { includeScreenshot: 'boolean?', ocr: 'boolean?' }, handler: ({ args }) => sc.desktopRead({ includeScreenshot: args?.includeScreenshot !== false, ocr: args?.ocr !== false }) },
    { name: 'desktop.focus', category: 'desktop', description: 'Focus a visible desktop window by app name or title before acting in it.',
      args: { app: 'string?', title: 'string?' }, handler: ({ args }) => sc.desktopFocus(args || {}) },
    { name: 'desktop.click', category: 'desktop', description: 'Click desktop coordinates in the active screen/window. Use desktop.read first if coordinates are not known.',
      args: { x: 'number', y: 'number', button: 'number?' }, handler: ({ args }) => sc.desktopClick(args || {}) },
    { name: 'desktop.type', category: 'desktop', description: 'Type text into the focused desktop app. In chat/social apps, do not include a trailing newline unless Cayden explicitly confirmed sending.',
      args: { text: 'string', delayMs: 'number?', confirmSend: 'boolean?' }, handler: ({ args }) => sc.desktopType(args || {}) },
    { name: 'desktop.key', category: 'desktop', description: 'Press a key or hotkey such as ctrl+l, Return, Escape, alt+Tab. Enter/Return is blocked in chat/social apps unless confirmSend is true.',
      args: { key: 'string', confirmSend: 'boolean?' }, danger: true, handler: ({ args }) => sc.desktopKey(args || {}) },
    { name: 'desktop.scroll', category: 'desktop', description: 'Scroll the focused desktop app. Negative amount scrolls down; positive scrolls up.',
      args: { amount: 'number' }, handler: ({ args }) => sc.desktopScroll(args || {}) },

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
    { name: 'web.fetchRaw', category: 'web', description: 'Fetch a URL and return the raw response body. Use for RSS/XML/API text when cleaned HTML would lose structure.',
      args: { url: 'string' }, handler: ({ args }) => sc.webFetchRaw(args.url) },

    /* ---------- maps ---------- */
    { name: 'maps.search', category: 'maps', description: 'Search for a location and move the map widget to the best match.',
      args: { query: 'string', limit: 'number?', zoom: 'number?', orbit: 'boolean?' }, handler: async ({ args }) => {
        const result = await sc.mapSearch(args.query, { limit: args.limit || 6 });
        const place = result?.places?.[0] || null;
        if (place) {
          try { openWidget?.('map'); } catch {}
          broadcast?.('map:focus', {
            query: args.query,
            place,
            zoom: Number(args.zoom) || 12,
            orbit: !!args.orbit,
          });
        }
        return result;
      } },
    { name: 'maps.directions', category: 'maps', description: 'Get driving directions between two locations and show the route in the map widget. Use from="my location" for the current approximate location.',
      args: { from: 'string', to: 'string' }, handler: async ({ args }) => {
        const result = await sc.mapDirections(args.from, args.to);
        if (result?.ok) {
          try { openWidget?.('map'); } catch {}
          broadcast?.('map:route', { route: result.route });
        }
        return result;
      } },

    /* ---------- news ---------- */
    { name: 'news.today', category: 'news', description: 'Refresh the News widget for a topic and return live search results for current headlines.',
      args: { topic: 'string?' }, handler: async ({ args }) => {
        const topic = args.topic || 'latest world technology security';
        try { openWidget?.('news'); } catch {}
        broadcast?.('news:refresh', { topic });
        return sc.webSearch(`${topic} latest news`, { limit: 10 });
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
    { name: 'notes.latest', category: 'notes', description: 'Read the most recently updated note, including content. Use this before finishing or continuing wording in the Notes widget.',
      args: {}, handler: async () => {
        const list = await notes.list();
        const first = Array.isArray(list) ? list[0] : null;
        return { ok: !!first, note: first ? await notes.get(first.id) : null, error: first ? '' : 'no notes found' };
      } },
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
    { name: 'widgets.list',    category: 'widgets', description: 'List every built-in widget Jarvis can dock, pop out, or close.',
      args: {}, handler: () => ({ ok: true, widgets: BUILTIN_WIDGETS }) },
    { name: 'widgets.snapshot', category: 'widgets', description: 'Read reliable state from widget-backed stores and system widgets (notes, todos, reminders, system, Spotify, room bridge).',
      args: {}, handler: async () => {
        const read = async (fn) => {
          try { return await fn(); } catch (e) { return { ok: false, error: String(e?.message || e) }; }
        };
        return {
          ok: true,
          widgets: BUILTIN_WIDGETS,
          notes: await read(async () => {
            const list = await notes.list();
            const first = Array.isArray(list) ? list[0] : null;
            return {
              list,
              latest: first ? await notes.get(first.id) : null,
            };
          }),
          todos: await read(() => todos.list({ includeCompleted: true })),
          reminders: await read(() => reminders.list()),
          system: await read(() => sc.systemStats()),
          desktop: await read(() => sc.desktopSnapshot({ includeScreenshot: false })),
          spotify: await read(() => sc.spotifyControl('now-playing')),
          room: await read(() => sc.roomControlRequest('/health')),
        };
      } },
    { name: 'widgets.dock',    category: 'widgets', description: 'Dock (open in main UI) a built-in widget by id. Use widgets.list if unsure.',
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
    { name: 'nova.tab', category: 'nova', description: 'Switch the main Jarvis window to a tab: chat | command-center | widget-studio | coding.',
      args: { tab: 'string' }, handler: ({ args }) => { broadcast?.('nova:tab', args.tab); return { ok: true }; } },
    { name: 'nova.say', category: 'nova', description: 'Display a status message in the Jarvis UI.',
      args: { message: 'string' }, handler: ({ args }) => { broadcast?.('nova:say', args.message); return { ok: true }; } },
  ];

  const enriched = tools.map(enrichTool);
  const byName = new Map(enriched.map((t) => [t.name, t]));
  return { tools: enriched, byName };
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
      const req = t.requiredParameters?.length ? ` required: [${t.requiredParameters.join(', ')}]` : '';
      const opt = t.optionalParameters?.length ? ` optional: [${t.optionalParameters.join(', ')}]` : '';
      const examples = t.examples?.length ? ` examples: ${t.examples.slice(0, 3).join(' | ')}` : '';
      out += `- **${t.name}** — ${t.description} ${argLine}${req}${opt}${t.requiresConfirmation ? ' [CONFIRM]' : ''}${examples}\n`;
    }
  }
  return out;
}
