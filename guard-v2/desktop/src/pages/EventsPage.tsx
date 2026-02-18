import React, { useState, useMemo, useEffect } from 'react';
import { useService } from '../state/service';
import { Activity, AlertTriangle, Info, XCircle, Shield, Search, Filter, RefreshCw, ChevronDown, ChevronRight, Download, ShieldAlert, FileWarning, Bell } from 'lucide-react';

type SeverityFilter = 'all' | 'critical' | 'warning' | 'info';

const severityOrder: Record<string, number> = { CRITICAL: 0, ERROR: 1, WARN: 2, WARNING: 2, INFO: 3 };

const EventsPage: React.FC = () => {
  const { events, serviceAvailable, refresh } = useService();
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Auto-refresh events every 3 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const iv = setInterval(() => { refresh(); }, 3000);
    return () => clearInterval(iv);
  }, [autoRefresh, refresh]);

  const sorted = useMemo(() => {
    const list = [...(events || [])];
    // Sort by timestamp descending (most recent first)
    list.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    });
    return list;
  }, [events]);

  const filtered = useMemo(() => {
    let list = sorted;
    if (severity !== 'all') {
      list = list.filter(e => {
        const sev = (e.severity || '').toUpperCase();
        const evType = (e.event_type || '').toUpperCase();
        if (severity === 'critical') return sev === 'CRITICAL' || sev === 'ERROR' || evType.includes('TAMPER');
        if (severity === 'warning') return sev === 'WARN' || sev === 'WARNING' || evType.includes('RESTORE');
        return sev === 'INFO';
      });
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        (e.event_type || '').toLowerCase().includes(q) ||
        (e.detail || '').toLowerCase().includes(q) ||
        JSON.stringify(e.data || {}).toLowerCase().includes(q)
      );
    }
    return list;
  }, [sorted, severity, search]);

  const getSeverityInfo = (sev: string, evType: string) => {
    const s = (sev || '').toUpperCase();
    const t = (evType || '').toUpperCase();
    if (s === 'CRITICAL' || t.includes('TAMPER')) return { icon: <ShieldAlert size={15} className="text-semantic-error" />, color: 'text-semantic-error', bg: 'bg-semantic-error/10', label: 'CRITICAL' };
    if (s === 'ERROR') return { icon: <XCircle size={15} className="text-semantic-error" />, color: 'text-semantic-error', bg: 'bg-semantic-error/10', label: 'ERROR' };
    if (s === 'WARN' || s === 'WARNING' || t.includes('RESTORE')) return { icon: <AlertTriangle size={15} className="text-semantic-warning" />, color: 'text-semantic-warning', bg: 'bg-semantic-warning/10', label: 'WARN' };
    return { icon: <Info size={15} className="text-accent-primary" />, color: 'text-accent-primary', bg: 'bg-accent-primary/10', label: 'INFO' };
  };

  const formatEventType = (evType: string) => {
    return (evType || 'UNKNOWN').replace(/_/g, ' ');
  };

  const formatTimestamp = (ts: string) => {
    if (!ts) return '--:--:--';
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return '--:--:--'; }
  };

  const formatDate = (ts: string) => {
    if (!ts) return 'N/A';
    try { return new Date(ts).toLocaleString(); } catch { return ts; }
  };

  const doRefresh = () => {
    setRefreshing(true);
    refresh();
    setTimeout(() => setRefreshing(false), 1000);
  };

  const exportEvents = () => {
    const csv = ['Timestamp,Severity,Event,Detail,Data',
      ...filtered.map(e => `"${e.timestamp}","${e.severity}","${e.event_type}","${e.detail || ''}","${JSON.stringify(e.data || {}).replace(/"/g, '""')}"`)
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `darklock-events-${Date.now()}.csv`;
    a.click();
  };

  const critCount = sorted.filter(e => (e.severity || '').toUpperCase() === 'CRITICAL' || (e.event_type || '').includes('TAMPER')).length;
  const warnCount = sorted.filter(e => { const s = (e.severity||'').toUpperCase(); return s === 'WARN' || s === 'WARNING'; }).length;
  const infoCount = sorted.filter(e => (e.severity || '').toUpperCase() === 'INFO').length;

  const tabs: { label: string; value: SeverityFilter; count: number; color?: string }[] = [
    { label: 'All', value: 'all', count: sorted.length },
    { label: 'Critical', value: 'critical', count: critCount, color: critCount > 0 ? 'text-semantic-error' : undefined },
    { label: 'Warnings', value: 'warning', count: warnCount },
    { label: 'Info', value: 'info', count: infoCount },
  ];

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            Event Log
            {critCount > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-semantic-error/20 text-semantic-error text-xs font-semibold animate-pulse">
                <ShieldAlert size={12} /> {critCount} threat{critCount > 1 ? 's' : ''}
              </span>
            )}
          </h1>
          <p className="text-sm text-text-muted mt-0.5">Real-time security events and system activity</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors border ${autoRefresh ? 'bg-semantic-success/10 border-semantic-success/30 text-semantic-success' : 'bg-bg-card border-white/5 text-text-muted'}`}
          >
            <Bell size={13} /> Live
          </button>
          <button onClick={exportEvents} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-card border border-white/5 text-xs text-text-secondary hover:bg-bg-secondary transition-colors">
            <Download size={13} /> Export
          </button>
          <button onClick={doRefresh} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-primary/10 border border-accent-primary/30 text-xs text-accent-primary hover:bg-accent-primary/20 transition-colors">
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex bg-bg-card rounded-lg border border-white/5 p-0.5">
          {tabs.map(tab => (
            <button
              key={tab.value}
              onClick={() => setSeverity(tab.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${severity === tab.value ? 'bg-accent-primary/20 text-accent-primary' : `${tab.color || 'text-text-muted'} hover:text-text-secondary`}`}
            >
              {tab.label} <span className="ml-1 opacity-60">{tab.count}</span>
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search events..."
            className="w-full bg-bg-card border border-white/5 rounded-lg pl-9 pr-3 py-2 text-sm placeholder:text-text-muted focus:outline-none focus:border-accent-primary/50"
          />
        </div>
      </div>

      {!serviceAvailable && (
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-xl p-4 flex items-center gap-3">
          <XCircle size={18} className="text-semantic-error" />
          <p className="text-sm text-text-secondary">Service unavailable. Events may not be updating.</p>
        </div>
      )}

      <div className="bg-bg-card border border-white/5 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <Activity size={32} className="text-text-muted mx-auto mb-3 opacity-30" />
            <p className="text-sm text-text-muted">No events found</p>
            <p className="text-xs text-text-muted mt-1">{search ? 'Try adjusting your search or filter' : 'Events will appear here as activity is detected'}</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filtered.map((event, i) => {
              const sev = getSeverityInfo(event.severity, event.event_type);
              return (
                <div key={event.seq || i} className="group">
                  <button
                    onClick={() => setExpanded(expanded === i ? null : i)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-secondary/50 transition-colors ${(event.event_type || '').includes('TAMPER') ? 'border-l-2 border-l-semantic-error' : ''}`}
                  >
                    {sev.icon}
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${sev.bg} ${sev.color}`}>{sev.label}</span>
                    <span className="font-mono text-xs text-text-muted w-20 shrink-0">{formatTimestamp(event.timestamp)}</span>
                    <span className="text-sm font-medium flex-1 truncate">{formatEventType(event.event_type)}</span>
                    {event.detail && <span className="text-xs text-text-muted truncate max-w-48 hidden sm:block">{event.detail}</span>}
                    {expanded === i ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
                  </button>
                  {expanded === i && (
                    <div className="px-4 pb-3 pl-12">
                      <div className="bg-bg-secondary/50 rounded-lg p-3 text-xs space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div><span className="text-text-muted">Event:</span> <span className="text-text-primary font-semibold">{event.event_type}</span></div>
                          <div><span className="text-text-muted">Severity:</span> <span className={sev.color + ' font-semibold'}>{event.severity}</span></div>
                          <div><span className="text-text-muted">Timestamp:</span> <span className="text-text-primary font-mono">{formatDate(event.timestamp)}</span></div>
                          <div><span className="text-text-muted">Sequence:</span> <span className="text-text-primary font-mono">#{event.seq}</span></div>
                        </div>
                        {event.detail && (
                          <div className="pt-2 border-t border-white/5">
                            <span className="text-text-muted">Detail:</span>
                            <span className="text-text-primary ml-2">{event.detail}</span>
                          </div>
                        )}
                        {event.data && Object.keys(event.data).length > 0 && (
                          <div className="pt-2 border-t border-white/5">
                            <span className="text-text-muted block mb-1">Raw Data:</span>
                            <pre className="text-text-secondary bg-bg-primary/50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                              {JSON.stringify(event.data, null, 2)}
                            </pre>
                          </div>
                        )}
                        {event.hash && (
                          <div className="pt-2 border-t border-white/5">
                            <span className="text-text-muted">Chain Hash:</span>
                            <span className="text-text-primary font-mono ml-2 text-[10px]">{event.hash}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[11px] text-text-muted text-center">{filtered.length} event{filtered.length !== 1 ? 's' : ''} shown</p>
    </div>
  );
};

export default EventsPage;
