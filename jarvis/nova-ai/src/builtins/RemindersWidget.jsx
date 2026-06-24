import React, { useCallback, useEffect, useState } from 'react';

function fmt(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function labelOf(r) {
  return r.message || r.text || 'Reminder';
}

export default function RemindersWidget() {
  const publish = (action, summary) => {
    try { window.nova?.bus?.publish?.('widget:event', { widget: 'reminders', action, summary }); } catch {}
  };

  const [reminders, setReminders] = useState([]);
  const [text, setText] = useState('');
  const [delay, setDelay] = useState('5');
  const [unit, setUnit] = useState('m');
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const rows = await window.nova?.reminders?.list?.();
      setReminders(Array.isArray(rows) ? rows : []);
      setError('');
    } catch (e) {
      setError(String(e?.message || e));
    }
  }, []);

  useEffect(() => {
    load();
    const tick = setInterval(() => {
      setNow(Date.now());
      load();
    }, 1000);
    const off = window.nova?.reminders?.onFired?.((r) => {
      publish('fired', labelOf(r));
      load();
    });
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch?.(() => {});
    }
    return () => { clearInterval(tick); off?.(); };
  }, [load]);

  const add = useCallback(async () => {
    const message = text.trim();
    if (!message) return;
    const n = parseFloat(delay) || 1;
    const fromNow = n * (unit === 's' ? 1000 : unit === 'm' ? 60000 : 3600000);
    try {
      await window.nova?.reminders?.add?.({ message, fromNow });
      publish('add', message);
      setText('');
      setDelay('5');
      await load();
    } catch (e) {
      setError(String(e?.message || e));
    }
  }, [text, delay, unit, load]);

  const remove = async (id) => {
    try {
      await window.nova?.reminders?.cancel?.(id);
      publish('remove', String(id));
      await load();
    } catch (e) {
      setError(String(e?.message || e));
    }
  };

  const pending = reminders.filter((r) => !r.fired && Number(r.fireAt) > now);

  return (
    <div className="flex flex-col gap-3 h-full p-3 text-nova-text text-sm font-nova">
      <header className="flex items-center gap-2 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-widest text-nova-warn">
          Reminders
        </span>
        <span className="ml-auto text-xs text-nova-muted">{pending.length} pending</span>
      </header>

      <div className="flex gap-2 shrink-0">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Remind me to..."
          className="flex-1 min-w-0 rounded-lg border border-nova-border bg-nova-panel/60 px-3 py-1.5 text-sm placeholder-nova-muted/50 outline-none focus:border-nova-warn/60 transition-colors"
        />
        <input
          type="number"
          min="1"
          value={delay}
          onChange={(e) => setDelay(e.target.value)}
          className="w-14 rounded-lg border border-nova-border bg-nova-panel/60 px-2 py-1.5 text-sm text-center outline-none focus:border-nova-warn/60 transition-colors"
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
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

      {error && <div className="text-[11px] text-nova-err font-mono">{error}</div>}

      <div className="flex-1 overflow-y-auto flex flex-col gap-1.5">
        {pending.length === 0 && (
          <p className="text-nova-muted text-xs text-center mt-6">No reminders yet</p>
        )}
        {pending.map((r) => {
          const remaining = Number(r.fireAt) - now;
          return (
            <div key={r.id} className="flex items-center gap-2 rounded-lg border border-nova-border bg-nova-panel/40 px-3 py-2">
              <span className="w-2 h-2 rounded-full bg-nova-warn shrink-0 shadow-[0_0_6px_-1px_rgba(245,158,11,0.8)]" />
              <span className="flex-1 text-xs leading-tight">{labelOf(r)}</span>
              <span className="text-[10px] text-nova-warn tabular-nums shrink-0">{fmt(remaining)}</span>
              <button onClick={() => remove(r.id)} className="text-nova-muted hover:text-nova-err text-xs transition-colors ml-1">x</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
