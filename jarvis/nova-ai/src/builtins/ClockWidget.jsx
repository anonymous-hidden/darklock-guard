import React, { useEffect, useState, useRef } from 'react';

const ZONES = [
  { label: 'Local',   tz: undefined },
  { label: 'UTC',     tz: 'UTC' },
  { label: 'NYC',     tz: 'America/New_York' },
  { label: 'London',  tz: 'Europe/London' },
  { label: 'Tokyo',   tz: 'Asia/Tokyo' },
];

function fmt(d, tz) {
  return d.toLocaleTimeString([], { hour12: true, hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: tz });
}
function fmtDate(d, tz) {
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz });
}

function sleepStatus(now) {
  const h = now.getHours();
  if (h >= 22 || h < 6) return { label: 'Sleep window', tone: 'text-nova-ok', note: 'Ideal time to wind down.' };
  if (h < 9) return { label: 'Wake window', tone: 'text-nova-accent', note: 'Good morning. Hydrate and stretch.' };
  if (h < 18) return { label: 'Focus window', tone: 'text-nova-accent2', note: 'Prime hours for deep work.' };
  return { label: 'Evening reset', tone: 'text-nova-warn', note: 'Lower lights and reduce stimulation.' };
}

export default function ClockWidget() {
  const [now, setNow] = useState(() => new Date());
  const [tab, setTab] = useState('clock');

  // stopwatch state
  const [swStart, setSwStart] = useState(null);
  const [swElapsed, setSwElapsed] = useState(0);
  const [swRunning, setSwRunning] = useState(false);
  const tickRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (swRunning) {
      tickRef.current = setInterval(() => {
        setSwElapsed(Date.now() - swStart);
      }, 50);
    } else if (tickRef.current) clearInterval(tickRef.current);
    return () => clearInterval(tickRef.current);
  }, [swRunning, swStart]);

  const swToggle = () => {
    if (swRunning) {
      setSwRunning(false);
    } else {
      setSwStart(Date.now() - swElapsed);
      setSwRunning(true);
    }
  };
  const swReset = () => { setSwRunning(false); setSwElapsed(0); setSwStart(null); };

  const ms = swElapsed;
  const sw = `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor((ms%3600000)/60000)).padStart(2,'0')}:${String(Math.floor((ms%60000)/1000)).padStart(2,'0')}.${String(Math.floor((ms%1000)/10)).padStart(2,'0')}`;
  const mood = sleepStatus(now);

  return (
    <div className="h-full flex flex-col p-4 gap-3 text-nova-text bg-[radial-gradient(circle_at_20%_15%,rgba(0,212,255,.16),transparent_42%),radial-gradient(circle_at_80%_10%,rgba(124,92,255,.14),transparent_40%),linear-gradient(180deg,#0a0c14_0%,#070910_100%)]">
      <div className="flex gap-1.5">
        {['clock', 'stopwatch'].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1 text-[11px] rounded-full font-display tracking-wide border ${tab === t ? 'bg-nova-accent/20 border-nova-accent/40 text-nova-accent' : 'border-nova-border text-nova-muted hover:text-nova-text'}`}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {tab === 'clock' ? (
        <div className="flex-1 flex flex-col gap-3">
          <div className="text-center bg-nova-panel/60 border border-nova-border/80 backdrop-blur rounded-2xl px-3 py-4 shadow-[0_10px_30px_rgba(0,0,0,.35)]">
            <div className="font-display text-5xl tabular-nums tracking-wide">{fmt(now)}</div>
            <div className="text-xs text-nova-muted mt-1">{fmtDate(now)}</div>
            <div className={`text-[11px] mt-2 font-mono ${mood.tone}`}>{mood.label}</div>
            <div className="text-[10.5px] text-nova-muted mt-0.5">{mood.note}</div>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-[12px]">
            {ZONES.slice(1).map((z) => (
              <div key={z.label} className="flex justify-between bg-nova-panel/70 border border-nova-border/70 px-2 py-1.5 rounded-lg">
                <span className="text-nova-muted">{z.label}</span>
                <span className="font-mono tabular-nums">{fmt(now, z.tz)}</span>
              </div>
            ))}
          </div>
          <div className="bg-nova-panel/55 border border-nova-border/70 rounded-lg px-3 py-2 text-[11px] flex items-center justify-between">
            <span className="text-nova-muted">Suggested sleep plan</span>
            <span className="font-mono text-nova-text">11:00 PM - 7:00 AM</span>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-nova-panel/55 border border-nova-border/70 rounded-2xl">
          <div className="font-display text-4xl tabular-nums tracking-wide">{sw}</div>
          <div className="flex gap-2">
            <button onClick={swToggle} className="nova-btn-primary text-sm">{swRunning ? 'Pause' : 'Start'}</button>
            <button onClick={swReset} className="nova-btn text-sm">Reset</button>
          </div>
        </div>
      )}
    </div>
  );
}
