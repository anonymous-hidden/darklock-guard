import React, { useEffect, useRef, useState } from 'react';

/**
 * NovaChatWidget — talks to the Nova Terminal brain (ai-terminal-server.py)
 * over its desktop WebSocket contract at ws://127.0.0.1:8951/ws/chat.
 *
 * The brain on the other side is the SAME AITerminal class that powers
 * `ai-terminal.py`, in headless mode. It runs the full system prompt, the
 * full tool registry (lights, spotify, gdocs, gslides, weather, reminders,
 * pentest, web research, code search, memory, browser, etc.), and the
 * tool-loop. We do not run Ollama or the local ToolEngine here anymore —
 * everything routes through the terminal's brain.
 *
 * The widget also receives `widget_action` server events so the AI can
 * pop other widgets (notes, spotify, sysmon, …) by emitting a WIDGET_OPEN:
 * tag in its response. We forward those to window.nova.widgets.popout.
 *
 * UI is unchanged from before, with these UX improvements:
 *   - Textarea is enabled even while connecting (messages queue until WS opens)
 *   - Connection state badge in the header
 *   - Auto-reconnect every 1s if the socket drops
 */

const WS_URL = 'ws://127.0.0.1:8951/ws/chat';
const RECONNECT_MS = 1000;
const WIDGET_SHORTCUTS = [
  'nova-call', 'calendar', 'notes', 'todo', 'weather',
  'sysmon', 'spotify', 'map', 'news', 'room-control', 'clock', 'calculator', 'logs', 'emotions',
];

const WIDGET_LABELS = {
  'nova-call': 'call',
  'calendar': 'calendar',
  'notes': 'notes',
  'todo': 'todo',
  'weather': 'weather',
  'sysmon': 'sysmon',
  'spotify': 'spotify',
  'map': 'map',
  'news': 'news',
  'room-control': 'room',
  'clock': 'clock',
  'calculator': 'calc',
  'logs': 'logs',
  'emotions': 'mood',
};

