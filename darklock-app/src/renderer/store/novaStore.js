import { create } from 'zustand';

const NOVA_API = 'http://127.0.0.1:8950/api';
const NOVA_WS = 'ws://127.0.0.1:8950/ws';

export const useNovaStore = create((set, get) => ({
  // Connection
  connected: false,
  ws: null,
  reconnectTimer: null,

  // Nova's brain state
  emotion: null,          // { mood, energy, curiosity, patience, satisfaction, warmth }
  thoughtStream: [],      // live token stream from Nova's thinking
  currentThought: '',     // what Nova is currently generating
  isThinking: false,

  // Data panels
  memories: [],           // user facts Nova remembers
  recentMemories: [],     // recent memory extractions
  tasks: [],              // tracked goals/tasks
  conversations: [],      // conversation history
  alerts: [],             // security/system alerts
  unreadAlerts: 0,
  securityStatus: null,   // process watcher + integrity
  settings: null,         // models, personality, tone
  systemHealth: null,     // health check data
  integrationStatus: {},  // which integrations are active
  auditLog: [],           // recent audit entries
  learningStats: null,    // feedback/training stats
  projectOverview: null,  // indexed project data

  // Chat with Nova from Command Center
  commandCenterMessages: [],
  commandCenterConvId: null,

  // ── WebSocket connection ──
  connectWs: () => {
    const existing = get().ws;
    if (existing && existing.readyState <= 1) return;

    try {
      const ws = new WebSocket(NOVA_WS);

      ws.onopen = () => {
        set({ connected: true, ws });
        console.log('[Nova WS] Connected');
        // Fetch initial data
        get().fetchAll();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const state = get();

          switch (data.type) {
            case 'token':
              set({
                isThinking: true,
                currentThought: state.currentThought + (data.content || ''),
                thoughtStream: [
                  ...state.thoughtStream.slice(-200),
                  { type: 'token', content: data.content, ts: Date.now() }
                ]
              });
              break;

            case 'done':
              set({
                isThinking: false,
                thoughtStream: [
                  ...state.thoughtStream.slice(-200),
                  { type: 'done', content: data.full_response, ts: Date.now() }
                ],
                currentThought: ''
              });
              break;

            case 'emotion':
              set({ emotion: data });
              break;

            case 'alert':
              set({
                alerts: [data, ...state.alerts].slice(0, 100),
                unreadAlerts: state.unreadAlerts + 1
              });
              break;

            case 'proactive':
              set({
                thoughtStream: [
                  ...state.thoughtStream.slice(-200),
                  { type: 'proactive', content: data.message || data.content, ts: Date.now() }
                ]
              });
              break;

            case 'state':
              set({
                thoughtStream: [
                  ...state.thoughtStream.slice(-200),
                  { type: 'state', content: `Nova is now ${data.state}`, ts: Date.now() }
                ]
              });
              break;
          }
        } catch { /* ignore parse errors */ }
      };

      ws.onclose = () => {
        set({ connected: false, ws: null });
        console.log('[Nova WS] Disconnected, retrying in 5s...');
        const timer = setTimeout(() => get().connectWs(), 5000);
        set({ reconnectTimer: timer });
      };

      ws.onerror = () => {
        set({ connected: false });
      };
    } catch {
      set({ connected: false });
      const timer = setTimeout(() => get().connectWs(), 5000);
      set({ reconnectTimer: timer });
    }
  },

  disconnectWs: () => {
    const { ws, reconnectTimer } = get();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) ws.close();
    set({ ws: null, connected: false, reconnectTimer: null });
  },

  // ── REST API helpers ──
  _fetch: async (path) => {
    try {
      const res = await fetch(`${NOVA_API}${path}`);
      if (res.ok) return await res.json();
    } catch { /* Nova may be offline */ }
    return null;
  },

  _post: async (path, body = {}) => {
    try {
      const res = await fetch(`${NOVA_API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) return await res.json();
    } catch { /* Nova may be offline */ }
    return null;
  },

  // ── Fetch all data ──
  fetchAll: async () => {
    const { _fetch } = get();
    const [emotion, settings, memories, recentMem, tasks, alerts, alertCount,
           security, audit, health, learning, projectOverview, conversations, integrations] = await Promise.all([
      _fetch('/emotion'),
      _fetch('/settings'),
      _fetch('/memory/profile'),
      _fetch('/memory/recent?count=30'),
      _fetch('/tasks'),
      _fetch('/alerts?count=30'),
      _fetch('/alerts/count'),
      _fetch('/security/status'),
      _fetch('/audit?count=30'),
      _fetch('/health'),
      _fetch('/learning/stats'),
      _fetch('/index/overview'),
      _fetch('/conversations'),
      _fetch('/integrations/status'),
    ]);

    set({
      emotion: emotion?.state
        ? { ...emotion.state, dominant_feeling: emotion.feeling }
        : (emotion || get().emotion),
      settings: settings || get().settings,
      memories: memories ? (Array.isArray(memories) ? memories : Object.entries(memories).map(([k, v]) => ({ key: k, value: v }))) : [],
      recentMemories: recentMem || [],
      tasks: tasks || [],
      alerts: alerts || [],
      unreadAlerts: alertCount?.unread || 0,
      securityStatus: security || null,
      auditLog: audit || [],
      systemHealth: health || null,
      learningStats: learning || null,
      projectOverview: projectOverview?.overview || null,
      conversations: conversations || [],
      integrationStatus: integrations || {},
    });
  },

  // ── Individual refresh actions ──
  refreshEmotion: async () => {
    const data = await get()._fetch('/emotion');
    if (data) {
      // API returns { state: {...}, feeling: "...", greeting: "..." }
      set({
        emotion: data.state
          ? { ...data.state, dominant_feeling: data.feeling }
          : data
      });
    }
  },

  refreshTasks: async () => {
    const data = await get()._fetch('/tasks');
    if (data) set({ tasks: data });
  },

  refreshAlerts: async () => {
    const [alerts, count] = await Promise.all([
      get()._fetch('/alerts?count=30'),
      get()._fetch('/alerts/count'),
    ]);
    if (alerts) set({ alerts });
    if (count) set({ unreadAlerts: count.unread || 0 });
  },

  refreshSecurity: async () => {
    const data = await get()._fetch('/security/status');
    if (data) set({ securityStatus: data });
  },

  refreshMemories: async () => {
    const [profile, recent] = await Promise.all([
      get()._fetch('/memory/profile'),
      get()._fetch('/memory/recent?count=30'),
    ]);
    if (profile) {
      set({
        memories: Array.isArray(profile) ? profile : Object.entries(profile).map(([k, v]) => ({ key: k, value: v }))
      });
    }
    if (recent) set({ recentMemories: recent });
  },

  // ── Actions ──
  ackAllAlerts: async () => {
    await get()._post('/alerts/ack-all');
    set({ unreadAlerts: 0 });
    get().refreshAlerts();
  },

  addTask: async (title, description = '', priority = 'medium') => {
    await get()._post('/tasks', { title, description, priority });
    get().refreshTasks();
  },

  updateTask: async (tid, status) => {
    try {
      await fetch(`${NOVA_API}/tasks/${tid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
    } catch { /* offline */ }
    get().refreshTasks();
  },

  setModelMode: async (mode) => {
    await get()._post('/models/mode', { mode });
    const settings = await get()._fetch('/settings');
    if (settings) set({ settings });
  },

  rescanIntegrity: async () => {
    const result = await get()._post('/security/integrity/rescan');
    get().refreshSecurity();
    return result;
  },

  searchMemories: async (query) => {
    const data = await get()._fetch(`/memory/search?q=${encodeURIComponent(query)}`);
    return data || [];
  },

  // Chat from Command Center
  sendMessage: async (message) => {
    const state = get();
    const convId = state.commandCenterConvId;
    set({
      commandCenterMessages: [
        ...state.commandCenterMessages,
        { role: 'user', content: message, ts: Date.now() }
      ],
      isThinking: true,
    });

    const result = await get()._post('/chat', {
      message,
      conversation_id: convId || undefined,
    });

    if (result) {
      set({
        commandCenterMessages: [
          ...get().commandCenterMessages,
          { role: 'assistant', content: result.response, ts: Date.now() }
        ],
        commandCenterConvId: result.conversation_id,
        isThinking: false,
      });
      // Refresh emotion after chat
      get().refreshEmotion();
    } else {
      set({ isThinking: false });
    }
  },

  // Polling for live data updates
  _pollInterval: null,
  startPolling: () => {
    const existing = get()._pollInterval;
    if (existing) return;
    const interval = setInterval(() => {
      get().refreshEmotion();
      get().refreshAlerts();
    }, 10000); // every 10 seconds
    set({ _pollInterval: interval });
  },
  stopPolling: () => {
    const interval = get()._pollInterval;
    if (interval) clearInterval(interval);
    set({ _pollInterval: null });
  },
}));
