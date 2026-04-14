import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import MoodBar from './components/MoodBar.jsx';

const API = 'http://127.0.0.1:8950/api';

/* ════════════════════════════════════════
   Markdown → HTML (no deps)
   ════════════════════════════════════════ */
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function md(text) {
  if (!text) return '';
  return text
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_,l,c) => `<pre><code class="lang-${l||'text'}">${esc(c.trim())}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>');
}

/* ════════════════════════════════════════
   SVG Icons (inline, no deps)
   ════════════════════════════════════════ */
const Icon = {
  Plus:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Send:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  Stop:     <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>,
  Settings: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  Clip:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>,
  Mic:      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>,
  Copy:     <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
  ThumbUp:  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>,
  ThumbDn:  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>,
  Trash:    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
  Edit:     <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  Close:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Phone:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>,
  Brain:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.88.94 3.54 2.38 4.53A4.5 4.5 0 0 0 4 16.5 4.5 4.5 0 0 0 8.5 21h7a4.5 4.5 0 0 0 4.5-4.5 4.5 4.5 0 0 0-2.38-4.47A5.49 5.49 0 0 0 20 7.5 5.5 5.5 0 0 0 14.5 2h-5z"/></svg>,
  Chart:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  User:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
};

const SUGGESTIONS = [
  { icon: Icon.Brain, title: 'Analyze my code', sub: 'Deep review with heavy model' },
  { icon: Icon.Send, title: 'Quick question', sub: 'Fast response with 8B model' },
  { icon: Icon.Settings, title: 'Security audit', sub: 'Scan for vulnerabilities' },
  { icon: Icon.Chart, title: 'Plan a feature', sub: 'Architecture & design help' },
];

const MODE_LABELS = { auto: 'Auto', fast: 'Fast · 8B', heavy: 'Deep · 32B', claude: 'Claude' };

/* ════════════════════════════════════════
   Toast system
   ════════════════════════════════════════ */
let _showToast = () => {};
function Toast() {
  const [toasts, setToasts] = useState([]);
  _showToast = useCallback((msg, type = 'info') => {
    const id = Date.now();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3000);
  }, []);
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 300, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} className="toast show">
          <span className={`toast-dot ${t.type}`} />
          {t.msg}
        </div>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════
   MAIN APP
   ════════════════════════════════════════ */
export default function App() {
  /* ── state ── */
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [settings, setSettings] = useState(null);
  const [emotion, setEmotion] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('general');
  const [profileOpen, setProfileOpen] = useState(false);
  const [modelMode, setModelMode] = useState('auto');
  const [lastModel, setLastModel] = useState('');
  const [voiceCallOpen, setVoiceCallOpen] = useState(false);
  const [sysPanelOpen, setSysPanelOpen] = useState(false);
  const [goalPanelOpen, setGoalPanelOpen] = useState(false);
  const [commandCenterOpen, setCommandCenterOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [unreadAlerts, setUnreadAlerts] = useState(0);

  const wsRef = useRef(null);
  const streamBuf = useRef('');
  const lastTokenRef = useRef(0);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);

  const [inputVal, setInputVal] = useState('');
  const [image, setImage] = useState(null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const [feedbackMap, setFeedbackMap] = useState({});

  /* ── streaming watchdog ── */
  useEffect(() => {
    if (!streaming) return;
    lastTokenRef.current = Date.now();
    const iv = setInterval(() => {
      if (Date.now() - lastTokenRef.current > 45000) {
        console.warn('[Nova] Streaming watchdog triggered — no tokens for 45s');
        setStreaming(false);
        streamBuf.current = '';
        setMessages(p => p.map(m => m._streaming ? { ...m, _streaming: false } : m));
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [streaming]);

  /* ── WS health check — force-close dead sockets ── */
  useEffect(() => {
    const iv = setInterval(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState > 1) {
        // CLOSING (2) or CLOSED (3) but ref not cleared
        console.warn('[Nova] Found stale WS ref (readyState=' + ws.readyState + '), clearing');
        wsRef.current = null;
        setStreaming(false);
        streamBuf.current = '';
        setMessages(p => p.map(m => m._streaming ? { ...m, _streaming: false } : m));
      }
    }, 3000);
    return () => clearInterval(iv);
  }, []);

  /* ── load on mount ── */
  useEffect(() => {
    fetch(`${API}/conversations`).then(r => r.json()).then(setConversations).catch(() => {});
    fetch(`${API}/settings`).then(r => r.json()).then(d => {
      setSettings(d);
      if (d.current_mode) setModelMode(d.current_mode);
    }).catch(() => {});
    fetch(`${API}/emotion`).then(r => r.json()).then(setEmotion).catch(() => {});

    // Spotify OAuth callback handler
    if (window.location.pathname === '/spotify-callback') {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      if (code) {
        fetch(`${API}/spotify/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        })
          .then(r => r.json())
          .then(d => {
            if (d.status === 'connected') {
              document.title = 'Spotify Connected!';
              setTimeout(() => { window.location.href = '/'; }, 1500);
            }
          })
          .catch(() => {});
      }
    }
  }, []);

  /* ── emotion poll ── */
  useEffect(() => {
    const iv = setInterval(() => {
      fetch(`${API}/emotion`).then(r => r.json()).then(setEmotion).catch(() => {});
    }, 10000);
    return () => clearInterval(iv);
  }, []);

  /* ── load messages ── */
  useEffect(() => {
    if (!activeConvId) { setMessages([]); return; }
    fetch(`${API}/conversations/${activeConvId}/messages`)
      .then(r => r.json()).then(setMessages).catch(() => {});
  }, [activeConvId]);

  /* ── scroll to bottom ── */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /* ── auto-resize ── */
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, [inputVal]);

  /* ── WebSocket ── */
  const connectWs = useCallback(() => {
    // Only reuse if truly OPEN (1); CONNECTING (0) might be stale
    if (wsRef.current && wsRef.current.readyState === 1) return;
    // Close any lingering connection
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    const ws = new WebSocket('ws://127.0.0.1:8950/ws/chat');
    ws.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.type === 'conversation_created') {
        setActiveConvId(data.conversation_id);
      } else if (data.type === 'token') {
        lastTokenRef.current = Date.now();
        streamBuf.current += data.content;
        setMessages(p => {
          const last = p[p.length - 1];
          if (last && last.role === 'assistant' && last._streaming)
            return [...p.slice(0, -1), { ...last, content: streamBuf.current }];
          return [...p, { role: 'assistant', content: streamBuf.current, _streaming: true }];
        });
      } else if (data.type === 'done') {
        streamBuf.current = '';
        setStreaming(false);
        if (data.model) setLastModel(data.model);
        setMessages(p => p.map(m => m._streaming
          ? { ...m, content: data.full_response || m.content, _streaming: false, model: data.model || '', interrupted: !!data.interrupted }
          : m
        ));
        if (data.emotion) setEmotion({ state: data.emotion, feeling: data.emotion.dominant_feeling });
        fetch(`${API}/conversations`).then(r => r.json()).then(setConversations).catch(() => {});
      } else if (data.type === 'proactive') {
        const newAlert = { id: Date.now(), content: data.content, category: data.category || 'info', ts: new Date().toLocaleTimeString() };
        setAlerts(p => [newAlert, ...p].slice(0, 50));
        setUnreadAlerts(n => n + 1);
      } else if (data.type === 'alert') {
        const newAlert = { id: Date.now(), content: data.message || data.content || JSON.stringify(data), category: data.category || data.severity || 'info', ts: new Date().toLocaleTimeString() };
        setAlerts(p => [newAlert, ...p].slice(0, 50));
        setUnreadAlerts(n => n + 1);
      } else if (data.type === 'error') {
        setStreaming(false);
        setMessages(p => [...p, { role: 'system', content: `Error: ${data.message}` }]);
      }
    };
    ws.onerror = () => { setStreaming(false); streamBuf.current = ''; setMessages(p => p.map(m => m._streaming ? { ...m, _streaming: false } : m)); };
    ws.onclose = () => { wsRef.current = null; setStreaming(false); streamBuf.current = ''; setMessages(p => p.map(m => m._streaming ? { ...m, _streaming: false } : m)); };
    wsRef.current = ws;
  }, []);

  /* ── send message ── */
  const sendMessage = useCallback(async (text, img) => {
    if ((!text.trim() && !img) || streaming) return;
    let imageUrl = null, imageDescription = '';
    if (img?.file) {
      const fd = new FormData(); fd.append('file', img.file);
      try { const r = await (await fetch(`${API}/upload`, { method: 'POST', body: fd })).json(); imageUrl = r.url; imageDescription = r.description || ''; } catch {}
    }
    const displayText = text || (imageDescription ? `[Image: ${imageDescription}]` : '[Image]');
    const messageText = imageDescription ? `${text}\n\n[User attached an image: ${imageDescription}]` : text;
    setMessages(p => [...p, { role: 'user', content: displayText, imageUrl }]);
    setStreaming(true);
    streamBuf.current = '';
    connectWs();
    let attempts = 0;
    const send = () => {
      if (wsRef.current?.readyState === 1) {
        wsRef.current.send(JSON.stringify({ type: 'message', content: messageText || 'What do you see?', conversation_id: activeConvId }));
      } else if (attempts++ < 50) setTimeout(send, 100);
      else { setStreaming(false); setMessages(p => [...p, { role: 'system', content: 'Could not reach Nova.' }]); }
    };
    send();
  }, [activeConvId, streaming, connectWs]);

  /* ── actions ── */
  const handleInterrupt = useCallback(() => {
    connectWs();
    if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
  }, [connectWs]);

  const newChat = useCallback(async () => {
    try {
      const r = await (await fetch(`${API}/chat/new`, { method: 'POST' })).json();
      setActiveConvId(r.conversation_id); setMessages([]);
      fetch(`${API}/conversations`).then(r => r.json()).then(setConversations).catch(() => {});
    } catch {}
  }, []);

  const deleteConv = useCallback(async (id) => {
    await fetch(`${API}/conversations/${id}`, { method: 'DELETE' });
    if (activeConvId === id) { setActiveConvId(null); setMessages([]); }
    setConversations(p => p.filter(c => c.id !== id));
  }, [activeConvId]);

  const switchMode = useCallback(async (mode) => {
    setModelMode(mode);
    try { await fetch(`${API}/models/mode`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) }); } catch {}
    connectWs();
    if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify({ type: 'set_model_mode', mode }));
    _showToast(`Switched to ${MODE_LABELS[mode] || mode}`, 'success');
  }, [connectWs]);

  /* ── input handlers ── */
  const handleSubmit = () => {
    if ((!inputVal.trim() && !image) || streaming) return;
    sendMessage(inputVal.trim(), image);
    setInputVal(''); setImage(null);
  };
  const handleKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } };
  const handleFile = (e) => {
    const f = e.target.files?.[0]; if (!f || !f.type.startsWith('image/')) return;
    setImage({ file: f, preview: URL.createObjectURL(f), name: f.name }); e.target.value = '';
  };

  const toggleVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    if (listening && recognitionRef.current) { recognitionRef.current.stop(); setListening(false); return; }
    const r = new SR(); r.continuous = false; r.interimResults = true; r.lang = 'en-US';
    r.onresult = (e) => { let t=''; for (let i=0;i<e.results.length;i++) t+=e.results[i][0].transcript; setInputVal(t); };
    r.onend = () => setListening(false); r.onerror = () => setListening(false);
    recognitionRef.current = r; r.start(); setListening(true);
  };

  const sendFeedback = async (idx, signal) => {
    if (feedbackMap[idx]) return;
    setFeedbackMap(p => ({...p, [idx]: signal}));
    const msg = messages[idx]; const userMsg = messages.slice(0,idx).reverse().find(m=>m.role==='user')?.content || '';
    try { await fetch(`${API}/learning/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conv_id: activeConvId||0, signal, user_msg: userMsg, nova_msg: msg.content||'', category: 'general' }) }); } catch {}
    _showToast(signal === 'positive' ? 'Thanks for the feedback!' : 'Noted, will improve', 'info');
  };

  const copyText = (text) => {
    navigator.clipboard.writeText(text).then(() => _showToast('Copied to clipboard', 'success'));
  };

  /* ── group conversations by date ── */
  const grouped = (() => {
    const now = new Date(), today = now.toDateString();
    const yesterday = new Date(now - 86400000).toDateString();
    const groups = { today: [], yesterday: [], older: [] };
    (conversations || []).forEach(c => {
      const d = new Date(c.updated_at || c.created_at || 0).toDateString();
      if (d === today) groups.today.push(c);
      else if (d === yesterday) groups.yesterday.push(c);
      else groups.older.push(c);
    });
    return groups;
  })();

  const modeDot = modelMode === 'heavy' ? 'deep' : modelMode === 'fast' ? 'fast' : modelMode === 'claude' ? 'claude' : 'auto';

  /* ════════════════════════════════════════
     RENDER
     ════════════════════════════════════════ */
  return (
    <div className="app">
      <Toast />

      {/* Mobile overlay */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* ── SIDEBAR ── */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="nova-logo">N</div>
          <div>
            <div className="nova-title">Nova</div>
          </div>
          <span className="nova-status">Online</span>
        </div>

        <button className="new-chat-btn" onClick={() => { newChat(); setSidebarOpen(false); }}>
          {Icon.Plus} New Chat
        </button>

        <div className="chat-history">
          {grouped.today.length > 0 && (
            <div className="history-section">
              <div className="history-label">Today</div>
              {grouped.today.map(c => (
                <div key={c.id} className={`history-item ${c.id === activeConvId ? 'active' : ''}`} onClick={() => { setActiveConvId(c.id); setSidebarOpen(false); }}>
                  <span className="history-text">{c.title || 'New Conversation'}</span>
                  <div className="history-actions">
                    <button className="history-action-btn danger" onClick={e => { e.stopPropagation(); deleteConv(c.id); }}>{Icon.Trash}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {grouped.yesterday.length > 0 && (
            <div className="history-section">
              <div className="history-label">Yesterday</div>
              {grouped.yesterday.map(c => (
                <div key={c.id} className={`history-item ${c.id === activeConvId ? 'active' : ''}`} onClick={() => { setActiveConvId(c.id); setSidebarOpen(false); }}>
                  <span className="history-text">{c.title || 'New Conversation'}</span>
                  <div className="history-actions">
                    <button className="history-action-btn danger" onClick={e => { e.stopPropagation(); deleteConv(c.id); }}>{Icon.Trash}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {grouped.older.length > 0 && (
            <div className="history-section">
              <div className="history-label">Older</div>
              {grouped.older.map(c => (
                <div key={c.id} className={`history-item ${c.id === activeConvId ? 'active' : ''}`} onClick={() => { setActiveConvId(c.id); setSidebarOpen(false); }}>
                  <span className="history-text">{c.title || 'New Conversation'}</span>
                  <div className="history-actions">
                    <button className="history-action-btn danger" onClick={e => { e.stopPropagation(); deleteConv(c.id); }}>{Icon.Trash}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!conversations.length && (
            <div style={{ padding: '32px 12px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
              No conversations yet
            </div>
          )}
        </div>

        <div className="sidebar-bottom">
          <button className="sidebar-btn" style={{ background: 'linear-gradient(135deg,#5865f2,#eb459e)', color: '#fff', fontWeight: 600, position: 'relative' }} onClick={() => { setCommandCenterOpen(true); setSidebarOpen(false); setUnreadAlerts(0); }}>
            {Icon.Brain} Command Center
            {unreadAlerts > 0 && (
              <span style={{ position: 'absolute', top: 6, right: 10, background: '#ed4245', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 5px', minWidth: 16, textAlign: 'center' }}>
                {unreadAlerts > 9 ? '9+' : unreadAlerts}
              </span>
            )}
          </button>
          <button className="sidebar-btn" onClick={() => setVoiceCallOpen(true)}>{Icon.Phone} Voice Call</button>
          <button className="sidebar-btn" onClick={() => { setSysPanelOpen(true); setSidebarOpen(false); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            System Monitor
          </button>
          <button className="sidebar-btn" onClick={() => { setGoalPanelOpen(true); setSidebarOpen(false); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Goals
          </button>
          <button className="sidebar-btn" onClick={() => { setSettingsOpen(true); setSidebarOpen(false); }}>{Icon.Settings} Settings</button>
          <button className="user-profile-btn" onClick={() => setProfileOpen(true)}>
            <div className="user-avatar">C</div>
            <div className="user-info">
              <div className="user-name">Cayden</div>
              <div className="user-role">Admin</div>
            </div>
          </button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main className="main">
        <div className="topbar">
          <button className="hamburger" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
          <div className="model-selector" onClick={() => {
            const modes = ['auto', 'fast', 'heavy', 'claude'];
            switchMode(modes[(modes.indexOf(modelMode) + 1) % modes.length]);
          }}>
            <span className={`model-dot ${modeDot}`} />
            <span>{MODE_LABELS[modelMode]}</span>
          </div>
          <div className="topbar-right">
            {emotion && <MoodBar emotion={emotion} />}
            <div className="model-mode-switcher">
              {['auto', 'fast', 'heavy', 'claude'].map(m => (
                <button key={m} className={`mode-btn ${modelMode === m ? 'active' : ''}`} onClick={() => switchMode(m)}>
                  {m === 'auto' ? 'Auto' : m === 'fast' ? '8B' : m === 'heavy' ? '32B' : '☁ Claude'}
                </button>
              ))}
            </div>
            <button className="icon-btn" onClick={() => setSettingsOpen(true)}>{Icon.Settings}</button>
          </div>
        </div>

        {/* ── CHAT ── */}
        <div className="chat-area">
          <div className="message-wrap">
            {!messages.length ? (
              <div className="welcome-screen">
                <div className="welcome-logo">N</div>
                <h1 className="welcome-title">Hey Cayden</h1>
                <p className="welcome-sub">I'm Nova, your local AI. Ask me anything — I run entirely on your hardware. No cloud, no tracking.</p>
                <div className="suggestion-grid">
                  {SUGGESTIONS.map((s, i) => (
                    <div key={i} className="suggestion-card" onClick={() => { setInputVal(s.title); inputRef.current?.focus(); }}>
                      <span className="s-icon">{typeof s.icon === 'string' ? s.icon : s.icon}</span>
                      <div className="s-title">{s.title}</div>
                      <div className="s-sub">{s.sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <div key={i} className="message">
                    <div className="message-header">
                      <div className={`msg-avatar ${msg.role === 'assistant' ? 'nova' : msg.role === 'user' ? 'user' : ''}`}>
                        {msg.proactive ? '◆' : msg.role === 'assistant' ? 'N' : msg.role === 'user' ? 'C' : '!'}
                      </div>
                      <span className="msg-name">{msg.role === 'assistant' ? 'Nova' : msg.role === 'user' ? 'Cayden' : 'System'}</span>
                      {msg.model && (
                        <span className={`msg-model ${msg.model?.includes('claude') ? 'claude' : msg.model?.includes('32b') || msg.model?.includes('qwen') ? 'deep' : 'fast'}`}>
                          {msg.model?.includes('claude') ? 'Claude' : msg.model?.includes('32b') || msg.model?.includes('qwen') ? 'Deep' : 'Fast'}
                        </span>
                      )}
                    </div>
                    <div className={`msg-body ${msg.role === 'assistant' ? 'nova-msg' : ''}`}>
                      {msg.imageUrl && <img src={msg.imageUrl} alt="" style={{ maxWidth: 300, borderRadius: 8, marginBottom: 8, display: 'block' }} />}
                      <span dangerouslySetInnerHTML={{ __html: md(msg.content) }} />
                      {msg._streaming && <span className="thinking-dots" style={{ display: 'inline-flex', marginLeft: 4 }}><span /><span /><span /></span>}
                    </div>
                    {msg.role === 'assistant' && !msg._streaming && msg.content && (
                      <div className="msg-actions" style={{ opacity: 1 }}>
                        <button className="msg-action-btn" onClick={() => copyText(msg.content)}>{Icon.Copy} Copy</button>
                        <button className={`msg-action-btn ${feedbackMap[i] === 'positive' ? 'active' : ''}`} onClick={() => sendFeedback(i, 'positive')}>{Icon.ThumbUp}</button>
                        <button className={`msg-action-btn ${feedbackMap[i] === 'negative' ? 'active' : ''}`} onClick={() => sendFeedback(i, 'negative')}>{Icon.ThumbDn}</button>
                      </div>
                    )}
                  </div>
                ))}
                {streaming && !messages[messages.length-1]?._streaming && (
                  <div className="thinking">
                    <div className="thinking-dots"><span /><span /><span /></div>
                    <span className="thinking-text">Nova is thinking...</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </>
            )}
          </div>
        </div>

        {/* ── INPUT BAR ── */}
        <div className="input-area">
          {image && (
            <div style={{ maxWidth: 720, margin: '0 auto 8px', padding: '0 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg3)', borderRadius: 8, fontSize: 13, color: 'var(--text2)' }}>
                <img src={image.preview} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover' }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{image.name}</span>
                <button style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer' }} onClick={() => { if (image?.preview) URL.revokeObjectURL(image.preview); setImage(null); }}>✕</button>
              </div>
            </div>
          )}
          <div className="input-wrap">
            <div className="input-row">
              <div className="input-tools">
                <button className="tool-btn" onClick={() => fileRef.current?.click()} title="Attach">{Icon.Clip}</button>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
                <button className={`tool-btn ${listening ? 'active' : ''}`} onClick={toggleVoice} title="Voice" style={listening ? { color: 'var(--red)' } : {}}>{Icon.Mic}</button>
              </div>
              <textarea
                ref={inputRef}
                className="msg-input"
                placeholder="Message Nova..."
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onKeyDown={handleKey}
                rows={1}
                disabled={streaming}
              />
              {streaming ? (
                <button className="interrupt-btn" onClick={handleInterrupt} title="Stop">{Icon.Stop}</button>
              ) : (
                <button className="send-btn" onClick={handleSubmit} disabled={!inputVal.trim() && !image} title="Send">{Icon.Send}</button>
              )}
            </div>
            <div className="input-footer">
              {lastModel && <span>Last: {lastModel} · </span>}
              Nova runs locally — your data stays private
            </div>
          </div>
        </div>
      </main>

      {/* ══════ SETTINGS MODAL ══════ */}
      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Settings</span>
              <button className="modal-close" onClick={() => setSettingsOpen(false)}>{Icon.Close}</button>
            </div>
            <div className="settings-layout">
              <nav className="settings-nav">
                {['general','model','personality','memory','voice','security','learning','advanced'].map(tab => (
                  <button key={tab} className={`settings-nav-btn ${settingsTab === tab ? 'active' : ''}`} onClick={() => setSettingsTab(tab)}>
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </nav>
              <div className="settings-content">
                {settingsTab === 'general' && (
                  <div className="settings-section">
                    <div className="settings-section-title">General</div>
                    <div className="setting-row"><div><div className="setting-label">Theme</div><div className="setting-desc">Appearance mode</div></div><span style={{ color: 'var(--text2)', fontSize: 13 }}>Dark</span></div>
                    <div className="setting-row"><div><div className="setting-label">Notifications</div><div className="setting-desc">Show proactive alerts</div></div>
                      <label className="toggle"><input type="checkbox" defaultChecked /><span className="toggle-track" /><span className="toggle-thumb" /></label>
                    </div>
                    <div className="setting-row"><div><div className="setting-label">Sound Effects</div><div className="setting-desc">Play notification sounds</div></div>
                      <label className="toggle"><input type="checkbox" defaultChecked /><span className="toggle-track" /><span className="toggle-thumb" /></label>
                    </div>
                  </div>
                )}
                {settingsTab === 'model' && (
                  <div className="settings-section">
                    <div className="settings-section-title">Model Configuration</div>
                    <div className="setting-row"><div><div className="setting-label">Default Mode</div><div className="setting-desc">Which model to use by default</div></div>
                      <select className="setting-select" value={modelMode} onChange={e => switchMode(e.target.value)}>
                        <option value="auto">Auto Route</option>
                        <option value="fast">Fast (8B)</option>
                        <option value="heavy">Deep (32B)</option>
                        <option value="claude">Claude</option>
                      </select>
                    </div>
                    <div className="setting-row"><div><div className="setting-label">Fast Model</div><div className="setting-desc">Quick responses</div></div><span style={{ color: 'var(--green)', fontSize: 13 }}>{settings?.models?.fast || 'llama3.1:8b'}</span></div>
                    <div className="setting-row"><div><div className="setting-label">Heavy Model</div><div className="setting-desc">Deep analysis</div></div><span style={{ color: 'var(--accent2)', fontSize: 13 }}>{settings?.models?.deep || 'qwen2.5:32b'}</span></div>
                    <div className="setting-row"><div><div className="setting-label">Claude</div><div className="setting-desc">Cloud AI (Anthropic)</div></div><span style={{ color: settings?.models?.claude_available ? 'var(--green)' : '#ed4245', fontSize: 13 }}>{settings?.models?.claude_available ? (settings?.models?.claude || 'Connected') : 'No API Key'}</span></div>
                    <div className="setting-row"><div><div className="setting-label">Temperature</div><div className="setting-desc">Response creativity</div></div><span style={{ color: 'var(--text2)', fontSize: 13 }}>{settings?.temperature ?? 0.7}</span></div>
                    <div className="setting-row"><div><div className="setting-label">Auto Routing</div><div className="setting-desc">Auto-select model based on query</div></div>
                      <label className="toggle"><input type="checkbox" checked={modelMode === 'auto'} onChange={() => switchMode(modelMode === 'auto' ? 'fast' : 'auto')} /><span className="toggle-track" /><span className="toggle-thumb" /></label>
                    </div>
                  </div>
                )}
                {settingsTab === 'personality' && (
                  <div className="settings-section">
                    <div className="settings-section-title">Personality</div>
                    <div className="setting-row"><div><div className="setting-label">Name</div></div><span style={{ color: 'var(--text2)', fontSize: 13 }}>{settings?.personality || 'Nova'}</span></div>
                    <div className="setting-row"><div><div className="setting-label">Tone</div></div><span style={{ color: 'var(--text2)', fontSize: 13 }}>{settings?.tone || 'casual'}</span></div>
                    {emotion?.state && (
                      <>
                        <div className="settings-section-title" style={{ marginTop: 20 }}>Emotional State</div>
                        <div className="setting-row"><div><div className="setting-label">Current Feeling</div></div><span style={{ color: 'var(--accent2)', fontSize: 13 }}>{emotion.feeling || '—'}</span></div>
                        {['mood','energy','curiosity','patience','satisfaction','warmth'].map(k => (
                          emotion.state[k] != null && (
                            <div key={k} className="setting-row">
                              <div><div className="setting-label" style={{ textTransform: 'capitalize' }}>{k}</div></div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 100, height: 6, background: 'var(--bg4)', borderRadius: 3, overflow: 'hidden' }}>
                                  <div style={{ width: `${emotion.state[k] * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 3, transition: 'width 0.3s' }} />
                                </div>
                                <span style={{ fontSize: 12, color: 'var(--text3)', width: 32 }}>{Math.round(emotion.state[k] * 100)}%</span>
                              </div>
                            </div>
                          )
                        ))}
                      </>
                    )}
                  </div>
                )}
                {settingsTab === 'memory' && (
                  <div className="settings-section">
                    <div className="settings-section-title">Memory</div>
                    <div className="setting-row"><div><div className="setting-label">Max History</div><div className="setting-desc">Messages kept in context</div></div><span style={{ color: 'var(--text2)', fontSize: 13 }}>{settings?.max_history ?? 50}</span></div>
                    <div className="setting-row"><div><div className="setting-label">Learn from Feedback</div><div className="setting-desc">Improve from thumbs up/down</div></div>
                      <label className="toggle"><input type="checkbox" defaultChecked /><span className="toggle-track" /><span className="toggle-thumb" /></label>
                    </div>
                  </div>
                )}
                {settingsTab === 'voice' && (
                  <div className="settings-section">
                    <div className="settings-section-title">Voice</div>
                    <div className="setting-row"><div><div className="setting-label">Voice Input</div><div className="setting-desc">Speech-to-text via Web Speech API</div></div>
                      <span style={{ color: 'var(--green)', fontSize: 13 }}>Available</span>
                    </div>
                    <div className="setting-row"><div><div className="setting-label">Voice Call</div><div className="setting-desc">Full duplex voice conversation</div></div>
                      <button className="btn btn-ghost" onClick={() => { setSettingsOpen(false); setVoiceCallOpen(true); }}>Open Voice Call</button>
                    </div>
                  </div>
                )}
                {settingsTab === 'security' && (
                  <div className="settings-section">
                    <div className="settings-section-title">Security</div>
                    {['Process Watcher','Integrity Checker','File Watcher','Anomaly Detector'].map(s => (
                      <div key={s} className="setting-row"><div><div className="setting-label">{s}</div></div><span style={{ color: 'var(--green)', fontSize: 13 }}>Active</span></div>
                    ))}
                  </div>
                )}
                {settingsTab === 'learning' && (
                  <div className="settings-section">
                    <div className="settings-section-title">Learning System</div>
                    <div className="setting-row"><div><div className="setting-label">Supervised Learning</div><div className="setting-desc">Learn from user feedback</div></div>
                      <label className="toggle"><input type="checkbox" defaultChecked /><span className="toggle-track" /><span className="toggle-thumb" /></label>
                    </div>
                    <div className="setting-row"><div><div className="setting-label">Pattern Recognition</div><div className="setting-desc">Detect recurring topics</div></div>
                      <label className="toggle"><input type="checkbox" defaultChecked /><span className="toggle-track" /><span className="toggle-thumb" /></label>
                    </div>
                  </div>
                )}
                {settingsTab === 'advanced' && (
                  <div className="settings-section">
                    <div className="settings-section-title">Advanced</div>
                    <div className="setting-row"><div><div className="setting-label">Backend URL</div></div><span style={{ color: 'var(--text3)', fontSize: 13 }}>127.0.0.1:8950</span></div>
                    <div className="setting-row"><div><div className="setting-label">Ollama URL</div></div><span style={{ color: 'var(--text3)', fontSize: 13 }}>127.0.0.1:11434</span></div>
                    <div className="setting-row"><div><div className="setting-label">WebSocket</div></div><span style={{ color: wsRef.current?.readyState === 1 ? 'var(--green)' : 'var(--text3)', fontSize: 13 }}>{wsRef.current?.readyState === 1 ? 'Connected' : 'Disconnected'}</span></div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════ PROFILE MODAL ══════ */}
      {profileOpen && (
        <div className="modal-overlay" onClick={() => setProfileOpen(false)}>
          <div className="modal" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
            <div className="profile-header">
              <div className="profile-avatar-large">C</div>
              <div className="profile-info">
                <div className="profile-name">Cayden</div>
                <div className="profile-meta">Admin · Local Instance</div>
                <div className="profile-badge">● Active</div>
              </div>
              <button className="modal-close" style={{ marginLeft: 'auto' }} onClick={() => setProfileOpen(false)}>{Icon.Close}</button>
            </div>
            <div className="profile-content">
              <div className="profile-stat-grid">
                <div className="profile-stat"><div className="profile-stat-num">{conversations.length}</div><div className="profile-stat-label">Chats</div></div>
                <div className="profile-stat"><div className="profile-stat-num">{messages.filter(m => m.role === 'user').length}</div><div className="profile-stat-label">Messages</div></div>
                <div className="profile-stat"><div className="profile-stat-num">{Object.keys(feedbackMap).length}</div><div className="profile-stat-label">Feedback</div></div>
              </div>
              <div className="profile-section-title">Nova's Memory About You</div>
              <div className="memory-list">
                <div className="memory-item">Prefers detailed technical explanations</div>
                <div className="memory-item">Works on Darklock security project</div>
                <div className="memory-item">Uses NVIDIA GPU with 8GB VRAM</div>
              </div>
            </div>
            <div className="profile-actions">
              <button className="btn btn-ghost" onClick={() => setProfileOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════ VOICE CALL (lazy import old component) ══════ */}
      {voiceCallOpen && <VoiceCallWrapper onClose={() => setVoiceCallOpen(false)} />}

      {/* ══════ SYSTEM PANEL ══════ */}
      {sysPanelOpen && <SystemPanelWrapper onClose={() => setSysPanelOpen(false)} />}

      {/* ══════ GOAL PANEL ══════ */}
      {goalPanelOpen && <GoalPanelWrapper onClose={() => setGoalPanelOpen(false)} />}

      {/* ══════ COMMAND CENTER ══════ */}
      {commandCenterOpen && (
        <CommandCenter
          onClose={() => { setCommandCenterOpen(false); setUnreadAlerts(0); }}
          emotion={emotion}
          modelMode={modelMode}
          conversations={conversations}
          alerts={alerts}
          onDismissAlert={id => setAlerts(p => p.filter(a => a.id !== id))}
          onDismissAllAlerts={() => { setAlerts([]); setUnreadAlerts(0); }}
          API={API}
        />
      )}
    </div>
  );
}

/* Lazy voice call wrapper — uses the existing VoiceCall component */
function VoiceCallWrapper({ onClose }) {
  const [VoiceCall, setVoiceCall] = useState(null);
  useEffect(() => {
    import('./components/VoiceCall.jsx').then(m => setVoiceCall(() => m.default));
  }, []);
  if (!VoiceCall) return null;
  return <VoiceCall onClose={onClose} />;
}

function SystemPanelWrapper({ onClose }) {
  const [Panel, setPanel] = useState(null);
  useEffect(() => {
    import('./components/SystemPanel.jsx').then(m => setPanel(() => m.default));
  }, []);
  if (!Panel) return null;
  return <Panel onClose={onClose} />;
}

function GoalPanelWrapper({ onClose }) {
  const [Panel, setPanel] = useState(null);
  useEffect(() => {
    import('./components/GoalPanel.jsx').then(m => setPanel(() => m.default));
  }, []);
  if (!Panel) return null;
  return <Panel onClose={onClose} />;
}

/* ════════════════════════════════════════
   COMMAND CENTER — full-screen tabbed panel
   ════════════════════════════════════════ */
const CC_TABS = ['overview', 'alerts', 'memory', 'system', 'goals', 'activity', 'security', 'pipeline'];

function CommandCenter({ onClose, emotion, modelMode, conversations, alerts = [], onDismissAlert, onDismissAllAlerts, API }) {
  const [tab, setTab] = useState('overview');
  const [memories, setMemories] = useState([]);
  const [sysData, setSysData] = useState(null);
  const [goals, setGoals] = useState([]);
  const [activity, setActivity] = useState([]);
  const [learning, setLearning] = useState(null);
  const [profileFacts, setProfileFacts] = useState({});
  const [allMemories, setAllMemories] = useState([]);
  const [memStats, setMemStats] = useState(null);
  const [memSearch, setMemSearch] = useState('');
  const [memResults, setMemResults] = useState(null);
  const [memCatFilter, setMemCatFilter] = useState('all');
  const [sentinel, setSentinel] = useState(null);
  const [findings, setFindings] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [sentinelServices, setSentinelServices] = useState([]);
  const [scanHistory, setScanHistory] = useState([]);
  const [secLoading, setSecLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanStep, setScanStep] = useState('');
  const [expandedProgram, setExpandedProgram] = useState(null);
  const [pipelineData, setPipelineData] = useState(null);

  useEffect(() => {
    fetch(`${API}/memory/profile`).then(r => r.json()).then(d => {
      setProfileFacts(d && !Array.isArray(d) ? d : {});
      setMemories(Array.isArray(d) ? d : (d.facts || d.memories || []));
    }).catch(() => {});
    fetch(`${API}/memory/all?limit=200`).then(r => r.json()).then(d => setAllMemories(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${API}/memory/stats`).then(r => r.json()).then(setMemStats).catch(() => {});
    fetch(`${API}/system/status`).then(r => r.json()).then(setSysData).catch(() => {});
    fetch(`${API}/tasks`).then(r => r.json()).then(d => setGoals(Array.isArray(d) ? d : (d.tasks || []))).catch(() => {});
    fetch(`${API}/security/audit`).then(r => r.json()).then(d => setActivity(Array.isArray(d) ? d.slice(0, 20) : [])).catch(() => {});
    fetch(`${API}/learning/stats`).then(r => r.json()).then(setLearning).catch(() => {});
    fetch(`${API}/pipeline/status`).then(r => r.json()).then(setPipelineData).catch(() => {});
    // Sentinel data loaded via its own effect below
  }, [API]);

  // Sentinel data loader — reusable
  const refreshSentinel = React.useCallback(() => {
    const loads = [
      fetch(`${API}/sentinel/status`).then(r => r.json()).then(setSentinel).catch(() => {}),
      fetch(`${API}/sentinel/findings?limit=100`).then(r => r.json()).then(d => setFindings(Array.isArray(d) ? d : [])).catch(() => {}),
      fetch(`${API}/sentinel/programs?limit=100`).then(r => r.json()).then(d => setPrograms(Array.isArray(d) ? d : [])).catch(() => {}),
      fetch(`${API}/sentinel/services`).then(r => r.json()).then(d => setSentinelServices(Array.isArray(d) ? d : [])).catch(() => {}),
      fetch(`${API}/sentinel/scans?limit=20`).then(r => r.json()).then(d => setScanHistory(Array.isArray(d) ? d : [])).catch(() => {}),
    ];
    return Promise.all(loads).finally(() => setSecLoading(false));
  }, [API]);

  // Initial load + auto-refresh every 8s when security tab is active
  useEffect(() => { refreshSentinel(); }, [refreshSentinel]);
  useEffect(() => {
    if (tab !== 'security' && tab !== 'system') return;
    const iv = setInterval(refreshSentinel, 8000);
    return () => clearInterval(iv);
  }, [tab, refreshSentinel]);

  const emotionState = emotion?.state || emotion;
  const feeling = emotion?.feeling || emotionState?.dominant_feeling || '—';
  const modeDot = modelMode === 'heavy' ? '#eb459e' : modelMode === 'fast' ? '#57f287' : modelMode === 'claude' ? '#d4a574' : '#5865f2';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 200, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg2)', flexShrink: 0 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#5865f2,#eb459e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#fff', fontWeight: 700 }}>N</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>Nova Command Center</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>Feeling: <span style={{ color: '#eb459e' }}>{feeling}</span> · Model: <span style={{ color: modeDot }}>{modelMode}</span></div>
        </div>
        <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>✕</button>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, padding: '8px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg2)', flexShrink: 0 }}>
        {CC_TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, textTransform: 'capitalize',
            background: tab === t ? 'var(--accent)' : 'var(--bg3)',
            color: tab === t ? '#fff' : 'var(--text2)',
            transition: 'all 0.15s',
            position: 'relative',
          }}>
            {t}
            {t === 'alerts' && alerts.length > 0 && (
              <span style={{ position: 'absolute', top: 2, right: 2, width: 8, height: 8, borderRadius: '50%', background: '#ed4245', display: 'block' }} />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {/* Emotion card */}
            <div style={{ background: 'var(--bg2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>Emotional State</div>
              {emotionState ? (
                <>
                  <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg,#5865f2,#eb459e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#fff', fontWeight: 700 }}>N</div>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text)', textTransform: 'capitalize' }}>{feeling}</div>
                      <div style={{ fontSize: 12, color: 'var(--text3)' }}>Dominant feeling</div>
                    </div>
                  </div>
                  {['mood', 'energy', 'curiosity', 'patience', 'satisfaction', 'warmth'].map(k => emotionState[k] != null && (
                    <div key={k} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)', marginBottom: 3, textTransform: 'capitalize' }}>
                        <span>{k}</span><span>{Math.round(emotionState[k] * 100)}%</span>
                      </div>
                      <div style={{ height: 5, background: 'var(--bg4)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${emotionState[k] * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 3, transition: 'width 0.4s' }} />
                      </div>
                    </div>
                  ))}
                </>
              ) : <div style={{ color: 'var(--text3)', fontSize: 13 }}>No emotion data</div>}
            </div>

            {/* Stats card */}
            <div style={{ background: 'var(--bg2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>Stats</div>
              {[
                { label: 'Conversations', value: conversations.length, color: '#5865f2' },
                { label: 'Memories', value: memories.length, color: '#57f287' },
                { label: 'Active Tasks', value: goals.filter(g => g.status !== 'done').length, color: '#faa61a' },
                { label: 'Alerts', value: alerts.length, color: alerts.length > 0 ? '#ed4245' : '#57f287' },
                { label: 'Audit Entries', value: activity.length, color: '#eb459e' },
              ].map(s => (
                <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13, color: 'var(--text2)' }}>{s.label}</span>
                  <span style={{ fontWeight: 700, fontSize: 16, color: s.color }}>{s.value}</span>
                </div>
              ))}
            </div>

            {/* Model card */}
            <div style={{ background: 'var(--bg2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>Active Model</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: modeDot }} />
                <span style={{ fontWeight: 600, fontSize: 20, color: 'var(--text)', textTransform: 'capitalize' }}>{modelMode}</span>
              </div>
              <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text3)' }}>
                {modelMode === 'auto' && 'Auto-routes between fast and deep models based on query complexity.'}
                {modelMode === 'fast' && 'llama3.1:8b — fast responses, lightweight tasks.'}
                {modelMode === 'heavy' && 'qwen2.5:32b — deep analysis, complex reasoning.'}
                {modelMode === 'claude' && 'Claude (Anthropic) — cloud AI, maximum reasoning power.'}
              </div>
            </div>

            {/* Learning card */}
            {learning && (
              <div style={{ background: 'var(--bg2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>Learning System</div>
                {Object.entries(learning).slice(0, 6).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 0', borderBottom: '1px solid var(--border)', color: 'var(--text2)' }}>
                    <span style={{ textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>
                    <span style={{ color: 'var(--text)', fontWeight: 500 }}>{String(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ALERTS ── */}
        {tab === 'alerts' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>
                Alerts &amp; Notifications ({alerts.length})
              </div>
              {alerts.length > 0 && (
                <button onClick={onDismissAllAlerts} style={{ background: '#ed424520', border: '1px solid #ed424560', color: '#ed4245', fontSize: 12, fontWeight: 600, padding: '4px 14px', borderRadius: 6, cursor: 'pointer' }}>
                  Dismiss All
                </button>
              )}
            </div>
            {alerts.length === 0 ? (
              <div style={{ color: 'var(--text3)', fontSize: 14, textAlign: 'center', padding: 40 }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
                All clear — no alerts
              </div>
            ) : (
              alerts.map(a => {
                const catColors = { security: '#ed4245', critical: '#ed4245', warning: '#faa61a', info: '#5865f2', system: '#57f287' };
                const cc = catColors[a.category] || '#5865f2';
                return (
                  <div key={a.id} style={{ background: 'var(--bg2)', border: `1px solid var(--border)`, borderLeft: `3px solid ${cc}`, borderRadius: 8, padding: '12px 14px', marginBottom: 8, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      {a.category && (
                        <div style={{ fontSize: 10, fontWeight: 700, color: cc, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{a.category}</div>
                      )}
                      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{a.content}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{a.ts}</div>
                    </div>
                    <button onClick={() => onDismissAlert(a.id)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 4px', flexShrink: 0 }}>✕</button>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── MEMORY ── */}
        {tab === 'memory' && (() => {
          const catColors = { fact: '#5865f2', preference: '#eb459e', context: '#57f287', routine: '#faa61a', identity: '#9b59b6' };
          const visibleFacts = Object.entries(profileFacts).filter(([k]) => !k.startsWith('_'));
          const cats = ['all', ...Array.from(new Set(allMemories.map(m => m.category).filter(Boolean)))];
          const filtered = memResults !== null ? memResults
            : (memCatFilter === 'all' ? allMemories : allMemories.filter(m => m.category === memCatFilter));
          const doSearch = () => {
            if (!memSearch.trim()) { setMemResults(null); return; }
            fetch(`${API}/memory/search?q=${encodeURIComponent(memSearch)}`)
              .then(r => r.json()).then(d => setMemResults(Array.isArray(d) ? d : [])).catch(() => setMemResults([]));
          };
          return (
            <div>
              {/* ── Stats bar ── */}
              {memStats && (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
                  {[
                    { label: 'Total Memories', value: memStats.total_memories, color: '#5865f2' },
                    { label: 'Profile Facts', value: memStats.profile_facts, color: '#57f287' },
                    { label: 'Conversations Recalled', value: memStats.conversation_summaries, color: '#eb459e' },
                  ].map(s => (
                    <div key={s.label} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 18px', minWidth: 140 }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value ?? '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{s.label}</div>
                    </div>
                  ))}
                  {memStats.by_category && Object.entries(memStats.by_category).map(([cat, count]) => (
                    <div key={cat} style={{ background: 'var(--bg2)', border: `1px solid ${catColors[cat] || 'var(--border)'}44`, borderRadius: 10, padding: '12px 18px', minWidth: 120 }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: catColors[cat] || '#aaa' }}>{count}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, textTransform: 'capitalize' }}>{cat}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Profile Facts (What Nova knows about you) ── */}
              {visibleFacts.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', marginBottom: 10 }}>◈ About You</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                    {visibleFacts.map(([key, value]) => (
                      <div key={key} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#5865f2', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{key.replace(/_/g, ' ')}</div>
                        <div style={{ fontSize: 13, color: 'var(--text)', wordBreak: 'break-word' }}>{String(value)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Search & Category Filter ── */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="text" value={memSearch} placeholder="Search memories..."
                  onChange={e => setMemSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doSearch()}
                  style={{ flex: '1 1 200px', padding: '7px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 13, outline: 'none' }}
                />
                <button onClick={doSearch} style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Search</button>
                {memResults !== null && (
                  <button onClick={() => { setMemSearch(''); setMemResults(null); }} style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', fontSize: 13, cursor: 'pointer' }}>Clear</button>
                )}
              </div>
              {memResults === null && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
                  {cats.map(c => (
                    <button key={c} onClick={() => setMemCatFilter(c)} style={{
                      padding: '4px 14px', borderRadius: 20, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
                      background: memCatFilter === c ? (catColors[c] || 'var(--accent)') : 'var(--bg3)',
                      color: memCatFilter === c ? '#fff' : 'var(--text2)',
                    }}>{c}{c !== 'all' ? ` (${allMemories.filter(m => m.category === c).length})` : ` (${allMemories.length})`}</button>
                  ))}
                </div>
              )}

              {/* ── Memory Cards ── */}
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', marginBottom: 10 }}>
                {memResults !== null ? `⌕ Results (${filtered.length})` : `▸ Long-Term Memories (${filtered.length})`}
              </div>
              {filtered.length === 0 ? (
                <div style={{ color: 'var(--text3)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
                  {memResults !== null ? 'No memories match that search.' : 'No memories stored yet.'}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                  {filtered.map((m, i) => {
                    const cc = catColors[m.category] || '#888';
                    const imp = Math.min(m.importance || 0, 5);
                    return (
                      <div key={m.id || i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', borderLeft: `3px solid ${cc}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: cc, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{m.category || '—'}</span>
                          <span style={{ fontSize: 11, color: '#faa61a', letterSpacing: 1 }}>{'★'.repeat(imp)}{'☆'.repeat(5 - imp)}</span>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 4, textTransform: 'capitalize' }}>{(m.key || '').replace(/_/g, ' ')}</div>
                        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5, wordBreak: 'break-word' }}>{m.value}</div>
                        <div style={{ display: 'flex', gap: 10, marginTop: 8, fontSize: 11, color: 'var(--text3)' }}>
                          {m.created_at && <span>{new Date(m.created_at).toLocaleDateString()}</span>}
                          {m.access_count > 0 && <span>recalled {m.access_count}×</span>}
                          {m.source && <span style={{ marginLeft: 'auto', color: 'var(--text4)' }}>{m.source}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── SYSTEM ── */}
        {tab === 'system' && (
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16, color: 'var(--text)' }}>System Status</div>
            {sysData ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, marginBottom: 24 }}>
                {Object.entries(sysData).map(([k, v]) => (
                  <div key={k} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
                    <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{k.replace(/_/g, ' ')}</div>
                    <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 500, wordBreak: 'break-all' }}>
                      {typeof v === 'object' ? JSON.stringify(v, null, 2).slice(0, 120) : String(v)}
                    </div>
                  </div>
                ))}
              </div>
            ) : <div style={{ color: 'var(--text3)', fontSize: 13, marginBottom: 24 }}>Loading system data...</div>}

            {/* ── Nova's Programs ── */}
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              Nova's Programs
              <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400 }}>({programs.length})</span>
              {programs.filter(p => p.status === 'generated').length > 0 && (
                <span style={{ fontSize: 11, color: '#faa61a', fontWeight: 600, background: '#faa61a18', padding: '2px 8px', borderRadius: 4 }}>
                  {programs.filter(p => p.status === 'generated').length} awaiting review
                </span>
              )}
              {programs.filter(p => p.status === 'executed').length > 0 && (
                <span style={{ fontSize: 11, color: '#57f287', fontWeight: 600, background: '#57f28718', padding: '2px 8px', borderRadius: 4 }}>
                  {programs.filter(p => p.status === 'executed').length} successful
                </span>
              )}
              <button onClick={() => {
                if (!window.confirm('Delete all programs and let Nova rebuild a clean set?')) return;
                fetch(`${API}/sentinel/programs/reset`, { method: 'POST' })
                  .then(r => r.json())
                  .then(() => { setTimeout(refreshSentinel, 1500); })
                  .catch(() => {});
              }} style={{ marginLeft: 'auto', background: '#ed424520', border: '1px solid #ed424560', color: '#ed4245', fontSize: 11, fontWeight: 600, padding: '3px 12px', borderRadius: 6, cursor: 'pointer' }}>
                Reset &amp; Rebuild
              </button>
            </div>
            <div style={{ marginBottom: 24 }}>
              {programs.length ? programs.map((p, i) => {
                const statusColors = { generated: '#faa61a', approved: '#57f287', rejected: '#ed4245', executed: '#5865f2', failed: '#ed4245' };
                const statusLabels = { generated: 'Pending Review', approved: 'Approved', rejected: 'Rejected', executed: 'Executed', failed: 'Failed' };
                const langIcons = { bash: 'SH', python: 'PY', javascript: 'JS' };
                const catColors = { permissions: '#e67e22', dependencies: '#3498db', auth: '#e74c3c', network: '#2ecc71', config: '#9b59b6', security: '#e74c3c', diagnostic: '#95a5a6' };
                const sc = statusColors[p.status] || '#aaa';
                const cc = catColors[p.category] || '#888';
                const isExpanded = expandedProgram === p.id;
                return (
                  <div key={p.id || i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', marginBottom: 10, borderLeft: `3px solid ${sc}` }}>
                    {/* ── Header Row ── */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: p.language === 'python' ? '#3776AB' : p.language === 'bash' ? '#4EAA25' : '#f7df1e', padding: '2px 6px', borderRadius: 3, fontFamily: 'monospace' }}>{langIcons[p.language] || p.language}</span>
                          {p.category && <span style={{ fontSize: 10, fontWeight: 600, color: cc, background: `${cc}18`, padding: '2px 6px', borderRadius: 3, textTransform: 'uppercase' }}>{p.category}</span>}
                          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{p.name || p.title || p.filename}</span>
                          {p.version > 1 && <span style={{ fontSize: 10, fontWeight: 600, color: '#5865f2', background: '#5865f220', padding: '2px 6px', borderRadius: 3 }}>v{p.version}</span>}
                          {p.retry_count > 0 && <span style={{ fontSize: 10, fontWeight: 600, color: '#faa61a', background: '#faa61a20', padding: '2px 6px', borderRadius: 3 }}>Retry {p.retry_count}/{p.max_retries}</span>}
                          {p.parent_program_id && <span style={{ fontSize: 10, color: '#5865f2', fontStyle: 'italic' }}>improved</span>}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>{p.description}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          <span>Created: {p.created_at ? new Date(p.created_at * 1000).toLocaleString() : '?'}</span>
                          {p.source_lines && <span>{p.source_lines} lines</span>}
                          {p.approved_by && <span>By: {p.approved_by}</span>}
                          <span>Finding: {p.trigger_finding_id || '?'}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: sc, textTransform: 'uppercase', background: `${sc}18`, padding: '3px 10px', borderRadius: 4 }}>{statusLabels[p.status] || p.status}</span>
                      </div>
                    </div>

                    {/* ── Success Summary (green banner for executed programs) ── */}
                    {p.status === 'executed' && p.success_summary && (
                      <div style={{ marginTop: 6, background: '#57f28712', borderRadius: 8, padding: '10px 14px', border: '1px solid #57f28730' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#57f287', marginBottom: 4, letterSpacing: 0.5 }}>
                          FIX APPLIED SUCCESSFULLY
                        </div>
                        <div style={{ fontSize: 13, color: '#a8f5c0', lineHeight: 1.5, fontWeight: 500 }}>{p.success_summary}</div>
                      </div>
                    )}

                    {/* ── Nova's Reasoning (why she built it) ── */}
                    {p.reasoning && (
                      <div style={{ marginTop: 8, background: 'var(--bg)', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#5865f2', marginBottom: 4, letterSpacing: 0.5 }}>
                          NOVA'S REASONING
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>{p.reasoning}</div>
                      </div>
                    )}

                    {/* ── Plan (step by step) ── */}
                    {p.plan && p.plan.length > 0 && (
                      <div style={{ marginTop: 8, background: 'var(--bg)', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#faa61a', marginBottom: 6, letterSpacing: 0.5 }}>
                          EXECUTION PLAN
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {p.plan.map((step, si) => (
                            <div key={si} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: p.status === 'executed' ? '#57f287' : '#faa61a', background: p.status === 'executed' ? '#57f28720' : '#faa61a20', padding: '1px 6px', borderRadius: 3, minWidth: 20, textAlign: 'center', flexShrink: 0 }}>{p.status === 'executed' ? '\u2713' : si + 1}</span>
                              <span style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.4 }}>{step}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Management (how Nova manages it) ── */}
                    {p.management && (
                      <div style={{ marginTop: 8, padding: '6px 14px', fontSize: 11, color: 'var(--text3)', fontStyle: 'italic', lineHeight: 1.4 }}>
                        {p.management}
                      </div>
                    )}

                    {/* ── Failure diagnosis ── */}
                    {p.failure_diagnosis && p.status === 'failed' && (
                      <div style={{ marginTop: 6, background: '#ed424510', borderRadius: 6, padding: '8px 12px', border: '1px solid #ed424530' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#ed4245', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                          Nova's Diagnosis
                        </div>
                        <div style={{ fontSize: 12, color: '#f0a0a0', lineHeight: 1.4 }}>{p.failure_diagnosis}</div>
                      </div>
                    )}

                    {/* ── Improvement History ── */}
                    {p.improvements && p.improvements.length > 0 && (
                      <div style={{ marginTop: 8, background: '#5865f208', borderRadius: 8, padding: '10px 14px', border: '1px solid #5865f220' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#5865f2', marginBottom: 6, letterSpacing: 0.5 }}>
                          IMPROVEMENT HISTORY
                        </div>
                        {p.improvements.map((imp, ii) => (
                          <div key={ii} style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4, paddingLeft: 10, borderLeft: '2px solid #5865f240' }}>
                            <span style={{ fontWeight: 600, color: '#5865f2' }}>v{imp.version}</span>
                            <span style={{ color: 'var(--text3)', marginLeft: 8 }}>{imp.timestamp ? new Date(imp.timestamp * 1000).toLocaleDateString() : ''}</span>
                            <div style={{ marginTop: 2 }}>{(imp.changes || []).join(' / ')}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ── Action buttons ── */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      <button onClick={() => setExpandedProgram(isExpanded ? null : p.id)} style={{ background: 'var(--bg3)', border: 'none', color: 'var(--text2)', fontSize: 12, padding: '4px 12px', borderRadius: 6, cursor: 'pointer' }}>
                        {isExpanded ? 'Hide Source' : 'View Source'}
                      </button>
                      {p.status === 'generated' && p.id && (
                        <>
                          <button onClick={() => {
                            fetch(`${API}/sentinel/programs/${p.id}/approve`, { method: 'POST' }).then(r => r.json()).then(() => refreshSentinel()).catch(() => {});
                          }} style={{ background: '#57f287', border: 'none', color: '#000', fontSize: 12, fontWeight: 600, padding: '4px 14px', borderRadius: 6, cursor: 'pointer' }}>Approve & Execute</button>
                          <button onClick={() => {
                            fetch(`${API}/sentinel/programs/${p.id}/reject`, { method: 'POST' }).then(r => r.json()).then(() => refreshSentinel()).catch(() => {});
                          }} style={{ background: '#ed424530', border: '1px solid #ed4245', color: '#ed4245', fontSize: 12, fontWeight: 600, padding: '4px 14px', borderRadius: 6, cursor: 'pointer' }}>Reject</button>
                        </>
                      )}
                      {p.status === 'failed' && p.id && p.retry_count < (p.max_retries || 3) && (
                        <button onClick={() => {
                          fetch(`${API}/sentinel/programs/${p.id}/retry`, { method: 'POST' }).then(r => r.json()).then(() => refreshSentinel()).catch(() => {});
                        }} style={{ background: '#faa61a', border: 'none', color: '#000', fontSize: 12, fontWeight: 600, padding: '4px 14px', borderRadius: 6, cursor: 'pointer' }}>Retry & Fix</button>
                      )}
                      {p.status === 'failed' && p.retry_count >= (p.max_retries || 3) && (
                        <span style={{ fontSize: 11, color: '#ed4245', fontStyle: 'italic', alignSelf: 'center' }}>Max retries reached</span>
                      )}
                      {(p.status === 'executed' || p.status === 'failed') && p.id && (
                        <button onClick={() => {
                          fetch(`${API}/sentinel/programs/${p.id}/improve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }).then(r => r.json()).then(d => {
                            if (d.message) { /* no improvements needed */ } else { refreshSentinel(); }
                          }).catch(() => {});
                        }} style={{ background: '#5865f220', border: '1px solid #5865f2', color: '#5865f2', fontSize: 12, fontWeight: 600, padding: '4px 14px', borderRadius: 6, cursor: 'pointer' }}>Improve</button>
                      )}
                    </div>

                    {/* ── Source code viewer ── */}
                    {isExpanded && (
                      <div style={{ marginTop: 10, background: 'var(--bg)', borderRadius: 8, padding: 14, border: '1px solid var(--border)', maxHeight: 300, overflow: 'auto' }}>
                        <pre style={{ margin: 0, fontSize: 12, color: 'var(--text)', fontFamily: 'monospace', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                          {p.source_code || 'Loading...'}
                        </pre>
                      </div>
                    )}

                    {/* ── Execution output ── */}
                    {p.execution_output && (
                      <div style={{ marginTop: 8, background: p.status === 'executed' ? '#57f28710' : '#ed424510', borderRadius: 6, padding: '8px 12px', border: `1px solid ${p.status === 'executed' ? '#57f28740' : '#ed424540'}` }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: p.status === 'executed' ? '#57f287' : '#ed4245', marginBottom: 4 }}>
                          {p.status === 'executed' ? 'Execution Output' : 'Error Output'}
                        </div>
                        <pre style={{ margin: 0, fontSize: 11, color: 'var(--text2)', fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
                          {p.execution_output}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              }) : (
                <div style={{ color: 'var(--text3)', fontSize: 13, background: 'var(--bg2)', borderRadius: 8, padding: 20, textAlign: 'center' }}>
                  {sentinel?.running ? 'Nova is analyzing systems... programs will appear as issues are found.' : 'Sentinel not running. No programs generated yet.'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── GOALS / TASKS ── */}
        {tab === 'goals' && (
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16, color: 'var(--text)' }}>Tasks & Goals ({goals.length})</div>
            {goals.length ? goals.map((g, i) => (
              <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: g.status === 'done' ? '#57f287' : g.status === 'in-progress' ? '#faa61a' : 'var(--text3)'
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{g.title || g.task || g.description || JSON.stringify(g)}</div>
                  {g.priority && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Priority: {g.priority}</div>}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'capitalize', background: 'var(--bg3)', padding: '2px 8px', borderRadius: 4 }}>{g.status || 'pending'}</span>
              </div>
            )) : <div style={{ color: 'var(--text3)', fontSize: 13 }}>No tasks found.</div>}
          </div>
        )}

        {/* ── ACTIVITY ── */}
        {tab === 'activity' && (
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16, color: 'var(--text)' }}>Activity Log</div>
            {activity.length ? activity.map((a, i) => (
              <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 8, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ color: 'var(--text)', fontWeight: 500 }}>{a.action || a.event || a.type || 'Event'}</span>
                  <span style={{ color: 'var(--text3)', fontSize: 11 }}>{a.timestamp || a.time || ''}</span>
                </div>
                {(a.detail || a.message || a.details) && (
                  <div style={{ color: 'var(--text2)' }}>{a.detail || a.message || a.details}</div>
                )}
              </div>
            )) : <div style={{ color: 'var(--text3)', fontSize: 13 }}>No activity found.</div>}
          </div>
        )}

        {/* ── SECURITY (Sentinel) ── */}
        {tab === 'security' && (
          <div>
            {/* Loading state */}
            {secLoading && (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <div style={{ width: 40, height: 40, border: '3px solid var(--border)', borderTop: '3px solid #5865f2', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
                <div style={{ color: 'var(--text2)', fontSize: 14 }}>Connecting to Security Sentinel...</div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }`}</style>
              </div>
            )}

            {!secLoading && (
              <>
                {/* Status bar + scan trigger */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      Security Sentinel
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: sentinel?.running ? '#57f287' : '#ed4245', display: 'inline-block', animation: sentinel?.running ? 'pulse 2s infinite' : 'none' }} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                      {sentinel ? (
                        <>
                          {sentinel.running ? 'Actively monitoring' : 'Stopped'} · {sentinel.services_monitored || 0} services · {sentinel.total_scans} scans · {sentinel.total_findings} findings · {sentinel.total_programs} programs
                          {sentinel.last_scan && <> · Last: {new Date(sentinel.last_scan.started_at * 1000).toLocaleTimeString()}</>}
                        </>
                      ) : 'Sentinel not available — restart Nova backend'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {scanning && <span style={{ fontSize: 12, color: '#5865f2', animation: 'pulse 1s infinite' }}>{scanStep || 'Scanning...'}</span>}
                    <button disabled={scanning} onClick={() => {
                      setScanning(true);
                      setScanStep('Initiating scan...');
                      fetch(`${API}/sentinel/scan`, { method: 'POST' }).then(r => r.json()).then(() => {
                        const steps = ['Checking ports...', 'Probing endpoints...', 'Auditing files...', 'Analyzing logs...', 'Generating fixes...', 'Finalizing...'];
                        let i = 0;
                        const t = setInterval(() => { setScanStep(steps[i] || 'Almost done...'); i++; if (i > steps.length + 2) { clearInterval(t); setScanning(false); setScanStep(''); refreshSentinel(); } }, 2000);
                      }).catch(() => { setScanning(false); setScanStep(''); });
                    }} style={{
                      padding: '8px 18px', borderRadius: 8, border: 'none', cursor: scanning ? 'not-allowed' : 'pointer',
                      background: scanning ? 'var(--bg3)' : 'linear-gradient(135deg,#5865f2,#eb459e)', color: '#fff', fontWeight: 600, fontSize: 13, opacity: scanning ? 0.6 : 1,
                    }}>{scanning ? 'Scanning...' : 'Trigger Scan'}</button>
                  </div>
                </div>

                {/* Severity summary bar */}
                {sentinel?.severity_counts && Object.keys(sentinel.severity_counts).length > 0 && (
                  <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                    {[['critical', '#ed4245'], ['high', '#faa61a'], ['medium', '#fee75c'], ['low', '#57f287'], ['info', '#5865f2']].map(([level, color]) => {
                      const count = sentinel.severity_counts[level] || 0;
                      if (!count) return null;
                      return (
                        <div key={level} style={{ background: `${color}15`, border: `1px solid ${color}40`, borderRadius: 8, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 700, fontSize: 18, color }}>{count}</span>
                          <span style={{ fontSize: 12, color: 'var(--text2)', textTransform: 'uppercase' }}>{level}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Service grid */}
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  Monitored Services
                  <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400 }}>({sentinelServices.length})</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 24 }}>
                  {sentinelServices.length ? sentinelServices.map((s, i) => (
                    <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.port > 0 ? '#57f287' : 'var(--text3)', display: 'inline-block' }} />
                        {s.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>Port: {s.port || 'file-only'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{s.critical_files} files · {s.auth_endpoints} auth endpoints</div>
                    </div>
                  )) : (
                    <div style={{ color: 'var(--text3)', fontSize: 13, padding: 12 }}>
                      {sentinel?.running ? 'Loading services...' : 'Sentinel not running. Restart Nova to initialize.'}
                    </div>
                  )}
                </div>

                {/* Findings */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    Findings
                    <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400 }}>({findings.length})</span>
                    {findings.filter(f => !f.acknowledged).length > 0 && (
                      <span style={{ fontSize: 11, color: '#ed4245', fontWeight: 600 }}>{findings.filter(f => !f.acknowledged).length} new</span>
                    )}
                  </div>
                  {findings.length > 0 && (
                    <button onClick={() => {
                      fetch(`${API}/sentinel/findings/ack-all`, { method: 'POST' }).then(() => {
                        setFindings(f => f.map(x => ({ ...x, acknowledged: true })));
                      }).catch(() => {});
                    }} style={{ background: 'var(--bg3)', border: 'none', color: 'var(--text2)', fontSize: 12, padding: '4px 12px', borderRadius: 6, cursor: 'pointer' }}>Acknowledge All</button>
                  )}
                </div>
                <div style={{ marginBottom: 24 }}>
                  {findings.length ? findings.map((f, i) => {
                    const colors = { critical: '#ed4245', high: '#faa61a', medium: '#fee75c', low: '#57f287', info: '#5865f2' };
                    const c = colors[f.threat_level] || colors.info;
                    return (
                      <div key={f.id || i} style={{
                        background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', marginBottom: 8,
                        opacity: f.acknowledged ? 0.5 : 1, borderLeft: `3px solid ${c}`, transition: 'opacity 0.3s',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: c, textTransform: 'uppercase', background: `${c}18`, padding: '2px 8px', borderRadius: 4 }}>{f.threat_level}</span>
                            <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', background: 'var(--bg3)', padding: '2px 6px', borderRadius: 3 }}>{f.category}</span>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{f.title}</span>
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{f.service}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text2)' }}>{f.description}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                          {f.remediation && <span style={{ fontSize: 11, color: '#57f287' }}>Fix: {f.remediation}</span>}
                          {f.auto_remediated && <span style={{ fontSize: 10, color: '#5865f2', background: '#5865f218', padding: '1px 6px', borderRadius: 3 }}>Auto-fix created</span>}
                          {!f.acknowledged && f.id && (
                            <button onClick={() => {
                              fetch(`${API}/sentinel/findings/${f.id}/ack`, { method: 'POST' }).then(() => {
                                setFindings(prev => prev.map(x => x.id === f.id ? { ...x, acknowledged: true } : x));
                              }).catch(() => {});
                            }} style={{ background: 'var(--bg3)', border: 'none', color: 'var(--text3)', fontSize: 11, padding: '3px 10px', borderRadius: 4, cursor: 'pointer', marginLeft: 'auto' }}>Ack</button>
                          )}
                        </div>
                      </div>
                    );
                  }) : (
                    <div style={{ color: 'var(--text3)', fontSize: 13, background: 'var(--bg2)', borderRadius: 8, padding: 20, textAlign: 'center' }}>
                      {sentinel?.running ? 'Scanning... findings will appear here.' : 'No findings yet.'}
                    </div>
                  )}
                </div>

                {/* Scan History */}
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, color: 'var(--text)' }}>Scan History ({scanHistory.length})</div>
                {scanHistory.length ? scanHistory.map((s, i) => (
                  <div key={s.id || i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 8, fontSize: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ color: 'var(--text)', fontWeight: 500 }}>Scan #{scanHistory.length - i}</span>
                      <span style={{ color: 'var(--text3)', fontSize: 11 }}>{s.started_at ? new Date(s.started_at * 1000).toLocaleString() : ''}</span>
                    </div>
                    <div style={{ color: 'var(--text2)', fontSize: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <span>Services: {s.services_scanned || '?'}</span>
                      <span>Findings: {s.findings_count || 0}</span>
                      {s.critical_count > 0 && <span style={{ color: '#ed4245', fontWeight: 600 }}>Critical: {s.critical_count}</span>}
                      <span>Duration: {s.duration_seconds ? `${s.duration_seconds}s` : '?'}</span>
                      {s.programs_generated > 0 && <span style={{ color: '#5865f2' }}>Programs: {s.programs_generated}</span>}
                    </div>
                    {s.summary && <div style={{ color: 'var(--text3)', fontSize: 11, marginTop: 3 }}>{s.summary}</div>}
                  </div>
                )) : <div style={{ color: 'var(--text3)', fontSize: 13 }}>{sentinel?.running ? 'First scan starting soon...' : 'No scans yet.'}</div>}
              </>
            )}
          </div>
        )}

        {/* ── PIPELINE (10-Step Security Pipeline) ── */}
        {tab === 'pipeline' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  Security Pipeline
                  {pipelineData?.fallback_active && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#ed4245', background: '#ed424520', padding: '2px 10px', borderRadius: 4, animation: 'pulse 1.5s infinite' }}>FALLBACK MODE</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                  {pipelineData ? `${pipelineData.deployed_count}/${pipelineData.total} deployed · ${pipelineData.installed_count}/${pipelineData.total} installed` : 'Loading...'}
                </div>
              </div>
              <button onClick={() => {
                fetch(`${API}/pipeline/status`).then(r => r.json()).then(setPipelineData).catch(() => {});
              }} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text2)', fontWeight: 600, fontSize: 13 }}>Refresh</button>
            </div>

            {/* Progress bar */}
            {pipelineData && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ height: 8, background: 'var(--bg4)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${(pipelineData.deployed_count / pipelineData.total) * 100}%`, height: '100%', background: 'linear-gradient(90deg, #57f287, #5865f2)', borderRadius: 4, transition: 'width 0.5s' }} />
                </div>
              </div>
            )}

            {/* Steps grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
              {(pipelineData?.steps || []).map(s => {
                const isActive = s.active === true;
                const isInstalled = s.installed;
                const isTest = s.active === null;
                const statusColor = isActive ? '#57f287' : isInstalled ? '#faa61a' : '#ed4245';
                const statusLabel = isActive ? 'Running' : isTest ? (isInstalled ? 'Ready' : 'Not Installed') : isInstalled ? 'Installed' : 'Not Installed';
                return (
                  <div key={s.step} style={{ background: 'var(--bg2)', border: `1px solid ${isActive ? '#57f28740' : 'var(--border)'}`, borderRadius: 12, padding: '16px 18px', borderLeft: `3px solid ${statusColor}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: `${statusColor}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, color: statusColor }}>{s.step}</div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{s.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{s.detail}</div>
                        </div>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, background: `${statusColor}18`, padding: '3px 10px', borderRadius: 4, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{statusLabel}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pipeline flow diagram */}
            {pipelineData && (
              <div style={{ marginTop: 24, background: 'var(--bg2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', marginBottom: 12 }}>Pipeline Flow</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12 }}>
                  {(pipelineData.steps || []).map((s, i) => {
                    const isActive = s.active === true;
                    const c = isActive ? '#57f287' : s.installed ? '#faa61a' : '#ed4245';
                    return (
                      <React.Fragment key={s.step}>
                        <span style={{ background: `${c}20`, border: `1px solid ${c}60`, color: c, padding: '4px 10px', borderRadius: 6, fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {s.step}. {s.name}
                        </span>
                        {i < pipelineData.steps.length - 1 && <span style={{ color: 'var(--text3)' }}>→</span>}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            )}

            {!pipelineData && (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>
                Loading pipeline status...
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