/* ── Tiny safe markdown renderer (no deps) ──────────────────────────── */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function renderInline(s) {
  let t = escapeHtml(s);
  // images first ![alt](url)
  t = t.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
    '<img src="$2" alt="$1" class="max-h-48 max-w-full rounded-md border border-nova-border my-1" />');
  // links
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer" class="text-nova-accent underline hover:text-nova-accent2">$1</a>');
  // inline code
  t = t.replace(/`([^`]+)`/g, '<code class="bg-nova-panel2/80 border border-nova-border/60 rounded px-1 text-[11.5px]">$1</code>');
  // bold/italic
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong class="text-nova-text font-semibold">$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return t;
}
function renderMarkdown(src) {
  if (!src) return '';
  const lines = String(src).split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // fenced code
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      const lang = fence[1] || '';
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre class="bg-nova-panel2/70 border border-nova-border/60 rounded-md p-2 my-1.5 overflow-x-auto text-[11.5px] leading-snug"><code class="font-mono${lang ? ' lang-' + lang : ''}">${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    // table (simple): row | cell | cell
    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s\-:|]+\|\s*$/.test(lines[i+1])) {
      const head = line.split('|').slice(1, -1).map((c) => c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
        rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
        i++;
      }
      let html = '<table class="my-2 border-collapse text-[11.5px]">';
      html += '<thead><tr>' + head.map((c) => `<th class="border border-nova-border px-1.5 py-0.5 bg-nova-panel2/60 text-left">${renderInline(c)}</th>`).join('') + '</tr></thead>';
      html += '<tbody>' + rows.map((r) => '<tr>' + r.map((c) => `<td class="border border-nova-border/50 px-1.5 py-0.5">${renderInline(c)}</td>`).join('') + '</tr>').join('') + '</tbody>';
      html += '</table>';
      out.push(html);
      continue;
    }
    // headings
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      const lvl = h[1].length;
      const cls = lvl === 1 ? 'text-base font-display mt-1.5' : lvl === 2 ? 'text-[13px] font-display text-nova-accent mt-1.5' : 'text-[12px] font-display text-nova-accent2 mt-1';
      out.push(`<div class="${cls}">${renderInline(h[2])}</div>`);
      i++; continue;
    }
    // blockquote
    if (/^>\s/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote class="border-l-2 border-nova-accent2/60 pl-2 my-1 italic text-nova-text/85">${renderInline(buf.join(' '))}</blockquote>`);
      continue;
    }
    // bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        buf.push(`<li>${renderInline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul class="list-disc list-inside space-y-0.5 my-1">${buf.join('')}</ul>`);
      continue;
    }
    // numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(`<li>${renderInline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol class="list-decimal list-inside space-y-0.5 my-1">${buf.join('')}</ol>`);
      continue;
    }
    // blank line
    if (!line.trim()) { out.push('<div class="h-1"></div>'); i++; continue; }
    // paragraph (collect contiguous non-empty non-special lines)
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,3}\s|>\s|\s*[-*]\s|\s*\d+\.\s|\s*\|.+\|\s*$)/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${renderInline(buf.join(' '))}</p>`);
  }
  return out.join('');
}

/** Split content into { thinking, body } using <thinking>...</thinking>. */
function splitReasoning(content) {
  if (!content) return { thinking: '', body: '' };
  const m = content.match(/<thinking>([\s\S]*?)<\/thinking>/i);
  if (!m) return { thinking: '', body: content };
  const thinking = m[1].trim();
  const body = (content.slice(0, m.index) + content.slice(m.index + m[0].length)).trim();
  // Also handle a still-streaming reasoning block (no closing tag yet)
  return { thinking, body };
}
function splitReasoningStreaming(content) {
  // While streaming, the closing </thinking> may not have arrived yet.
  if (!content) return { thinking: '', body: '', streamingThinking: false };
  const open = content.indexOf('<thinking>');
  if (open === -1) return { thinking: '', body: content, streamingThinking: false };
  const close = content.indexOf('</thinking>', open);
  if (close === -1) {
    return {
      thinking: content.slice(open + 10),
      body: content.slice(0, open),
      streamingThinking: true,
    };
  }
  const thinking = content.slice(open + 10, close);
  const body = (content.slice(0, open) + content.slice(close + 12)).trim();
  return { thinking, body, streamingThinking: false };
}

export default function NovaChatWidget() {
  const [history, setHistory] = useState([]); // { id, role, content, error? }
  const [draft, setDraft]     = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [connState, setConnState] = useState('connecting');
  const [convId, setConvId] = useState(null);
  const [callState, setCallState] = useState('IDLE');
  const [attachments, setAttachments] = useState([]); // {id,name,mime,kind,dataUrl,data_b64}
  const [isDragging, setIsDragging] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [visionPending, setVisionPending] = useState(false);
  const [widgetPulse, setWidgetPulse] = useState(0);
  const [showMemory, setShowMemory] = useState(false);
  const [memories, setMemories] = useState([]);
  const [memLoading, setMemLoading] = useState(false);

  const wsRef = useRef(null);
  const scrollRef = useRef(null);
  const streamRef = useRef('');
  const reconnectTimer = useRef(null);
  const pendingQueue  = useRef([]);   // messages typed while WS not yet open
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const cameraStreamRef = useRef(null);

  const openWidget = (widgetId) => {
    try {
      window.nova?.widgets?.popout?.({
        id: `chat:${widgetId}:${Date.now()}`,
        name: widgetId,
        builtinId: widgetId,
        ...(widgetId === 'nova-call' ? { query: { call: '1' } } : {}),
      });
      setWidgetPulse(Date.now());
    } catch {}
  };

  /* ── WebSocket lifecycle ────────────────────────────────────────────── */
  useEffect(() => {
    let disposed = false;

    const flushQueue = () => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      while (pendingQueue.current.length) {
        const payload = pendingQueue.current.shift();
        try { ws.send(JSON.stringify(payload)); } catch {}
      }
    };

    const open = () => {
      if (disposed) return;
      // If there's already an OPEN socket, leave it.
      const cur = wsRef.current;
      if (cur && (cur.readyState === WebSocket.OPEN || cur.readyState === WebSocket.CONNECTING)) {
        return;
      }

      setConnState('connecting');
      let ws;
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) { try { ws.close(); } catch {} return; }
        setConnState('open');
        flushQueue();
      };

      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        const t = msg.type;
        if (t === 'token') {
          streamRef.current += msg.content || '';
          setStreamText(streamRef.current);
        } else if (t === 'conversation_created') {
          setConvId(msg.conversation_id);
        } else if (t === 'done') {
          const finalText = msg.full_response || streamRef.current || '';
          setHistory((h) => [...h, {
            id: 'a' + Date.now(),
            role: 'assistant',
            content: finalText,
          }]);
          streamRef.current = '';
          setStreamText('');
          setStreaming(false);
        } else if (t === 'error') {
          setHistory((h) => [...h, {
            id: 'e' + Date.now(),
            role: 'assistant',
            error: true,
            content: `error: ${msg.message || 'unknown'}`,
          }]);
          streamRef.current = '';
          setStreamText('');
          setStreaming(false);
        } else if (t === 'widget_action') {
          /* AI asked to open / dock / close a widget */
          const a = msg.action;
          const id = msg.widget;
          try {
            if (a === 'open' && id) {
              window.nova?.widgets?.popout?.({
                id: `chat:${id}:${Date.now()}`,
                name: id,
                builtinId: id,
                // For nova-call we auto-start the call so the user doesn't
                // have to click "Call" after Nova pops it open.
                ...(id === 'nova-call' ? { query: { call: '1' } } : {}),
              });
            } else if (a === 'close' && id) {
              window.nova?.widgets?.closePopout?.(id);
            } else if (a === 'notes_write') {
              const title = (msg.title || 'Nova Note').toString().slice(0, 120);
              const content = (msg.content || '').toString();
              if (content.trim()) {
                (async () => {
                  try {
                    const created = await window.nova?.notes?.create?.({ title, content });
                    window.nova?.bus?.publish?.('widget:event', {
                      widget: 'notes', action: 'saved',
                      summary: `Saved note: ${title}`,
                      noteId: created?.id || null,
                    });
                  } catch (e) {
                    setHistory((h) => [...h, {
                      id: 'e' + Date.now(),
                      role: 'assistant',
                      error: true,
                      content: `error: notes write failed: ${e?.message || e}`,
                    }]);
                  }
                })();
              }
            } else if (a === 'open_terminal_ai') {
              const task = (msg.task || '').toString();
              try {
                window.nova?.control?.openApp?.('terminal');
                window.nova?.bus?.publish?.('widget:event', {
                  widget: 'terminal-ai', action: 'opened',
                  summary: `Handed off to terminal-ai: ${task.slice(0, 80)}`,
                });
              } catch {}
            }
          } catch {}
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        setConnState('closed');
        if (streaming) {
          setHistory((h) => [...h, {
            id: 'e' + Date.now(),
            role: 'assistant',
            error: true,
            content: '— connection dropped, reconnecting… —',
          }]);
          streamRef.current = '';
          setStreamText('');
          setStreaming(false);
        }
        scheduleReconnect();
      };

      ws.onerror = () => {
        // Don't call close() in CONNECTING state — Chromium will throw the
        // noisy "WebSocket is closed before the connection is established"
        // error. The browser closes the socket itself after onerror.
        setConnState('error');
      };
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(open, RECONNECT_MS);
    };

    open();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer.current);
      const ws = wsRef.current;
      wsRef.current = null;
      try { ws?.close(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history.length, streamText]);

  /* ── Cross-widget bus: live call transcript + Nova proactive notes ── */
  useEffect(() => {
    const offTurn = window.nova?.bus?.subscribe?.('voice-call:turn', (p) => {
      if (!p?.text) return;
      setHistory((h) => [...h, {
        id: 'v' + Date.now() + Math.random().toString(36).slice(2, 5),
        role: p.role === 'user' ? 'user' : 'assistant',
        content: p.text,
        kind: 'voice',
      }]);
    });
    const offState = window.nova?.bus?.subscribe?.('voice-call:state', (p) => {
      setCallState(p?.state || 'IDLE');
    });
    // Widget activity bus — we no longer render bubbles for these (Cayden
    // found them noisy). LogsWidget now consumes them instead. We still
    // pulse the header indicator so there's a subtle hint of life.
    const offWidget = window.nova?.bus?.subscribe?.('widget:event', () => {
      setWidgetPulse(Date.now());
    });
    return () => { offTurn?.(); offState?.(); offWidget?.(); };
  }, []);

  /* ── Presence WS — Nova can speak unprompted (reminders, suggestions) ── */
  useEffect(() => {
    let disposed = false;
    let ws = null;
    let timer = null;
    const connect = () => {
      if (disposed) return;
      try { ws = new WebSocket('ws://127.0.0.1:8951/ws/presence'); }
      catch { timer = setTimeout(connect, 2000); return; }
      ws.onmessage = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type !== 'proactive' || !msg.content) return;
        setHistory((h) => [...h, {
          id: 'p' + Date.now(),
          role: 'assistant',
          content: msg.content,
          kind: 'proactive',
          suggestedWidget: msg.suggested_widget || null,
        }]);
      };
      ws.onclose = () => { if (!disposed) timer = setTimeout(connect, 2000); };
      ws.onerror = () => {};
    };
    connect();
    return () => { disposed = true; clearTimeout(timer); try { ws?.close(); } catch {} };
  }, []);

  const ready = connState === 'open';

  /* ── Attachment helpers ─────────────────────────────────────────────── */
  const stripDataUrl = (dataUrl) => (dataUrl || '').split(',')[1] || '';

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    const TEXT_RE = /^(text\/|application\/(json|xml|javascript|x-yaml|x-toml|x-sh))/i;
    const next = [];
    for (const f of files) {
      if (f.size > 8 * 1024 * 1024) {
        setHistory((h) => [...h, { id: 'e' + Date.now(), role: 'assistant', error: true, content: `"${f.name}" is too big (max 8MB).` }]);
        continue;
      }
      const isImage = f.type.startsWith('image/');
      const isText  = TEXT_RE.test(f.type) || /\.(md|txt|csv|json|yml|yaml|py|js|jsx|ts|tsx|sh|css|html|log)$/i.test(f.name);
      if (!isImage && !isText) {
        setHistory((h) => [...h, { id: 'e' + Date.now(), role: 'assistant', error: true, content: `"${f.name}" — only images and text/code files are supported.` }]);
        continue;
      }
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(f);
      });
      next.push({
        id: 'a' + Date.now() + Math.random().toString(36).slice(2, 5),
        name: f.name,
        mime: f.type || (isImage ? 'image/*' : 'text/plain'),
        kind: isImage ? 'image' : 'file',
        dataUrl,
        data_b64: stripDataUrl(dataUrl),
      });
    }
    if (next.length) setAttachments((a) => [...a, ...next]);
  };

  const removeAttachment = (id) => setAttachments((a) => a.filter((x) => x.id !== id));

  /* ── Drag-and-drop ──────────────────────────────────────────────────── */
  const dragCounter = useRef(0);
  const handleDragEnter = (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    dragCounter.current++;
    setIsDragging(true);
  };
  const handleDragLeave = () => {
    dragCounter.current--;
    if (dragCounter.current <= 0) { dragCounter.current = 0; setIsDragging(false); }
  };
  const handleDragOver = (e) => {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault();
  };
  const handleDrop = (e) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files?.length) addFiles(files);
  };

  /* ── Camera ─────────────────────────────────────────────────────────── */
  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      cameraStreamRef.current = stream;
      setCameraOpen(true);
      // attach after render
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); } }, 50);
    } catch (e) {
      setHistory((h) => [...h, { id: 'e' + Date.now(), role: 'assistant', error: true, content: `Camera error: ${e?.message || e}` }]);
    }
  };
  const closeCamera = () => {
    try { cameraStreamRef.current?.getTracks?.().forEach((t) => t.stop()); } catch {}
    cameraStreamRef.current = null;
    setCameraOpen(false);
  };
  const captureCamera = () => {
    const v = videoRef.current; const c = canvasRef.current;
    if (!v || !c) return;
    const w = v.videoWidth || 1280, h = v.videoHeight || 720;
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    const dataUrl = c.toDataURL('image/jpeg', 0.85);
    setAttachments((a) => [...a, {
      id: 'a' + Date.now(),
      name: `capture-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`,
      mime: 'image/jpeg',
      kind: 'image',
      dataUrl,
      data_b64: stripDataUrl(dataUrl),
    }]);
    closeCamera();
  };

  /* paste image from clipboard */
  useEffect(() => {
    const onPaste = (e) => {
      const items = e.clipboardData?.items || [];
      const files = [];
      for (const it of items) {
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) { e.preventDefault(); addFiles(files); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  /* Send a message. Images are uploaded via REST /api/vision first, then the
     description is appended to the text so the LLM always receives it as
     plain text — this is more reliable than passing base64 over WebSocket. */
  const send = async () => {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || streaming || visionPending) return;
    setDraft('');
    const sendingAttachments = attachments.slice();
    setAttachments([]);

    // Show the user's message immediately (with thumbnails)
    setHistory((h) => [...h, {
      id: 'u' + Date.now(),
      role: 'user',
      content: text,
      attachments: sendingAttachments.map((a) => ({ name: a.name, mime: a.mime, kind: a.kind, dataUrl: a.dataUrl })),
    }]);
    streamRef.current = '';
    setStreamText('');
    setStreaming(true);

    // Separate images from text/code files
    const imageAtts = sendingAttachments.filter((a) => a.kind === 'image');
    const fileAtts  = sendingAttachments.filter((a) => a.kind !== 'image');

    // Upload images to the vision REST endpoint before sending the WS turn.
    let visionBlocks = '';
    if (imageAtts.length > 0) {
      setVisionPending(true);
      try {
        const resp = await fetch('http://127.0.0.1:8951/api/vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            images: imageAtts.map((a) => a.data_b64).filter(Boolean),
            prompt: text
              ? `The user attached this image and asked: "${text}". Please answer their question based on what you see in the image.`
              : 'Describe this image in detail. If it contains text (e.g. a document, worksheet, or form), transcribe it verbatim.',
          }),
        });
        const json = await resp.json();
        if (json.ok && json.description) {
          visionBlocks = `\n\n[IMAGE ANALYSIS by ${json.model}]:\n${json.description}\n[END IMAGE ANALYSIS]`;
        } else if (!json.ok) {
          visionBlocks = `\n\n[Vision model unavailable: ${json.error}]`;
        }
      } catch (e) {
        visionBlocks = `\n\n[Vision request failed: ${e?.message || e}]`;
      } finally {
        setVisionPending(false);
      }
    }

    // Inline text/code file contents
    let fileBlocks = '';
    if (fileAtts.length > 0) {
      for (const a of fileAtts) {
        try {
          if (a.data_b64) {
            const decoded = atob(a.data_b64);
            const capped = decoded.length > 16000 ? decoded.slice(0, 16000) + '\n...[truncated]' : decoded;
            fileBlocks += `\n\n--- attached file: ${a.name} ---\n${capped}\n--- end ${a.name} ---`;
          }
        } catch {}
      }
    }

    const combinedContent = (text || '(see attached image)') + visionBlocks + fileBlocks;

    const payload = {
      type: 'message',
      content: combinedContent,
      conversation_id: convId || undefined,
    };
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(payload)); }
      catch { pendingQueue.current.push(payload); }
    } else {
      pendingQueue.current.push(payload);
    }
  };


  const stop = () => {
    const ws = wsRef.current;
    if (!streaming || !ws || ws.readyState !== WebSocket.OPEN) {
      // Local-only stop (couldn't send interrupt — drop streaming state)
      setStreaming(false);
      streamRef.current = '';
      setStreamText('');
      return;
    }
    try { ws.send(JSON.stringify({ type: 'interrupt' })); } catch {}
  };

  const clear = () => {
    setHistory([]);
    setConvId(null);
  };

  const loadMemories = async () => {
    setMemLoading(true);
    try {
      const r = await fetch('http://127.0.0.1:8951/api/memory/all?limit=200');
      const data = await r.json();
      setMemories(Array.isArray(data) ? data : []);
    } catch { setMemories([]); }
    finally { setMemLoading(false); }
  };

  const forgetMemory = async (key) => {
    try {
      await fetch(`http://127.0.0.1:8951/api/memory/${encodeURIComponent(key)}`, { method: 'DELETE' });
      setMemories((m) => m.filter((x) => x.key !== key));
    } catch {}
  };

  const toggleMemory = () => {
    const next = !showMemory;
    setShowMemory(next);
    if (next && memories.length === 0) loadMemories();
  };

  const visible = history;
  const statusLabel =
    connState === 'open'         ? 'connected'
    : connState === 'connecting' ? 'connecting…'
    : connState === 'closed'     ? 'reconnecting…'
    :                              'offline';

  return (
    <div
      className="h-full relative flex flex-col bg-nova-bg text-nova-text"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-nova-accent bg-nova-bg/90 backdrop-blur pointer-events-none">
          <span className="text-4xl">📎</span>
          <span className="text-sm font-display text-nova-accent">Drop files to attach</span>
          <span className="text-[10px] text-nova-muted">images, text, code</span>
        </div>
      )}
      <header className="flex items-center justify-between px-3 py-1.5 border-b border-nova-border bg-nova-panel">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${ready ? 'bg-nova-ok animate-pulse' : 'bg-nova-err'}`} />
          <span className="font-display text-xs">Chat with Nova</span>
          <span
            className="text-[9.5px] font-mono text-nova-accent/80 px-1 rounded border border-nova-accent/30"
            title="Same brain as the terminal AI — full tool surface (lights, spotify, gdocs, weather, browser, code search, memory, …)"
          >terminal-ai</span>
          {callState !== 'IDLE' && callState !== 'ENDED' && (
            <span className="text-[9.5px] font-mono text-nova-ok px-1 rounded border border-nova-ok/40 animate-pulse">☎ {callState.toLowerCase()}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-nova-muted truncate max-w-[120px]">
            {statusLabel}
          </span>
          {visionPending && (
            <span className="text-[9.5px] font-mono text-nova-accent2 px-1 rounded border border-nova-accent2/40 animate-pulse">👁 analyzing…</span>
          )}
          <button
            onClick={toggleMemory}
            title="Nova's memory"
            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${showMemory ? 'text-nova-accent border-nova-accent/50 bg-nova-accent/10' : 'text-nova-muted border-nova-border hover:text-nova-accent'}`}
          >✦ memory{memories.length > 0 ? ` (${memories.length})` : ''}</button>
          <button
            onClick={() => window.nova?.widgets?.popout?.({
              id: `chat:nova-call:${Date.now()}`,
              name: 'nova-call',
              builtinId: 'nova-call',
              query: { call: '1' },
            })}
            title="Call Nova"
            className="text-[10.5px] text-nova-muted hover:text-nova-ok"
          >☎</button>
          <button onClick={clear} className="text-[10.5px] text-nova-muted hover:text-nova-text">clear</button>
        </div>
      </header>

      {/* Memory panel — slides in under header */}
      {showMemory && (
        <div className="border-b border-nova-border/60 bg-nova-panel/60 backdrop-blur max-h-52 overflow-y-auto">
          <div className="flex items-center justify-between px-3 py-1 border-b border-nova-border/40">
            <span className="text-[10px] font-mono text-nova-accent">Nova's Memory</span>
            <div className="flex gap-2">
              <button onClick={loadMemories} className="text-[9.5px] text-nova-muted hover:text-nova-text">↻ refresh</button>
              <span className="text-[9.5px] text-nova-muted">{memories.length} entries</span>
            </div>
          </div>
          {memLoading && <div className="px-3 py-2 text-[10px] text-nova-muted animate-pulse">Loading…</div>}
          {!memLoading && memories.length === 0 && (
            <div className="px-3 py-2 text-[10px] text-nova-muted">
              No memories yet — tell Nova something about yourself and she'll remember it.
            </div>
          )}
          <div className="divide-y divide-nova-border/30">
            {memories.map((m) => (
              <div key={m.id || m.key} className="flex items-start gap-2 px-3 py-1.5 group hover:bg-nova-panel/60">
                <div className="flex-1 min-w-0">
                  <span className="text-[9px] font-mono text-nova-accent2 mr-1.5">[{m.category}]</span>
                  <span className="text-[11px] font-semibold text-nova-text">{m.key}:</span>
                  <span className="text-[11px] text-nova-text/80 ml-1">{m.value}</span>
                </div>
                <button
                  onClick={() => forgetMemory(m.key)}
                  className="text-nova-muted hover:text-nova-err text-sm opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  title="Forget this"
                >×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
        {visible.length === 0 && !streaming && (
          <div className="text-center text-nova-muted text-xs pt-8">
            <div className="font-display text-2xl text-nova-text mb-1">✦</div>
            Say hi to Nova.
          </div>
        )}
        {visible.map((m) => (
          <Bubble key={m.id} role={m.role} content={m.content} error={m.error} kind={m.kind} suggestedWidget={m.suggestedWidget} attachments={m.attachments} />
        ))}
        {streaming && (
          <Bubble role="assistant" content={streamText} streaming />
        )}
      </div>

      <footer className="border-t border-nova-border p-2 bg-nova-panel">
        <div className="mb-1.5 flex gap-1 overflow-x-auto">
          {WIDGET_SHORTCUTS.map((wid) => (
            <button
              key={wid}
              onClick={() => openWidget(wid)}
              className="shrink-0 px-2 py-0.5 rounded text-[10px] font-mono border border-nova-border text-nova-muted hover:text-nova-accent hover:border-nova-accent/40"
              title={`Open ${wid}`}
            >
              {WIDGET_LABELS[wid] || wid}
            </button>
          ))}
        </div>
        {attachments.length > 0 && (
          <div className="flex gap-1.5 mb-1.5 overflow-x-auto">
            {attachments.map((a) => (
              <div key={a.id} className="relative shrink-0 group border border-nova-border rounded bg-nova-bg">
                {a.kind === 'image' ? (
                  <img src={a.dataUrl} alt={a.name} className="h-14 w-14 object-cover rounded" />
                ) : (
                  <div className="h-14 w-20 px-1.5 flex flex-col justify-center text-[9.5px] font-mono text-nova-muted overflow-hidden">
                    <div className="truncate text-nova-text">{a.name}</div>
                    <div className="truncate">{a.mime}</div>
                  </div>
                )}
                <button
                  onClick={() => removeAttachment(a.id)}
                  title="Remove"
                  className="absolute -top-1 -right-1 bg-nova-err text-white rounded-full w-4 h-4 text-[10px] leading-none flex items-center justify-center"
                >×</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-1.5 items-end">
          <input
            type="file"
            ref={fileInputRef}
            multiple
            accept="image/*,text/*,.md,.json,.yml,.yaml,.csv,.log,.py,.js,.jsx,.ts,.tsx,.sh,.css,.html"
            className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Attach file or image"
            className="nova-btn text-xs px-2 py-1.5"
          >📎</button>
          <button
            onClick={openCamera}
            title="Take a photo"
            className="nova-btn text-xs px-2 py-1.5"
          >📷</button>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder={visionPending ? 'Analyzing image…' : attachments.length > 0 ? 'Ask about the attachment…' : 'Message Nova…'}
            rows={1}
            className="nova-input text-sm flex-1 resize-none max-h-32"
            style={{ minHeight: 32 }}
          />
          {streaming || visionPending ? (
            <button onClick={stop} className="nova-btn-danger text-xs px-3" disabled={visionPending}>{visionPending ? '👁…' : 'Stop'}</button>
          ) : (
            <button onClick={send} disabled={(!draft.trim() && attachments.length === 0) || visionPending} className="nova-btn-primary text-xs px-3">Send</button>
          )}
        </div>
        <div className="text-[10px] text-nova-muted mt-1 px-0.5">Enter to send · Shift+Enter for newline · Paste images directly · Drag &amp; drop files</div>
      </footer>

      {cameraOpen && (
        <div className="absolute inset-0 z-50 bg-nova-bg/95 flex flex-col items-center justify-center p-3 gap-2">
          <video ref={videoRef} className="max-w-full max-h-[70%] rounded border border-nova-border" playsInline muted />
          <canvas ref={canvasRef} className="hidden" />
          <div className="flex gap-2">
            <button onClick={captureCamera} className="nova-btn-primary text-xs px-3">📸 Capture</button>
            <button onClick={closeCamera} className="nova-btn-danger text-xs px-3">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReasoningPanel({ text, streaming }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="mt-1 mb-1 border border-nova-accent2/30 rounded-md bg-nova-accent2/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[10.5px] font-mono uppercase tracking-wider text-nova-accent2 hover:bg-nova-accent2/10"
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        <span>{streaming ? 'thinking…' : 'reasoning'}</span>
        {streaming && <span className="ml-1 w-1 h-1 rounded-full bg-nova-accent2 animate-pulse" />}
      </button>
      {open && (
        <div className="px-2 pb-1.5 pt-0.5 text-[11px] leading-relaxed whitespace-pre-wrap text-nova-text/80 border-t border-nova-accent2/20">
          {text}
        </div>
      )}
    </div>
  );
}

function Bubble({ role, content, streaming, error, kind, suggestedWidget, attachments }) {
  const isUser = role === 'user';
  const isVoice = kind === 'voice';
  const isProactive = kind === 'proactive';

  // For assistant messages, separate <thinking>...</thinking> from body.
  const split = !isUser && !error
    ? (streaming ? splitReasoningStreaming(content || '') : splitReasoning(content || ''))
    : { thinking: '', body: content };
  const body = split.body ?? content;
  const thinking = split.thinking || '';
  const streamingThinking = !!split.streamingThinking;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={[
        'max-w-[90%] rounded-lg px-2.5 py-1.5 text-[12.5px] leading-relaxed break-words',
        isUser
          ? (isVoice
              ? 'bg-nova-ok/10 border border-nova-ok/30 text-nova-text'
              : 'bg-gradient-to-br from-nova-accent/20 to-nova-accent/10 border border-nova-accent/40 text-nova-text')
          : error
            ? 'bg-nova-err/10 border border-nova-err/40 text-nova-err font-mono whitespace-pre-wrap'
            : isVoice
              ? 'bg-nova-ok/10 border border-nova-ok/30 text-nova-text whitespace-pre-wrap'
              : isProactive
                ? 'bg-nova-accent2/10 border border-nova-accent2/40 text-nova-text whitespace-pre-wrap'
                : 'bg-nova-panel/80 border border-nova-border text-nova-text',
      ].join(' ')}>
        {(isVoice || isProactive) && (
          <div className="text-[9.5px] font-mono uppercase tracking-wider mb-0.5 opacity-70">
            {isVoice ? '🎙 voice call' : '✨ nova proactive'}
          </div>
        )}
        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {attachments.map((a, i) => (
              a.kind === 'image' && a.dataUrl ? (
                <img key={i} src={a.dataUrl} alt={a.name}
                  className="max-h-40 max-w-[220px] rounded border border-nova-border cursor-zoom-in"
                  onClick={() => window.open(a.dataUrl, '_blank')} />
              ) : (
                <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-nova-bg border border-nova-border">
                  📄 {a.name}
                </span>
              )
            ))}
          </div>
        )}

        {!isUser && !error && thinking && (
          <ReasoningPanel text={thinking} streaming={streamingThinking} />
        )}

        {/* Body — markdown for assistant, plain for user/voice/proactive/error */}
        {!isUser && !error && !isVoice && !isProactive ? (
          body ? (
            <div
              className="prose-nova"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
            />
          ) : streaming && !thinking ? (
            <span className="text-nova-muted">…</span>
          ) : null
        ) : (
          body || (streaming ? <span className="text-nova-muted">…</span> : '')
        )}

        {streaming && body && <span className="inline-block w-1.5 h-3 ml-0.5 bg-nova-accent align-middle animate-pulse" />}

        {isProactive && suggestedWidget && (
          <button
            onClick={() => window.nova?.widgets?.popout?.({
              id: `proactive:${suggestedWidget}:${Date.now()}`,
              name: suggestedWidget,
              builtinId: suggestedWidget,
              ...(suggestedWidget === 'nova-call' ? { query: { call: '1' } } : {}),
            })}
            className="mt-1 nova-btn-primary text-[10px] px-2 py-0.5"
          >Open {suggestedWidget}</button>
        )}
      </div>
    </div>
  );
}
