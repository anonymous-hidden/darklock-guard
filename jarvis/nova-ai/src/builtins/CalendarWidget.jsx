import React, { useEffect, useState, useCallback } from 'react';

/**
 * CalendarWidget — local Jarvis calendar.
 *
 * Backed by sqlite in the terminal-AI bridge (port 8951). The AI can add
 * and read events via CALENDAR_ADD / CALENDAR_LIST / CALENDAR_TODAY /
 * CALENDAR_DELETE tool tags, and so can the user via this UI.
 */

const API = 'http://127.0.0.1:8951/api/calendar/events';

function fmtTime(iso) {
  // Server returns "YYYY-MM-DD HH:MM"
  if (!iso) return '';
  const [d, t] = iso.split(' ');
  if (!d) return iso;
  const date = new Date(`${d}T${t || '00:00'}`);
  if (isNaN(date.getTime())) return iso;
  const today = new Date();
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const opts = isToday
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  return date.toLocaleString(undefined, opts);
}

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM (for input[type=datetime-local])
}

function fmtIn(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d`;
}

export default function CalendarWidget() {
  const [events, setEvents]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [scope, setScope]       = useState('upcoming'); // upcoming | today | all
  const [view, setView]         = useState('events'); // events | reminders
  const [showAdd, setShowAdd]   = useState(false);
  const [draft, setDraft]       = useState({ title: '', when: todayISO(), notes: '' });
  const [reminders, setReminders] = useState([]);
  const [reminderDraft, setReminderDraft] = useState({ message: '', mins: 15 });
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`${API}?scope=${scope}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setEvents(Array.isArray(j) ? j : []);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  const loadReminders = useCallback(async () => {
    try {
      const r = await window.nova?.reminders?.list?.();
      if (Array.isArray(r)) setReminders(r);
    } catch {}
  }, []);

  useEffect(() => { loadReminders(); }, [loadReminders]);
  useEffect(() => {
    const refreshTimer = setInterval(loadReminders, 5000);
    const tickTimer = setInterval(() => setNow(Date.now()), 1000);
    const off = window.nova?.reminders?.onFired?.(() => loadReminders());
    return () => { clearInterval(refreshTimer); clearInterval(tickTimer); off?.(); };
  }, [loadReminders]);

  // Refresh whenever Jarvis adds an event via tool. Also listen for chat-driven
  // direct add requests on the bus (any widget can publish calendar:add).
  useEffect(() => {
    const off = window.nova?.bus?.subscribe?.('calendar:changed', load);
    const offAdd = window.nova?.bus?.subscribe?.('calendar:add', async (p) => {
      if (!p?.title) return;
      try {
        await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: p.title,
            starts_at: (p.starts_at || p.when || todayISO().replace('T', ' ')).replace('T', ' '),
            notes: p.notes || '',
          }),
        });
        window.nova?.bus?.publish?.('calendar:changed', { reason: 'chat-add' });
        load();
      } catch {}
    });
    const t = setInterval(load, 30000);
    return () => { off?.(); offAdd?.(); clearInterval(t); };
  }, [load]);

  const add = async (e) => {
    e?.preventDefault?.();
    const title = draft.title.trim();
    if (!title) return;
    const starts_at = draft.when.replace('T', ' ');
    try {
      const r = await fetch(API, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ title, starts_at, notes: draft.notes }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setDraft({ title: '', when: todayISO(), notes: '' });
      setShowAdd(false);
      window.nova?.bus?.publish?.('calendar:changed', { reason: 'add' });
      load();
    } catch (e) {
      setError(String(e?.message || e));
    }
  };

  const remove = async (id) => {
    try {
      const r = await fetch(`${API}/${id}`, { method: 'DELETE' });
      if (!r.ok && r.status !== 404) throw new Error(`HTTP ${r.status}`);
      window.nova?.bus?.publish?.('calendar:changed', { reason: 'delete', id });
      load();
    } catch (e) {
      setError(String(e?.message || e));
    }
  };

  const addReminder = async (e) => {
    e?.preventDefault?.();
    const message = reminderDraft.message.trim();
    if (!message) return;
    const mins = Math.max(1, Math.round(Number(reminderDraft.mins) || 1));
    await window.nova?.reminders?.add?.({ message, fromNow: mins * 60_000 });
    setReminderDraft({ message: '', mins });
    try { window.nova?.bus?.publish?.('widget:event', { widget: 'calendar', action: 'reminder-added', summary: message }); } catch {}
    loadReminders();
  };

  const cancelReminder = async (id) => {
    await window.nova?.reminders?.cancel?.(id);
    try { window.nova?.bus?.publish?.('widget:event', { widget: 'calendar', action: 'reminder-cancelled', summary: 'Reminder cancelled' }); } catch {}
    loadReminders();
  };

  // Group events by date for the upcoming/all views
  const grouped = events.reduce((acc, ev) => {
    const day = (ev.starts_at || '').slice(0, 10);
    (acc[day] = acc[day] || []).push(ev);
    return acc;
  }, {});

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-nova-bg to-nova-panel/30 text-nova-text">
      <header className="flex items-center justify-between px-3 py-1.5 border-b border-nova-border/50 bg-nova-panel/40 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="font-display text-xs flex items-center gap-1"><span className="text-nova-accent2">📅</span> Calendar</span>
          <div className="flex gap-0.5 text-[10px] bg-nova-panel/60 rounded p-0.5 border border-nova-border/40">
            {['events','reminders'].map((s) => (
              <button key={s}
                onClick={() => setView(s)}
                className={`px-1.5 py-0.5 rounded transition-colors ${view === s ? 'bg-nova-accent2/20 text-nova-accent2' : 'text-nova-muted hover:text-nova-text'}`}>
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-0.5 text-[10px] bg-nova-panel/60 rounded p-0.5 border border-nova-border/40">
            {['today','upcoming','all'].map((s) => (
              <button key={s}
                onClick={() => setScope(s)}
                className={`px-1.5 py-0.5 rounded transition-colors ${scope === s ? 'bg-nova-accent/20 text-nova-accent' : 'text-nova-muted hover:text-nova-text'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { load(); loadReminders(); }} title="Refresh" className="text-[12px] text-nova-muted hover:text-nova-text">↻</button>
          <button onClick={() => setShowAdd((v) => !v)} className="nova-btn-primary text-[10px] px-2 py-0.5">
            {showAdd ? '×' : view === 'events' ? '+ event' : '+ reminder'}
          </button>
        </div>
      </header>

      {showAdd && view === 'events' && (
        <form onSubmit={add} className="px-3 py-2 border-b border-nova-border bg-nova-panel/50 space-y-1.5">
          <input
            autoFocus
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Title (e.g. dentist)"
            className="nova-input text-xs w-full"
          />
          <div className="flex gap-1.5">
            <input
              type="datetime-local"
              value={draft.when}
              onChange={(e) => setDraft({ ...draft, when: e.target.value })}
              className="nova-input text-xs flex-1"
            />
            <button type="submit" disabled={!draft.title.trim()} className="nova-btn-primary text-xs px-2">add</button>
          </div>
          <input
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="Notes (optional)"
            className="nova-input text-[11px] w-full"
          />
        </form>
      )}

      {showAdd && view === 'reminders' && (
        <form onSubmit={addReminder} className="px-3 py-2 border-b border-nova-border bg-nova-panel/50 space-y-1.5">
          <input
            autoFocus
            value={reminderDraft.message}
            onChange={(e) => setReminderDraft({ ...reminderDraft, message: e.target.value })}
            placeholder="Reminder"
            className="nova-input text-xs w-full"
          />
          <div className="flex gap-1.5 items-center">
            <input
              type="number"
              min="1"
              value={reminderDraft.mins}
              onChange={(e) => setReminderDraft({ ...reminderDraft, mins: e.target.value })}
              className="nova-input text-xs w-20"
            />
            <span className="text-[11px] text-nova-muted">min</span>
            <button type="submit" disabled={!reminderDraft.message.trim()} className="nova-btn-primary text-xs px-2 ml-auto">add</button>
          </div>
        </form>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-1.5 min-h-0">
        {view === 'reminders' ? (
          <div className="space-y-1">
            {reminders.length === 0 && <div className="text-center text-nova-muted py-8 text-xs">No reminders.</div>}
            {reminders.map((r) => {
              const remaining = r.fireAt - now;
              return (
                <div key={r.id} className="flex justify-between items-start gap-2 px-3 py-2 border border-nova-border/40 rounded-lg bg-nova-panel/40 hover:bg-nova-panel/70 transition-colors group">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{r.message}</div>
                    <div className="text-[10.5px] text-nova-muted font-mono">
                      {new Date(r.fireAt).toLocaleString()}
                      {remaining > 0 ? <span className="text-nova-accent"> · in {fmtIn(remaining)}</span> : <span className="text-nova-warn"> · firing</span>}
                    </div>
                  </div>
                  <button onClick={() => cancelReminder(r.id)} title="Cancel" className="text-nova-muted hover:text-nova-err text-base px-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                </div>
              );
            })}
          </div>
        ) : (
        <>
        {error && (
          <div className="text-nova-err text-[11px] font-mono px-1.5 py-1 bg-nova-err/10 border border-nova-err/30 rounded mb-2">
            {error}
          </div>
        )}
        {loading && events.length === 0 && (
          <div className="text-center text-nova-muted text-[11px] py-6">loading…</div>
        )}
        {!loading && events.length === 0 && !error && (
          <div className="text-center text-nova-muted text-xs py-8">
            <div className="font-display text-2xl text-nova-text mb-1">📅</div>
            Nothing scheduled. Ask Jarvis to add an event, or use + above.
          </div>
        )}
        {Object.entries(grouped).map(([day, items]) => (
          <div key={day} className="mb-2">
            <div className="px-1.5 py-0.5 text-[9.5px] font-mono uppercase text-nova-accent2/80 tracking-wider">
              {day === new Date().toISOString().slice(0,10) ? 'today · ' + day : day}
            </div>
            {items.map((ev) => (
              <div key={ev.id} className="flex items-start gap-2 px-2 py-1.5 border border-nova-border/40 rounded-lg mb-1 bg-nova-panel/40 hover:bg-nova-panel/70 hover:border-nova-accent/30 transition-colors group">
                <div className="text-[10.5px] font-mono text-nova-accent shrink-0 w-12 pt-0.5 tabular-nums">
                  {fmtTime(ev.starts_at).split(',').pop().trim()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] truncate font-medium">{ev.title}</div>
                  {ev.notes && <div className="text-[10.5px] text-nova-muted truncate">{ev.notes}</div>}
                </div>
                <button onClick={() => remove(ev.id)}
                  title="Delete"
                  className="text-nova-muted hover:text-nova-err text-base px-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">×</button>
              </div>
            ))}
          </div>
        ))}
        </>
        )}
      </div>
    </div>
  );
}
