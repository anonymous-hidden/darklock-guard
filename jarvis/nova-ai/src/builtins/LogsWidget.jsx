import React, { useEffect, useRef, useState } from 'react';

/**
 * LogsWidget — central activity log.
 *
 * Two tabs:
 *   • Widgets — live feed of every cross-widget bus event (widget:event,
 *               widget:activity, voice-call:turn/state, calendar:changed,
 *               proactive notes, etc.). Each entry is timestamped.
 *   • System  — tail of the OS logs (journalctl on Linux, log show on macOS,
 *               Get-EventLog on Windows). Auto-refreshes every 8s.
 */
const MAX = 400;

const CHANNELS = [
  'widget:event',
  'widget:activity',
  'voice-call:turn',
  'voice-call:state',
  'calendar:changed',
  'calendar:add',
  'reminders:fired',
  'discord:agent',
];

function tone(channel) {
  if (channel.startsWith('voice-call')) return 'text-nova-ok';
  if (channel.startsWith('calendar'))   return 'text-nova-accent2';
  if (channel.startsWith('reminders'))  return 'text-nova-warn';
  if (channel === 'discord:agent')      return 'text-nova-accent2';
  return 'text-nova-accent';
}

function fmtTime(d = new Date()) {
  return d.toLocaleTimeString([], { hour12: false });
}

function summarize(channel, payload) {
  if (!payload) return channel;
  if (channel === 'widget:event' || channel === 'widget:activity') {
    return payload.summary || `${payload.widget || '?'} ${payload.action || 'updated'}`;
  }
  if (channel === 'voice-call:turn') {
    return `${payload.role || '?'}: ${(payload.text || '').slice(0, 120)}`;
  }
  if (channel === 'voice-call:state') return `state → ${payload.state}`;
  if (channel === 'calendar:changed') return `calendar ${payload.reason || 'changed'}`;
  if (channel === 'calendar:add')     return `+ ${payload.title}`;
  if (channel === 'reminders:fired')  return `⏰ ${payload.title || 'reminder'}`;
  if (channel === 'discord:agent') {
    const event = payload.event || 'discord';
    const recipient = payload.recipient ? ` ${payload.recipient}` : '';
    const state = payload.sent ? 'sent' : 'logged';
    const reason = payload.reason || payload.draft_preview || payload.reply_target_text_preview || '';
    const conf = typeof payload.confidence === 'number' ? ` ${(payload.confidence * 100).toFixed(0)}%` : '';
    return `${event}${recipient} ${state}${conf}${reason ? ` - ${String(reason).slice(0, 120)}` : ''}`;
  }
  try { return JSON.stringify(payload).slice(0, 140); } catch { return String(payload); }
}

