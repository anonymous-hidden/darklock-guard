/**
 * Bot Console - Real-time log viewer
 * Connects to WebSocket with authentication and displays console messages
 * Saves state to localStorage for persistence
 */
(() => {
  const consoleWindow = document.getElementById('consoleWindow');
  const pauseBtn = document.getElementById('pauseBtn');
  const clearBtn = document.getElementById('clearBtn');
  const downloadBtn = document.getElementById('downloadBtn');

  // Detect guildId from query string or global
  const urlParams = new URLSearchParams(window.location.search);
  const guildId = window.guildId || urlParams.get('guildId') || null;

  // Storage keys
  const STORAGE_KEY = guildId ? `console-state-${guildId}` : 'console-state-global';
  const MAX_SAVED_LINES = 500; // Limit how many lines to save

  let paused = false;
  let buffer = [];
  let socket = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 10;
  
  // Array to track messages for persistence
  let savedMessages = [];

  // Load saved state from localStorage
  function loadSavedState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const state = JSON.parse(saved);
        savedMessages = state.messages || [];
        paused = state.paused || false;
        
        // Restore paused state
        if (paused && pauseBtn) {
          pauseBtn.textContent = 'Resume';
        }
        
        // Restore messages
        savedMessages.forEach(msg => {
          appendLineInternal(msg.text, msg.level, false); // Don't re-save
        });
        
        if (savedMessages.length > 0) {
          appendLineInternal(`[Console] Restored ${savedMessages.length} saved messages`, 'info', false);
        }
      }
    } catch (e) {
      console.warn('Failed to load console state:', e);
    }
  }

  // Save current state to localStorage
  function saveState() {
    try {
      // Limit saved messages to prevent storage bloat
      const messagesToSave = savedMessages.slice(-MAX_SAVED_LINES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        messages: messagesToSave,
        paused: paused,
        lastSaved: Date.now()
      }));
    } catch (e) {
      // Storage full or unavailable - fail silently
    }
  }

  // Debounced save to prevent excessive writes
  let saveTimeout = null;
  function debouncedSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveState, 1000);
  }

  // Expose handler for dashboard-pro to call when it receives botConsole packets
  window.addConsoleMessage = function(msg) {
    try {
      const ts = msg.timestamp ? (new Date(msg.timestamp)).toLocaleString() : new Date().toLocaleString();
      const level = msg.level || (msg.eventType ? 'event' : 'info');
      const guildPart = msg.guildId ? `[${msg.guildId.slice(0, 8)}...] ` : '';
      const text = msg.message || msg.eventType || '';
      appendLine(`${ts} ${guildPart}${text}`, level);
    } catch (e) {
      // ignore
    }
  };

  // Internal append without saving (for restore)
  function appendLineInternal(text, level = 'info', shouldSave = true) {
    if (paused) { buffer.push({ text, level }); return; }
    const el = document.createElement('div');
    el.className = 'console-line';
    el.textContent = text;
    // Color by level
    if (level === 'info') el.style.color = '#d6e4ff';
    else if (level === 'event') el.style.color = '#00ff41';
    else if (level === 'warn') el.style.color = '#ffd166';
    else if (level === 'error') el.style.color = '#ff6b6b';
    consoleWindow.appendChild(el);
    // Auto-scroll
    consoleWindow.scrollTop = consoleWindow.scrollHeight;
    // Limit DOM nodes
    const maxLines = 5000;
    while (consoleWindow.children.length > maxLines) {
      consoleWindow.removeChild(consoleWindow.firstChild);
      savedMessages.shift(); // Remove from saved as well
    }
    
    // Save to state if requested
    if (shouldSave) {
      savedMessages.push({ text, level, timestamp: Date.now() });
      // Trim saved messages
      if (savedMessages.length > MAX_SAVED_LINES) {
        savedMessages = savedMessages.slice(-MAX_SAVED_LINES);
      }
      debouncedSave();
    }
  }

  function appendLine(text, level = 'info') {
    appendLineInternal(text, level, true);
  }

  pauseBtn?.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    if (!paused && buffer.length) { 
      buffer.forEach(item => appendLine(item.text, item.level)); 
      buffer = []; 
    }
    debouncedSave(); // Save paused state
  });

  clearBtn?.addEventListener('click', () => {
    consoleWindow.innerHTML = '';
    buffer = [];
    savedMessages = [];
    // Clear saved state
    localStorage.removeItem(STORAGE_KEY);
    if (guildId) {
      fetch(`/api/logs/${encodeURIComponent(guildId)}/clear`, { method: 'POST', credentials: 'include' });
    }
  });

  downloadBtn?.addEventListener('click', () => {
    const lines = Array.from(consoleWindow.children).map(n => n.textContent);
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); 
    a.href = url; 
    a.download = `bot-console-${Date.now()}.log`; 
    a.click(); 
    URL.revokeObjectURL(url);
  });

  // Fetch WebSocket token and connect
  async function initWebSocket() {
    try {
      // First try to get an authenticated WebSocket token
      const tokenUrl = guildId ? `/api/ws-token?guildId=${encodeURIComponent(guildId)}` : '/api/ws-token';
      const tokenResponse = await fetch(tokenUrl, { credentials: 'include' });
      
      let wsToken = null;
      if (tokenResponse.ok) {
        const tokenData = await tokenResponse.json();
        if (tokenData.success && tokenData.token) {
          wsToken = tokenData.token;
          appendLine('[Console] Authenticated successfully', 'info');
        }
      }

      connectWebSocket(wsToken);
    } catch (error) {
      appendLine('[Console] Failed to authenticate, connecting as read-only', 'warn');
      connectWebSocket(null);
    }
  }

  function connectWebSocket(token) {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
    const guildParam = guildId ? `?guildId=${encodeURIComponent(guildId)}` : '';
    const wsUrl = `${wsProto}://${location.host}/ws${guildParam}`;

    try {
      // Pass token via Sec-WebSocket-Protocol if available
      socket = token ? new WebSocket(wsUrl, token) : new WebSocket(wsUrl);
    } catch (e) {
      appendLine('[Console] WebSocket connection failed: ' + e.message, 'error');
      scheduleReconnect();
      return;
    }

    socket.addEventListener('open', () => {
      appendLine('[Console] Connected to bot console', 'info');
      reconnectAttempts = 0;
      
      // Subscribe to guild stream if available
      if (guildId && token) {
        try { 
          socket.send(JSON.stringify({ type: 'subscribe', guildId })); 
        } catch (_) {}
      }
      
      // Fetch recent messages for backfill
      loadRecentMessages();
    });

    socket.addEventListener('message', (ev) => {
      try {
        const p = JSON.parse(ev.data);
        if (!p) return;
        
        if (p.type === 'botConsole') {
          const ts = p.timestamp ? (new Date(p.timestamp)).toLocaleString() : new Date().toLocaleString();
          const guildPart = p.guildId ? `[${p.guildId.slice(0, 8)}...] ` : '';
          const level = p.level || (p.eventType ? 'event' : 'info');
          const msg = p.message || (p.eventType ? `${p.eventType}` : '');
          appendLine(`${ts} ${guildPart}${msg}`, level);
        } else if (p.type === 'event' && p.event) {
          // Handle general events
          const ts = new Date().toLocaleString();
          const eventType = p.event.type || 'unknown';
          appendLine(`${ts} [EVENT] ${eventType}`, 'event');
        } else if (p.type === 'ping') {
          // Respond to keepalive pings
          try {
            socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          } catch (_) {}
        }
      } catch (e) {
        // ignore parse errors
      }
    });

    socket.addEventListener('close', (ev) => { 
      appendLine(`[Console] Disconnected (code: ${ev.code})`, 'warn'); 
      scheduleReconnect();
    });
    
    socket.addEventListener('error', (ev) => { 
      appendLine('[Console] WebSocket error', 'error'); 
    });
  }

  function scheduleReconnect() {
    if (reconnectAttempts >= maxReconnectAttempts) {
      appendLine('[Console] Max reconnection attempts reached. Please refresh the page.', 'error');
      return;
    }
    
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000); // Exponential backoff, max 30s
    appendLine(`[Console] Reconnecting in ${delay/1000}s... (attempt ${reconnectAttempts}/${maxReconnectAttempts})`, 'warn');
    
    setTimeout(() => {
      initWebSocket();
    }, delay);
  }

  function loadRecentMessages() {
    if (guildId) {
      fetch(`/api/logs/${encodeURIComponent(guildId)}`, { credentials: 'include' })
        .then(r => r.json())
        .then(list => {
          if (Array.isArray(list)) {
            list.forEach(entry => {
              const ts = entry.timestamp ? (new Date(entry.timestamp)).toLocaleString() : '';
              const level = entry.level || 'info';
              const msg = entry.message || entry.eventType || JSON.stringify(entry.data || {});
              appendLine(`${ts} ${msg}`, level);
            });
          }
        })
        .catch(() => appendLine('[Console] Failed to load guild logs', 'warn'));
    } else {
      fetch('/api/console/messages?limit=500', { credentials: 'include' })
        .then(r => r.json())
        .then(data => {
          if (data.success && data.messages) {
            data.messages.forEach(m => {
              const ts = m.timestamp ? (new Date(m.timestamp)).toLocaleString() : '';
              const guildPart = m.guildId ? `[${m.guildId.slice(0, 8)}...] ` : '';
              appendLine(`${ts} ${guildPart}${m.message}`, 'info');
            });
          }
        })
        .catch(() => appendLine('[Console] Failed to load recent messages', 'warn'));
    }
  }

  // Initialize
  loadSavedState(); // Restore previous session
  appendLine('[Console] Initializing...', 'info');
  initWebSocket();
  
  // Save state before page unload
  window.addEventListener('beforeunload', saveState);
})();
