/**
 * Nova AI — Preload (CommonJS, runs in isolated world)
 * Exposes a single `window.nova` bridge to the renderer.
 */
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);
const on = (channel, cb) => {
  const handler = (_evt, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('nova', {
  platform: process.platform,
  isElectron: true,

  ai: {
    /** Probe Ollama and return list of available models. */
    listModels: () => invoke('ai:listModels'),
    /** Health-check Ollama (returns { ok, version, error? }). */
    health:     () => invoke('ai:health'),
  },

  widgets: {
    list:    ()           => invoke('widgets:list'),
    save:    (widget)     => invoke('widgets:save', widget),
    delete:  (id)         => invoke('widgets:delete', id),
    read:    (id)         => invoke('widgets:read', id),
    popout:  (payload)    => invoke('widget:popout', payload),
    closePopout: (id)     => invoke('widget:popout:close', id),
  },

  files: {
    listTree:  (relPath) => invoke('files:listTree', relPath || ''),
    read:      (relPath) => invoke('files:read', relPath),
    write:     (relPath, content) => invoke('files:write', { relPath, content }),
    rootPath:  ()         => invoke('files:rootPath'),
  },

  system: {
    info: () => invoke('system:info'),
    onTerminalLine: (cb) => on('system:terminalLine', cb),
  },

  /* ---------------- AI tool calls ---------------- */
  tools: {
    list:    () => invoke('tools:list'),
    execute: (name, args) => invoke('tools:execute', { name, args }),
  },

  /* ---------------- Notes ---------------- */
  notes: {
    list:   () => invoke('notes:list'),
    get:    (id) => invoke('notes:get', id),
    create: (p)  => invoke('notes:create', p),
    update: (p)  => invoke('notes:update', p),
    append: (id, text) => invoke('notes:append', { id, text }),
    delete: (id) => invoke('notes:delete', id),
    search: (q)  => invoke('notes:search', q),
  },

  /* ---------------- Todos ---------------- */
  todos: {
    list:           (opts) => invoke('todos:list', opts || {}),
    add:            (p)    => invoke('todos:add', p),
    update:         (p)    => invoke('todos:update', p),
    toggle:         (id)   => invoke('todos:toggle', id),
    delete:         (id)   => invoke('todos:delete', id),
    clearCompleted: ()     => invoke('todos:clearCompleted'),
  },

  /* ---------------- Reminders ---------------- */
  reminders: {
    list:   () => invoke('reminders:list'),
    add:    (p)  => invoke('reminders:add', p),
    cancel: (id) => invoke('reminders:cancel', id),
    onFired: (cb) => on('reminder:fired', cb),
  },

  /* ---------------- Direct controls (used by widgets) ---------------- */
  control: {
    stats:      () => invoke('control:stats'),
    volume: {
      get:  ()      => invoke('control:volume:get'),
      set:  (level) => invoke('control:volume:set', level),
      mute: (m)     => invoke('control:volume:mute', m),
    },
    brightness: {
      get: ()       => invoke('control:brightness:get'),
      set: (level)  => invoke('control:brightness:set', level),
    },
    screenshot:        (p)            => invoke('control:screenshot', p || {}),
    spotify:           (action)       => invoke('control:spotify', action),
    openApp:           (name, args)   => invoke('control:openApp', { name, args }),
    openPath:          (t)            => invoke('control:openPath', t),
    shell:             (command, opts)=> invoke('control:shell', { command, ...(opts || {}) }),
    webSearch:         (query, limit) => invoke('control:webSearch', { query, limit }),
    webFetch:          (url)          => invoke('control:webFetch', url),
    map: {
      search:     (query, limit) => invoke('control:mapSearch', { query, limit }),
      directions: (from, to)     => invoke('control:mapDirections', { from, to }),
    },
    power:             (action, delaySec) => invoke('control:power', { action, delaySec }),
    snap:              (direction)    => invoke('control:snap', direction),
    notify:            (p)            => invoke('control:notify', p),
    findFiles:         (p)            => invoke('control:findFiles', p),
    organizeDownloads: (p)            => invoke('control:organizeDownloads', p || {}),
    systemLogs:        (p)            => invoke('control:systemLogs', p || {}),
  },

  /* ---------------- UI broadcasts (main → renderer) ---------------- */
  ui: {
    onWidgetDock:   (cb) => on('widgets:dock', cb),
    onWidgetPopout: (cb) => on('widgets:popout', cb),
    onWidgetClose:  (cb) => on('widgets:close', cb),
    onMapFocus:     (cb) => on('map:focus', cb),
    onMapRoute:     (cb) => on('map:route', cb),
    onNewsRefresh:  (cb) => on('news:refresh', cb),
    onTabChange:    (cb) => on('nova:tab', cb),
    onSay:          (cb) => on('nova:say', cb),
  },

  /* ---------------- Current-window controls ---------------- */
  win: {
    alwaysOnTop: {
      toggle:   () => invoke('win:alwaysOnTop:toggle'),
      get:      () => invoke('win:alwaysOnTop:get'),
      onChange: (cb) => on('win:alwaysOnTop:changed', cb),
    },
    minimize: () => ipcRenderer.send('win:minimize'),
    close:    () => ipcRenderer.invoke('win:close'),
  },

  /* ---------------- Cross-widget bus ---------------- */
  bus: {
    publish:   (channel, payload) => ipcRenderer.send('nova:bus:publish', { channel, payload }),
    subscribe: (channel, cb) => {
      const handler = (_evt, evt) => {
        if (!evt || evt.channel !== channel) return;
        try { cb(evt.payload, evt); } catch {}
      };
      ipcRenderer.on('nova:bus:event', handler);
      return () => ipcRenderer.removeListener('nova:bus:event', handler);
    },
    /** Subscribe to all bus events (rare). */
    subscribeAll: (cb) => {
      const handler = (_evt, evt) => { try { cb(evt); } catch {} };
      ipcRenderer.on('nova:bus:event', handler);
      return () => ipcRenderer.removeListener('nova:bus:event', handler);
    },
  },
});
