import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * NovaCallWidget — sleek voice + facetime UI for Jarvis.
 *
 * Three primary buttons:
 *   ☎ Call / End      — start/stop the call
 *   🎤 Mute           — toggle Jarvis's TTS output
 *   📹 Facetime       — toggle camera; while on, frames are captured and
 *                       sent to /api/vision so Jarvis can SEE what you show him.
 *
 * Pipeline:
 *   mic → Web SpeechRecognition (with type-fallback)
 *   ↓
 *   ws://127.0.0.1:8951/ws/chat   (full Jarvis brain + tools)
 *   ↓
 *   speechSynthesis (TTS)
 *
 * Cross-widget bus:
 *   • voice-call:turn   { role, text }
 *   • voice-call:state  { state }
 *
 * Auto-start when ?call=1 is in the popout URL.
 */

const WS_URL = 'ws://127.0.0.1:8951/ws/chat';
const VISION_URL = 'http://127.0.0.1:8951/api/vision';

const CALL_HINT =
  '[VOICE CALL — keep replies to 1-2 short conversational sentences, no markdown, ' +
  'no bullets, no code, sound like a person speaking. Tools allowed if absolutely needed.]';

const STATES = {
  IDLE:       { label: 'Tap Call',      tone: 'muted',   ringHsl: '215, 12%, 32%' },
  CONNECTING: { label: 'Connecting…',   tone: 'warn',    ringHsl: '38, 92%, 55%'  },
  LISTENING:  { label: 'Listening',     tone: 'accent',  ringHsl: '195, 90%, 55%' },
  THINKING:   { label: 'Thinking…',     tone: 'accent2', ringHsl: '270, 70%, 65%' },
  SPEAKING:   { label: 'Speaking',      tone: 'ok',      ringHsl: '142, 65%, 50%' },
  ERROR:      { label: 'Error',         tone: 'err',     ringHsl: '0, 80%, 60%'   },
};

function getRecognition() {
  const Cls = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Cls) return null;
  const r = new Cls();
  r.continuous = false;
  r.interimResults = true;
  r.lang = navigator.language || 'en-US';
  return r;
}

const publish = (channel, payload) => {
  try { window.nova?.bus?.publish?.(channel, payload); } catch {}
};

