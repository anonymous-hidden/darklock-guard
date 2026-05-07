import React, { useCallback, useEffect, useRef, useState } from 'react';

const SWATCHES = ['#ffffff', '#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#00c7be', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff2d55'];
const SCENES = [
  { id: 'chill',  label: 'Chill',  emoji: '🌙' },
  { id: 'focus',  label: 'Focus',  emoji: '🎯' },
  { id: 'movie',  label: 'Movie',  emoji: '🎬' },
  { id: 'sunset', label: 'Sunset', emoji: '🌅' },
  { id: 'forest', label: 'Forest', emoji: '🌲' },
  { id: 'party',  label: 'Party',  emoji: '🎉' },
  { id: 'sleep',  label: 'Sleep',  emoji: '💤' },
  { id: 'cyber',  label: 'Cyber',  emoji: '🤖' },
  { id: 'ocean',  label: 'Ocean',  emoji: '🌊' },
];
const SONGS = ['alert', 'doorbell', 'jingle', 'rise', 'fall', 'birthday', 'march', 'tetris', 'siren', 'shave'];

function hexToRgb(hex) {
  const clean = String(hex || '#ffffff').replace('#', '');
  const n = parseInt(clean, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function classifyError(msg) {
  const m = String(msg || '').toLowerCase();
  if (m.includes('token not found')) return { kind: 'token', hint: 'No bridge token. Start the Darklock server (npm run start in /darklock) so it generates data/room-bridge-token.txt.' };
  if (m.includes('econnrefused')) return { kind: 'offline', hint: 'Bridge is not running. Start it with: node darklock/services/room-control-bridge.js (or run Darklock).' };
  if (m.includes('timeout')) return { kind: 'timeout', hint: 'Bridge did not respond. Check the Pico USB connection and the bridge logs.' };
  if (m.includes('401') || m.includes('unauthor')) return { kind: 'auth', hint: 'Token mismatch. Restart the bridge to refresh the token.' };
  return { kind: 'error', hint: msg };
}

export default function RoomControlWidget() {
  const [health, setHealth] = useState(null);
  const [bridge, setBridge] = useState({ state: 'checking', detail: '' });
  const [lights, setLights] = useState([]);
  const [sensor, setSensor] = useState(null);
  const [brightness, setBrightness] = useState(60);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState('lights'); // lights | buzzer | sensor
  const toastTimer = useRef(null);

  const showToast = (text, kind = 'ok') => {
    setToast({ text, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };

  const call = useCallback(async (path, method = 'GET', body = null, { silent = false } = {}) => {
    if (!silent) setBusy(true);
    try {
      const fn = window.nova?.control?.room?.request;
      if (!fn) throw new Error('Nova bridge unavailable (run inside Nova desktop)');
      const r = await fn(path, method, body);
      if (!r?.ok) throw new Error(r?.error || r?.body?.error || 'bridge error');
      return r.body || r;
    } catch (e) {
      if (!silent) showToast(String(e?.message || e), 'err');
      throw e;
    } finally {
      if (!silent) setBusy(false);
    }
  }, []);

  const probe = useCallback(async () => {
    setBridge({ state: 'checking', detail: '' });
    try {
      const h = await call('/health', 'GET', null, { silent: true });
      setHealth(h);
      setBridge({ state: 'online', detail: h?.pico?.connected ? 'Pico connected' : 'Pico offline' });
      try {
        const l = await call('/lights', 'GET', null, { silent: true });
        if (l?.devices) setLights(l.devices);
      } catch {}
      return true;
    } catch (e) {
      const info = classifyError(e?.message || e);
      setHealth(null);
      setBridge({ state: info.kind, detail: info.hint });
      return false;
    }
  }, [call]);

  useEffect(() => { probe(); }, [probe]);

  // Auto-poll health every 20s while bridge is offline (gentle retry)
  useEffect(() => {
    if (bridge.state === 'online' || bridge.state === 'checking') return;
    const t = setInterval(() => { probe(); }, 20000);
    return () => clearInterval(t);
  }, [bridge.state, probe]);

  const wrap = async (label, fn) => {
    try {
      await fn();
      showToast(label, 'ok');
    } catch {}
  };

  const setPower = (on) => wrap(on ? 'Lights on' : 'Lights off', () => call('/lights/power', 'POST', { on }));
  const setColor = (hex) => wrap(`Color ${hex}`, () => call('/lights/color', 'POST', hexToRgb(hex)));
  const setScene = (scene) => wrap(`Scene: ${scene}`, () => call('/lights/scene', 'POST', { scene }));
  const setLightBrightness = (value) => wrap(`Brightness ${value}%`, () => call('/lights/brightness', 'POST', { value }));
  const refreshLights = () => wrap('Refreshed', () => call('/lights/refresh', 'POST').then((d) => d?.devices && setLights(d.devices)));
  const beep = (ms) => wrap('Beep', () => call('/buzzer/active', 'POST', { ms }));
  const stopBeep = () => wrap('Stopped', () => call('/buzzer/active/stop', 'POST'));
  const playSong = (name) => wrap(`Playing ${name}`, () => call('/buzzer/song', 'POST', { name }));
  const stopSong = () => wrap('Song stopped', () => call('/buzzer/song/stop', 'POST'));
  const readSensor = () => wrap('Sensor read', async () => {
    const r = await call('/sensor');
    if (r) setSensor({ ...r, at: Date.now() });
  });

  const offline = bridge.state !== 'online' && bridge.state !== 'checking';

  return (
    <div className="h-full flex flex-col bg-nova-bg text-nova-text overflow-hidden">
      {/* Header */}
      <header className="px-3 py-2 border-b border-nova-border bg-gradient-to-r from-nova-panel/80 to-nova-panel2/40 flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full ${
          bridge.state === 'online' ? 'bg-nova-ok shadow-[0_0_8px_rgba(61,220,132,0.6)]' :
          bridge.state === 'checking' ? 'bg-nova-muted animate-pulse-soft' : 'bg-nova-err animate-pulse-soft'
        }`} />
        <div className="flex-1 min-w-0">
          <div className="font-display text-sm">Room Control</div>
          <div className="text-[10px] text-nova-muted truncate">
            {bridge.state === 'online' && (health?.pico?.connected ? `Bridge online · Pico connected` : `Bridge online · Pico offline`)}
            {bridge.state === 'checking' && 'Checking bridge…'}
            {offline && 'Bridge unavailable'}
          </div>
        </div>
        <button disabled={busy} onClick={probe} className="nova-btn text-[11px]" title="Refresh">↻</button>
      </header>

      {/* Tabs */}
      <nav className="flex border-b border-nova-border bg-nova-panel/40">
        {[
          { id: 'lights', label: 'Lights' },
          { id: 'buzzer', label: 'Sound'  },
          { id: 'sensor', label: 'Climate' },
        ].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 py-2 text-[11px] uppercase tracking-wider border-b-2 transition-colors ${
              tab === t.id ? 'border-nova-accent text-nova-accent' : 'border-transparent text-nova-muted hover:text-nova-text'
            }`}>
            {t.label}
          </button>
        ))}
      </nav>

      {/* Toast */}
      {toast && (
        <div className={`absolute right-3 top-12 z-10 px-3 py-1.5 rounded text-[11px] shadow-lg border ${
          toast.kind === 'ok' ? 'bg-nova-ok/15 border-nova-ok/50 text-nova-ok' : 'bg-nova-err/15 border-nova-err/50 text-nova-err'
        }`}>
          {toast.text}
        </div>
      )}

      {/* Bridge offline banner */}
      {offline && (
        <div className="m-3 p-3 rounded-lg border border-nova-warn/40 bg-nova-warn/10">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-base">⚠</span>
            <div className="font-display text-sm text-nova-warn">Bridge {bridge.state}</div>
          </div>
          <div className="text-[11px] text-nova-muted leading-relaxed">{bridge.detail || 'No additional details.'}</div>
          <div className="flex gap-2 mt-2">
            <button onClick={probe} className="nova-btn text-[11px]">Retry</button>
            <button onClick={() => window.nova?.control?.openPath?.('http://localhost:3099/health')} className="nova-btn text-[11px]">Open /health</button>
          </div>
        </div>
      )}

      <div className={`flex-1 min-h-0 overflow-y-auto p-3 space-y-3 ${offline ? 'opacity-50 pointer-events-none' : ''}`}>
        {tab === 'lights' && (
          <>
            <section className="rounded-lg border border-nova-border/60 bg-gradient-to-br from-nova-panel/70 to-nova-panel2/40 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-wider text-nova-accent2">Power</div>
                <div className="text-[10px] text-nova-muted">{lights.length} device{lights.length === 1 ? '' : 's'}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button disabled={busy} onClick={() => setPower(true)} className="nova-btn-primary text-xs py-2">Turn On</button>
                <button disabled={busy} onClick={() => setPower(false)} className="nova-btn text-xs py-2">Turn Off</button>
              </div>
              <button disabled={busy} onClick={refreshLights} className="nova-btn text-[11px] w-full mt-2">Rediscover devices</button>
            </section>

            <section className="rounded-lg border border-nova-border/60 bg-nova-panel/45 p-3">
              <div className="text-[10px] uppercase tracking-wider text-nova-accent2 mb-2">Color</div>
              <div className="grid grid-cols-5 gap-2">
                {SWATCHES.map((hex) => (
                  <button key={hex} disabled={busy} onClick={() => setColor(hex)}
                    className="h-10 rounded-md border border-white/15 hover:border-white/40 hover:scale-[1.04] transition-transform shadow-inner"
                    style={{ background: hex, boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.2), 0 0 12px ${hex}66` }}
                    title={hex} />
                ))}
              </div>
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-nova-muted">Brightness</span>
                  <span className="text-[11px] font-mono">{brightness}%</span>
                </div>
                <input type="range" min="1" max="100" value={brightness}
                  onChange={(e) => setBrightness(Number(e.target.value))}
                  onPointerUp={(e) => setLightBrightness(Number(e.currentTarget.value))}
                  className="w-full accent-nova-accent" />
              </div>
            </section>

            <section className="rounded-lg border border-nova-border/60 bg-nova-panel/45 p-3">
              <div className="text-[10px] uppercase tracking-wider text-nova-accent2 mb-2">Scenes</div>
              <div className="grid grid-cols-3 gap-1.5">
                {SCENES.map((s) => (
                  <button key={s.id} disabled={busy} onClick={() => setScene(s.id)}
                    className="flex flex-col items-center gap-0.5 py-2 rounded-md border border-nova-border/50 bg-nova-bg/50 hover:border-nova-accent/50 hover:bg-nova-accent/10 transition-colors">
                    <span className="text-base">{s.emoji}</span>
                    <span className="text-[10px]">{s.label}</span>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        {tab === 'buzzer' && (
          <>
            <section className="rounded-lg border border-nova-border/60 bg-nova-panel/45 p-3">
              <div className="text-[10px] uppercase tracking-wider text-nova-accent2 mb-2">Active Buzzer</div>
              <div className="grid grid-cols-3 gap-2">
                <button disabled={busy} onClick={() => beep(300)} className="nova-btn text-xs py-2">Chirp</button>
                <button disabled={busy} onClick={() => beep(800)} className="nova-btn text-xs py-2">Beep</button>
                <button disabled={busy} onClick={() => beep(2500)} className="nova-btn text-xs py-2">Long</button>
              </div>
              <button disabled={busy} onClick={stopBeep} className="nova-btn-danger text-[11px] w-full mt-2">Stop buzzer</button>
            </section>

            <section className="rounded-lg border border-nova-border/60 bg-nova-panel/45 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-wider text-nova-accent2">Songs</div>
                <button disabled={busy} onClick={stopSong} className="text-[10px] text-nova-err hover:underline">Stop</button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {SONGS.map((name) => (
                  <button key={name} disabled={busy} onClick={() => playSong(name)}
                    className="text-[11px] py-2 rounded-md border border-nova-border/50 bg-nova-bg/40 hover:border-nova-accent/50 capitalize">
                    {name}
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        {tab === 'sensor' && (
          <section className="rounded-lg border border-nova-border/60 bg-gradient-to-br from-nova-panel/70 to-nova-panel2/40 p-3">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] uppercase tracking-wider text-nova-accent2">Climate</div>
              <button disabled={busy} onClick={readSensor} className="nova-btn text-[11px]">Read</button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="bg-nova-bg/60 rounded-lg p-4 border border-nova-border/50">
                <div className="text-3xl font-display text-nova-accent">{sensor?.temp ?? '--'}</div>
                <div className="text-[10px] text-nova-muted mt-1">Temperature °C</div>
              </div>
              <div className="bg-nova-bg/60 rounded-lg p-4 border border-nova-border/50">
                <div className="text-3xl font-display text-nova-accent2">{sensor?.humidity ?? '--'}</div>
                <div className="text-[10px] text-nova-muted mt-1">Humidity %</div>
              </div>
            </div>
            {sensor?.at && (
              <div className="text-[10px] text-nova-muted text-center mt-2 font-mono">
                Updated {new Date(sensor.at).toLocaleTimeString()}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