export default function LogsWidget() {
  const [tab, setTab] = useState('widgets');
  const [events, setEvents] = useState([]);
  const [sysLines, setSysLines] = useState([]);
  const [sysLoading, setSysLoading] = useState(false);
  const [sysErr, setSysErr] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('');
  const widgetsRef = useRef(null);
  const sysRef = useRef(null);

  /* Subscribe to bus channels */
  useEffect(() => {
    const offs = CHANNELS.map((ch) =>
      window.nova?.bus?.subscribe?.(ch, (payload) => {
        setEvents((prev) => {
          const next = [...prev, {
            id: 'e' + Date.now() + Math.random().toString(36).slice(2, 5),
            channel: ch, payload, time: new Date(),
          }];
          if (next.length > MAX) next.splice(0, next.length - MAX);
          return next;
        });
      })
    );
    return () => offs.forEach((off) => off?.());
  }, []);

  /* System logs poll */
  const pullSystem = async () => {
    if (!window.nova?.control?.systemLogs) return;
    setSysLoading(true); setSysErr('');
    try {
      const r = await window.nova.control.systemLogs({ lines: 200 });
      if (r?.ok) setSysLines(r.lines || []);
      else setSysErr(r?.error || 'unknown');
    } catch (e) { setSysErr(String(e?.message || e)); }
    finally { setSysLoading(false); }
  };

  useEffect(() => {
    if (tab !== 'system') return;
    pullSystem();
    const t = setInterval(pullSystem, 8000);
    return () => clearInterval(t);
  }, [tab]);

  useEffect(() => {
    if (!autoScroll) return;
    if (tab === 'widgets' && widgetsRef.current) widgetsRef.current.scrollTop = widgetsRef.current.scrollHeight;
    if (tab === 'system'  && sysRef.current)     sysRef.current.scrollTop     = sysRef.current.scrollHeight;
  }, [tab, events.length, sysLines.length, autoScroll]);

  const filteredEvents = events.filter((e) => {
    if (!filter.trim()) return true;
    const f = filter.toLowerCase();
    return e.channel.toLowerCase().includes(f) || summarize(e.channel, e.payload).toLowerCase().includes(f);
  });
  const filteredSys = sysLines.filter((l) =>
    !filter.trim() || l.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col bg-nova-bg text-nova-text">
      <header className="flex items-center justify-between px-3 py-1.5 border-b border-nova-border/50 bg-nova-panel/40 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="font-display text-xs flex items-center gap-1.5">📋 Logs</span>
          <div className="flex bg-nova-panel/60 rounded-md border border-nova-border/40 overflow-hidden text-[10px]">
            <button onClick={() => setTab('widgets')}
              className={`px-2 py-0.5 ${tab === 'widgets' ? 'bg-nova-accent/20 text-nova-accent' : 'text-nova-muted hover:text-nova-text'}`}>
              widgets ({events.length})
            </button>
            <button onClick={() => setTab('system')}
              className={`px-2 py-0.5 ${tab === 'system' ? 'bg-nova-accent/20 text-nova-accent' : 'text-nova-muted hover:text-nova-text'}`}>
              system ({sysLines.length})
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <input value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="filter…" className="nova-input text-[10px] w-24 py-0.5" />
          <label className="flex items-center gap-1 text-[10px] text-nova-muted">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} className="accent-nova-accent" />
            tail
          </label>
          {tab === 'widgets'
            ? <button onClick={() => setEvents([])} className="text-[10px] text-nova-muted hover:text-nova-err">clear</button>
            : <button onClick={pullSystem} disabled={sysLoading} className="text-[10px] text-nova-muted hover:text-nova-text">↻</button>
          }
        </div>
      </header>

      {tab === 'widgets' && (
        <div ref={widgetsRef} className="flex-1 overflow-y-auto px-2 py-1 font-mono text-[10.5px] leading-tight">
          {filteredEvents.length === 0 && (
            <div className="text-center text-nova-muted py-10 text-xs">
              No widget activity yet — open or interact with any widget and entries will appear here.
            </div>
          )}
          {filteredEvents.map((e) => (
            <div key={e.id} className="flex gap-2 py-0.5 hover:bg-nova-panel/40 px-1 rounded">
              <span className="text-nova-muted shrink-0">{fmtTime(e.time)}</span>
              <span className={`shrink-0 ${tone(e.channel)}`}>{e.channel}</span>
              <span className="text-nova-text/85 truncate">{summarize(e.channel, e.payload)}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'system' && (
        <div ref={sysRef} className="flex-1 overflow-y-auto px-2 py-1 font-mono text-[10.5px] leading-tight">
          {sysErr && (
            <div className="text-nova-err bg-nova-err/10 border border-nova-err/30 rounded px-2 py-1 mb-1">
              system logs error: {sysErr}
            </div>
          )}
          {!sysErr && sysLines.length === 0 && !sysLoading && (
            <div className="text-center text-nova-muted py-10 text-xs">No system log lines.</div>
          )}
          {sysLoading && sysLines.length === 0 && (
            <div className="text-center text-nova-muted py-10 text-xs animate-pulse">Reading journalctl…</div>
          )}
          {filteredSys.map((line, i) => (
            <div key={i} className="text-nova-text/80 hover:bg-nova-panel/40 px-1 rounded whitespace-pre">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