export default function NovaCallWidget() {
  const [state, setState]       = useState('IDLE');
  const [error, setError]       = useState('');
  const [transcript, setTranscript] = useState([]);
  const [partial, setPartial]   = useState('');
  const [muted, setMuted]       = useState(false);
  const [facetime, setFacetime] = useState(false);
  const [voices, setVoices]     = useState([]);
  const [voiceURI, setVoiceURI] = useState('');
  const [level, setLevel]       = useState(0);
  const [wsState, setWsState]   = useState('connecting');
  const [convId, setConvId]     = useState(null);
  const [sttBroken, setSttBroken] = useState(false);
  const [typeDraft, setTypeDraft] = useState('');
  const [lastSeen, setLastSeen] = useState(''); // last vision description

  const recogRef     = useRef(null);
  const audioCtxRef  = useRef(null);
  const analyserRef  = useRef(null);
  const streamRef    = useRef(null);
  const camStreamRef = useRef(null);
  const videoRef     = useRef(null);
  const canvasRef    = useRef(null);
  const visionTimerRef = useRef(null);
  const rafRef       = useRef(0);
  const inCallRef    = useRef(false);
  const startedAtRef = useRef(0);
  const wsRef        = useRef(null);
  const replyBufRef  = useRef('');
  const pendingResolveRef = useRef(null);
  const lastSeenRef  = useRef('');
  const lastPartialRef  = useRef('');       // last interim STT result used as fallback
  const askNovaTimerRef = useRef(null);     // timeout guard so askNova never hangs
  const startListeningRef = useRef(null);  // always points to latest startListening
  const sttBrokenRef  = useRef(false);     // mirror for closures
  const [, forceTick] = useState(0);

  /* ── ws to terminal AI ─────────────────────────────────────────────── */
  useEffect(() => {
    let disposed = false;
    let reconn = null;
    const connect = () => {
      if (disposed) return;
      let ws;
      try { ws = new WebSocket(WS_URL); }
      catch { reconn = setTimeout(connect, 1000); return; }
      wsRef.current = ws;
      setWsState('connecting');
      ws.onopen  = () => setWsState('open');
      ws.onerror = () => setWsState('error');
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        setWsState('closed');
        if (!disposed) reconn = setTimeout(connect, 1000);
      };
      ws.onmessage = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'token') {
          replyBufRef.current += msg.content || '';
        } else if (msg.type === 'conversation_created') {
          setConvId(msg.conversation_id);
        } else if (msg.type === 'done') {
          clearTimeout(askNovaTimerRef.current);
          const text = (msg.full_response || replyBufRef.current || '').trim();
          replyBufRef.current = '';
          const resolve = pendingResolveRef.current;
          pendingResolveRef.current = null;
          resolve?.(text);
        } else if (msg.type === 'error') {
          clearTimeout(askNovaTimerRef.current);
          replyBufRef.current = '';
          const resolve = pendingResolveRef.current;
          pendingResolveRef.current = null;
          resolve?.('');
          setError(msg.message || 'AI error');
        }
      };
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(reconn);
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
    };
  }, []);

  /* ── tts voices ───────────────────────────────────────────────────── */
  useEffect(() => {
    const load = () => {
      const v = window.speechSynthesis?.getVoices?.() || [];
      setVoices(v);
      if (!voiceURI && v.length) {
        const pick =
          v.find((x) => /en[-_](US|GB)/i.test(x.lang) && /female|samantha|google.*us/i.test(x.name)) ||
          v.find((x) => /^en/i.test(x.lang)) ||
          v[0];
        if (pick) setVoiceURI(pick.voiceURI);
      }
    };
    load();
    window.speechSynthesis?.addEventListener?.('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', load);
  }, [voiceURI]);

  useEffect(() => {
    if (state === 'IDLE') return;
    const t = setInterval(() => forceTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  /* ── mic level meter ───────────────────────────────────────────────── */
  const startMeter = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const an  = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      analyserRef.current = an;
      const buf = new Uint8Array(an.frequencyBinCount);
      const loop = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3.5));
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      setError('Mic access denied');
      throw e;
    }
  }, []);

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    streamRef.current?.getTracks?.().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close?.();
    audioCtxRef.current = null;
    analyserRef.current = null;
    setLevel(0);
  }, []);

  /* ── facetime: camera + periodic vision capture ─────────────────────── */
  const startCamera = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      camStreamRef.current = s;
      setFacetime(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
      }, 50);
      // Capture a frame every 6s and send to /api/vision so Jarvis can react.
      visionTimerRef.current = setInterval(captureFrame, 6000);
      // Also capture once immediately
      setTimeout(captureFrame, 1500);
    } catch (e) {
      setError('Camera denied: ' + (e?.message || e));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopCamera = useCallback(() => {
    clearInterval(visionTimerRef.current);
    visionTimerRef.current = null;
    try { camStreamRef.current?.getTracks?.().forEach((t) => t.stop()); } catch {}
    camStreamRef.current = null;
    setFacetime(false);
  }, []);

  const captureFrame = useCallback(async () => {
    const v = videoRef.current; const c = canvasRef.current;
    if (!v || !c || !v.videoWidth) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0, v.videoWidth, v.videoHeight);
    const dataUrl = c.toDataURL('image/jpeg', 0.7);
    const b64 = (dataUrl.split(',')[1] || '');
    if (!b64) return;
    try {
      const r = await fetch(VISION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: [b64],
          prompt: 'Briefly describe what you see in this video frame from Cayden\'s camera. ' +
                  'One short sentence. If nothing has changed since the last frame, just say "same view".',
        }),
      });
      const j = await r.json();
      if (j?.ok && j.description) {
        const desc = j.description.trim();
        lastSeenRef.current = desc;
        setLastSeen(desc);
      }
    } catch {}
  }, []);

  /* ── ask Jarvis ────────────────────────────────────────────────────── */
  const askNova = (text) => new Promise((resolve) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) { resolve(''); return; }
    replyBufRef.current = '';
    pendingResolveRef.current = resolve;
    // Safety timeout — if no 'done' arrives in 30s, resolve with empty so
    // the call loop always continues rather than hanging forever.
    clearTimeout(askNovaTimerRef.current);
    askNovaTimerRef.current = setTimeout(() => {
      if (pendingResolveRef.current === resolve) {
        pendingResolveRef.current = null;
        replyBufRef.current = '';
        resolve('');
      }
    }, 30000);
    let composed = `${CALL_HINT}\n${text}`;
    if (facetime && lastSeenRef.current) {
      composed = `${CALL_HINT}\n[CAMERA VIEW: ${lastSeenRef.current}]\n${text}`;
    }
    const payload = {
      type: 'message',
      content: composed,
      conversation_id: convId || undefined,
    };
    try { ws.send(JSON.stringify(payload)); }
    catch { clearTimeout(askNovaTimerRef.current); pendingResolveRef.current = null; resolve(''); }
  });

  /* ── recognition cycle ─────────────────────────────────────────────── */
  const startListening = useCallback(() => {
    if (!inCallRef.current) return;
    const r = getRecognition();
    if (!r) { setError('Speech recognition not supported'); setState('ERROR'); return; }
    recogRef.current = r;
    setPartial('');
    setState('LISTENING');
    publish('voice-call:state', { state: 'LISTENING' });
    let finalText = '';
    lastPartialRef.current = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const seg = e.results[i];
        if (seg.isFinal) finalText += seg[0].transcript;
        else interim += seg[0].transcript;
      }
      // Save last interim so onend can use it as fallback if isFinal never fires
      if (interim) lastPartialRef.current = interim;
      setPartial(interim || finalText);
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (['network', 'service-not-allowed', 'not-allowed', 'language-not-supported'].includes(e.error)) {
        sttBrokenRef.current = true;
        setSttBroken(true);
        setError(`Mic STT unavailable (${e.error}) — type instead`);
      } else setError(`Speech: ${e.error}`);
    };
    r.onend = () => {
      if (!inCallRef.current) return;
      setPartial('');
      // Use finalText first; fall back to last interim in case isFinal never fired
      const t = (finalText || lastPartialRef.current).trim();
      lastPartialRef.current = '';
      if (t) { startListeningRef.current && handleUtterance(t); return; }
      if (sttBrokenRef.current) return;
      setTimeout(() => { if (inCallRef.current) startListeningRef.current?.(); }, 200);
    };
    try { r.start(); } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId, facetime]);

  // Keep ref in sync so handleUtterance always calls the freshest startListening
  useEffect(() => { startListeningRef.current = startListening; }, [startListening]);

  const handleUtterance = async (text) => {
    setTranscript((t) => [...t, { role: 'user', text }]);
    publish('voice-call:turn', { role: 'user', text });
    setState('THINKING');
    publish('voice-call:state', { state: 'THINKING' });
    let hadError = false;
    try {
      const reply = await askNova(text);
      // Strip any <thinking>...</thinking> from spoken reply
      const clean = (reply || '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
      if (clean) {
        setTranscript((t) => [...t, { role: 'assistant', text: clean }]);
        publish('voice-call:turn', { role: 'assistant', text: clean });
        await speak(clean);
      }
    } catch (e) {
      setError(String(e?.message || e));
      hadError = true;
      setState('ERROR');
    } finally {
      // Use refs — React state is stale inside async closures
      if (inCallRef.current && !hadError && !sttBrokenRef.current) {
        startListeningRef.current?.();
      } else if (inCallRef.current && !hadError) {
        setState('LISTENING');
        publish('voice-call:state', { state: 'LISTENING' });
      }
    }
  };

  const submitTyped = () => {
    const t = typeDraft.trim();
    if (!t || !inCallRef.current) return;
    setTypeDraft('');
    handleUtterance(t);
  };

  const speak = (text) => new Promise((resolve) => {
    if (!text || muted) { resolve(); return; }
    setState('SPEAKING');
    publish('voice-call:state', { state: 'SPEAKING' });
    const u = new SpeechSynthesisUtterance(text);
    const v = voices.find((x) => x.voiceURI === voiceURI);
    if (v) u.voice = v;
    u.rate = 1.02; u.pitch = 1.0;
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
    // Watchdog: Chrome/Linux speechSynthesis.onend sometimes never fires.
    // Estimate based on word count (avg ~150 wpm), minimum 3s.
    const wpm = 150;
    const words = text.split(/\s+/).length;
    const ms = Math.max(3000, Math.ceil((words / wpm) * 60000) + 1500);
    setTimeout(done, ms);
  });

  const startCall = useCallback(async () => {
    if (wsState !== 'open') { setError('Bridge not connected'); setState('ERROR'); return; }
    setError('');
    setTranscript([]);
    inCallRef.current = true;
    startedAtRef.current = Date.now();
    setState('CONNECTING');
    publish('voice-call:state', { state: 'CONNECTING' });
    try {
      await startMeter();
      startListening();
    } catch {
      inCallRef.current = false;
      setState('ERROR');
    }
  }, [wsState, startMeter, startListening]);

  const endCall = useCallback(() => {
    inCallRef.current = false;
    try { recogRef.current?.abort(); } catch {}
    recogRef.current = null;
    window.speechSynthesis?.cancel?.();
    stopMeter();
    stopCamera();
    setState('IDLE');
    publish('voice-call:state', { state: 'ENDED' });
    setPartial('');
  }, [stopMeter, stopCamera]);

  /* ── auto-start when ?call=1 ───────────────────────────────────────── */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('call') === '1') {
      const t = setInterval(() => {
        if (wsState === 'open' && !inCallRef.current) {
          clearInterval(t);
          startCall();
        }
      }, 250);
      return () => clearInterval(t);
    }
  }, [wsState, startCall]);

  useEffect(() => () => { endCall(); }, [endCall]);

  const meta = STATES[state] || STATES.IDLE;
  const elapsed = state === 'IDLE' ? 0 : Math.floor((Date.now() - startedAtRef.current) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const ringScale = state === 'LISTENING' ? 1 + level * 0.35 :
                    state === 'SPEAKING'  ? 1 + 0.10 * Math.sin(Date.now() / 180) :
                    state === 'THINKING'  ? 1 + 0.06 * Math.sin(Date.now() / 250) : 1;

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-nova-bg via-nova-bg to-nova-panel/60 text-nova-text overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-3 py-1.5 border-b border-nova-border/50 bg-nova-panel/40 backdrop-blur drag-region">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${state === 'IDLE' ? 'bg-nova-muted' : 'bg-nova-accent animate-pulse'}`} />
          <span className="font-display text-xs tracking-wide">Jarvis</span>
          <span className={`text-[9px] font-mono px-1 rounded ${
            wsState === 'open' ? 'text-nova-ok' : 'text-nova-warn'
          }`}>{wsState === 'open' ? '● live' : wsState}</span>
        </div>
        <div className="text-[10px] font-mono text-nova-muted tabular-nums">
          {state !== 'IDLE' ? `${mm}:${ss}` : '—'}
        </div>
      </header>

      {/* Stage */}
      <div className="flex-1 flex flex-col items-center justify-center gap-2 px-3 py-2 min-h-0 relative">
        {/* Facetime preview replaces avatar when on */}
        {facetime ? (
          <div className="relative w-full max-w-[260px] aspect-video rounded-xl overflow-hidden border border-nova-accent/40 shadow-[0_0_30px_-10px_rgba(0,212,255,0.6)]">
            <video ref={videoRef} className="w-full h-full object-cover -scale-x-100" playsInline muted />
            <canvas ref={canvasRef} className="hidden" />
            <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/40 backdrop-blur text-[9px] font-mono text-nova-ok">
              ● LIVE
            </div>
            {lastSeen && (
              <div className="absolute bottom-1.5 left-1.5 right-1.5 px-2 py-1 rounded bg-black/60 backdrop-blur text-[10px] text-white truncate">
                👁 {lastSeen}
              </div>
            )}
          </div>
        ) : (
          <div className="relative" style={{ width: 110, height: 110 }}>
            <div
              className="absolute inset-0 rounded-full border-2 transition-transform"
              style={{
                borderColor: `hsla(${meta.ringHsl}, ${state === 'IDLE' ? 0.4 : 0.85})`,
                boxShadow: state !== 'IDLE' ? `0 0 24px -4px hsla(${meta.ringHsl}, 0.5)` : 'none',
                transform: `scale(${ringScale.toFixed(3)})`,
                transitionDuration: '120ms',
              }}
            />
            <div className="absolute inset-2 rounded-full bg-gradient-to-br from-nova-accent/30 via-nova-accent2/25 to-nova-bg border border-nova-border/60 flex items-center justify-center backdrop-blur">
              <span className="font-display text-4xl text-nova-accent drop-shadow">✦</span>
            </div>
            {state === 'LISTENING' && (
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-end gap-0.5 h-3">
                {Array.from({ length: 9 }).map((_, i) => {
                  const phase = (i - 4) / 4;
                  const h = Math.max(2, level * 14 * (1 - Math.abs(phase) * 0.6) + 2);
                  return <div key={i} className="w-0.5 bg-nova-accent rounded" style={{ height: h }} />;
                })}
              </div>
            )}
          </div>
        )}

        {/* Status label */}
        <div className="text-center">
          <div className={`font-display text-sm text-nova-${meta.tone}`}>{meta.label}</div>
          <div className="text-[10.5px] text-nova-muted font-mono truncate max-w-[260px] h-3">
            {state === 'LISTENING' && partial ? `"${partial}"` :
             state === 'ERROR'     ? error :
             facetime              ? 'facetime on' :
             ''}
          </div>
        </div>

        {/* Last few transcript lines */}
        {transcript.length > 0 && (
          <div className="w-full max-h-20 overflow-y-auto bg-nova-panel/40 border border-nova-border/50 rounded-lg px-2 py-1 space-y-0.5 text-[11px] backdrop-blur">
            {transcript.slice(-4).map((m, i) => (
              <div key={i} className="flex gap-1.5">
                <span className={`shrink-0 ${m.role === 'user' ? 'text-nova-accent' : 'text-nova-accent2'}`}>
                  {m.role === 'user' ? 'you' : 'jarvis'}
                </span>
                <span className="text-nova-text/90 flex-1 leading-tight">{m.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* Type fallback */}
        {state !== 'IDLE' && (
          <div className="w-full flex gap-1.5">
            <input
              type="text"
              value={typeDraft}
              onChange={(e) => setTypeDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitTyped(); } }}
              placeholder={sttBroken ? 'Type to Jarvis (mic STT unavailable)…' : 'Or type…'}
              className="nova-input text-[11px] flex-1 py-1"
            />
            <button
              onClick={submitTyped}
              disabled={!typeDraft.trim() || state === 'THINKING'}
              className="nova-btn-primary text-[11px] px-2 py-1"
            >Send</button>
          </div>
        )}
      </div>

      {/* Footer — three big sleek buttons */}
      <footer className="border-t border-nova-border/50 px-3 py-2.5 bg-nova-panel/50 backdrop-blur">
        <div className="flex items-center justify-center gap-3">
          {/* Mute */}
          <button
            onClick={() => setMuted((m) => !m)}
            disabled={state === 'IDLE'}
            title={muted ? 'Unmute Jarvis' : 'Mute Jarvis'}
            className={[
              'w-11 h-11 rounded-full flex items-center justify-center text-base transition-all',
              'border backdrop-blur',
              state === 'IDLE'
                ? 'border-nova-border/40 text-nova-muted/50 cursor-not-allowed'
                : muted
                  ? 'border-nova-warn/60 bg-nova-warn/15 text-nova-warn shadow-[0_0_12px_-2px_rgba(245,158,11,0.5)]'
                  : 'border-nova-border bg-nova-panel2/60 text-nova-text hover:border-nova-accent/40 hover:text-nova-accent',
            ].join(' ')}
          >
            {muted ? '🔇' : '🔊'}
          </button>

          {/* Call / End — primary */}
          {state === 'IDLE' ? (
            <button
              onClick={startCall}
              disabled={wsState !== 'open'}
              title="Start call"
              className="w-14 h-14 rounded-full bg-gradient-to-br from-nova-ok to-emerald-600 hover:from-emerald-400 hover:to-emerald-600 disabled:opacity-40 text-white text-xl shadow-[0_4px_20px_-4px_rgba(34,197,94,0.7)] transition-all hover:scale-105 active:scale-95"
            >☎</button>
          ) : (
            <button
              onClick={endCall}
              title="End call"
              className="w-14 h-14 rounded-full bg-gradient-to-br from-nova-err to-rose-700 hover:from-rose-500 text-white text-xl shadow-[0_4px_20px_-4px_rgba(239,68,68,0.7)] transition-all hover:scale-105 active:scale-95 rotate-[135deg]"
            >☎</button>
          )}

          {/* Facetime */}
          <button
            onClick={() => facetime ? stopCamera() : startCamera()}
            disabled={state === 'IDLE'}
            title={facetime ? 'Stop facetime' : 'Show Jarvis something (facetime)'}
            className={[
              'w-11 h-11 rounded-full flex items-center justify-center text-base transition-all',
              'border backdrop-blur',
              state === 'IDLE'
                ? 'border-nova-border/40 text-nova-muted/50 cursor-not-allowed'
                : facetime
                  ? 'border-nova-accent/60 bg-nova-accent/15 text-nova-accent shadow-[0_0_12px_-2px_rgba(0,212,255,0.6)]'
                  : 'border-nova-border bg-nova-panel2/60 text-nova-text hover:border-nova-accent/40 hover:text-nova-accent',
            ].join(' ')}
          >
            📹
          </button>
        </div>

        {/* Voice picker (collapsed when idle) */}
        {state === 'IDLE' && voices.length > 0 && (
          <div className="mt-2">
            <select
              value={voiceURI}
              onChange={(e) => setVoiceURI(e.target.value)}
              className="nova-input text-[10px] w-full py-1"
              title="Jarvis's voice"
            >
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>
              ))}
            </select>
          </div>
        )}
      </footer>
    </div>
  );
}
