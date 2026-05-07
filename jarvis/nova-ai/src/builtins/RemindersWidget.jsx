import React, { useState, useEffect, useCallback, useRef } from 'react';

function fmt(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m ${s%60}s`;
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
}

export default function RemindersWidget() {
  const publish = (action, summary) => {
    try { window.nova?.bus?.publish?.('widget:event', { widget: 'reminders', action, summary }); } catch {}
  };

  const [reminders, setReminders] = useState([]);
  const [text, setText]           = useState('');
  const [delay, setDelay]         = useState('5');
  const [unit, setUnit]           = useState('m');  // s | m | h
  const [now, setNow]             = useState(Date.now());
  const idSeq = useRef(Date.now());

  /* tick every second so countdowns stay live */
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  /* fire due reminders */
  useEffect(() => {
    setReminders(prev => {
      let changed = false;
      const next = prev.map(r => {
        if (!r.fired && Date.now() >= r.fireAt) {
          changed = true;
          // desktop notification
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('⏰ Nova Reminder', { body: r.text });
          }
          publish('fired', r.text);
          return { ...r, fired: true };
        }
        return r;
      });
      return changed ? next : prev;
    });
  }, [now]);

  /* request notification permission on mount */
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const add = useCallback(() => {
    const t = text.trim();
    if (!t) return;
    const secs = parseFloat(delay) || 1;
    const ms   = secs * (unit === 's' ? 1000 : unit === 'm' ? 60000 : 3600000);
    const r = { id: ++idSeq.current, text: t, createdAt: Date.now(), fireAt: Date.now() + ms, fired: false };
    setReminders(prev => [r, ...prev]);
    publish('add', t);
    setText('');
    setDelay('5');
  }, [text, delay, unit]);

  const remove = (id) => {
    setReminders(prev => prev.filter(r => r.id !== id));
    publish('remove', String(id));
  };

  const pending = reminders.filter(r => !r.fired);
  const fired   = reminders.filter(r => r.fired);

  return (
    <div className="flex flex-col gap-3 h-full p-3 text-nova-text text-sm font-nova">
      <header className="flex items-center gap-2 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-widest text-nova-warn">
          ⏰ Reminders
        </span>
        <span className="ml-auto text-xs text-nova-muted">{pending.length} pending</span>
      </header>

      {/* add form */}
      <div className="flex gap-2 shrink-0">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Remind me to…"
          className="flex-1 min-w-0 rounded-lg border border-nova-border bg-nova-panel/60 px-3 py-1.5 text-sm placeholder-nova-muted/50 outline-none focus:border-nova-warn/60 transition-colors"
        />
        <input
          type="number"
          min="1"
          value={delay}
          onChange={e => setDelay(e.target.value)}
          className="w-14 rounded-lg border border-nova-border bg-nova-panel/60 px-2 py-1.5 text-sm text-center outline-none focus:border-nova-warn/60 transition-colors"
        />
        <select
          value={unit}
          onChange={e => setUnit(e.target.value)}
          className="rounded-lg border border-nova-border bg-nova-panel/60 px-2 py-1.5 text-sm outline-none focus:border-nova-warn/60 transition-colors"
        >
          <option value="s">s</option>
          <option value="m">m</option>
          <option value="h">h</option>
        </select>
        <button
          onClick={add}
          className="rounded-lg border border-nova-warn/50 bg-nova-warn/20 hover:bg-nova-warn/30 px-3 py-1.5 text-nova-warn font-semibold transition-colors"
        >
          +
        </button>
      </div>

      {/* pending */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-1.5">
        {pending.length === 0 && fired.length === 0 && (
          <p className="text-nova-muted text-xs text-center mt-6">No reminders yet</p>
        )}
        {pending.map(r => {
          const remaining = Math.max(0, r.fireAt - now);
          return (
            <div key={r.id} className="flex items-center gap-2 rounded-lg border border-nova-border bg-nova-panel/40 px-3 py-2">
              <span className="w-2 h-2 rounded-full bg-nova-warn shrink-0 shadow-[0_0_6px_-1px_rgba(245,158,11,0.8)]" />
              <span className="flex-1 text-xs leading-tight">{r.text}</span>
              <span className="text-[10px] text-nova-warn tabular-nums shrink-0">{fmt(remaining)}</span>
              <button onClick={() => remove(r.id)} className="text-nova-muted hover:text-nova-err text-xs transition-colors ml-1">✕</button>
            </div>
          );
        })}

        {fired.length > 0 && (
          <>
            <p className="text-[10px] uppercase tracking-widest text-nova-muted mt-1 px-1">Fired</p>
            {fired.map(r => (
              <div key={r.id} className="flex items-center gap-2 rounded-lg border border-nova-border/40 bg-nova-panel/20 px-3 py-2 opacity-60">
                <span className="w-2 h-2 rounded-full bg-nova-ok shrink-0" />
                <span className="flex-1 text-xs leading-tight line-through">{r.text}</span>
                <button onClick={() => remove(r.id)} className="text-nova-muted hover:text-nova-err text-xs transition-colors ml-1">✕</button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
