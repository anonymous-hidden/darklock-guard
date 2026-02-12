import React, { useState, useMemo } from 'react';
import { useService } from '../state/service';
import { Activity, AlertTriangle, Info, XCircle, Search, Filter, RefreshCw, ChevronDown, ChevronRight, Download } from 'lucide-react';

type Severity = 'all' | 'info' | 'warning' | 'error';

const EventsPage: React.FC = () => {
  const { events, serviceAvailable, refresh } = useService();
  const [severity, setSeverity] = useState<Severity>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const filtered = useMemo(() => {
    let list = events || [];
    if (severity !== 'all') {
      list = list.filter(e => {
        const lower = (e.kind || '').toLowerCase();
        if (severity === 'error') return lower.includes('tamper') || lower.includes('error') || lower.includes('fail');
        if (severity === 'warning') return lower.includes('warning') || lower.includes('warn') || lower.includes('alert');
        return lower.includes('info') || lower.includes('scan') || lower.includes('start');
      });
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e => (e.kind || '').toLowerCase().includes(q) || (e.detail || '').toLowerCase().includes(q));
    }
    return list;
  }, [events, severity, search]);

  const severityIcon = (kind: string) => {
    const k = (kind || '').toLowerCase();
    if (k.includes('tamper') || k.includes('error') || k.includes('fail')) return <XCircle size={14} className="text-semantic-error" />;
    if (k.includes('warning') || k.includes('warn') || k.includes('alert')) return <AlertTriangle size={14} className="text-semantic-warning" />;
    return <Info size={14} className="text-accent-primary" />;
  };

  const doRefresh = () => {
    setRefreshing(true);
    refresh();
    setTimeout(() => setRefreshing(false), 1000);
  };

  const exportEvents = () => {
    const csv = ['Timestamp,Event,Detail', ...filtered.map(e => `${e.ts},${e.kind},"${e.detail || ''}"`)].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `darklock-events-${Date.now()}.csv`;
    a.click();
  };

  const tabs: { label: string; value: Severity; count: number }[] = [
    { label: 'All', value: 'all', count: (events || []).length },
    { label: 'Info', value: 'info', count: (events || []).filter(e => !(e.kind||'').toLowerCase().match(/tamper|error|fail|warn|alert/)).length },
    { label: 'Warnings', value: 'warning', count: (events || []).filter(e => (e.kind||'').toLowerCase().match(/warn|alert/)).length },
    { label: 'Errors', value: 'error', count: (events || []).filter(e => (e.kind||'').toLowerCase().match(/tamper|error|fail/)).length },
  ];

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Event Log</h1>
          <p className="text-sm text-text-muted mt-0.5">Real-time security events and system activity</p>
        </div>
        <div className="flex items-center gap-2">
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
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${severity === tab.value ? 'bg-accent-primary/20 text-accent-primary' : 'text-text-muted hover:text-text-secondary'}`}
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
            {filtered.map((event, i) => (
              <div key={i} className="group">
                <button
                  onClick={() => setExpanded(expanded === i ? null : i)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-secondary/50 transition-colors"
                >
                  {severityIcon(event.kind)}
                  <span className="font-mono text-xs text-text-muted w-20 shrink-0">{event.ts ? new Date(event.ts * 1000).toLocaleTimeString() : '--:--'}</span>
                  <span className="text-sm font-medium flex-1 truncate">{event.kind || 'Unknown'}</span>
                  {expanded === i ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
                </button>
                {expanded === i && (
                  <div className="px-4 pb-3 pl-12">
                    <div className="bg-bg-secondary/50 rounded-lg p-3 text-xs space-y-1">
                      <p><span className="text-text-muted">Event:</span> <span className="text-text-primary">{event.kind}</span></p>
                      <p><span className="text-text-muted">Detail:</span> <span className="text-text-primary">{event.detail || 'No additional details'}</span></p>
                      <p><span className="text-text-muted">Timestamp:</span> <span className="text-text-primary font-mono">{event.ts ? new Date(event.ts * 1000).toISOString() : 'N/A'}</span></p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-text-muted text-center">{filtered.length} event{filtered.length !== 1 ? 's' : ''} shown</p>
    </div>
  );
};

export default EventsPage;
