import { useEffect, useState, useCallback } from 'react';
import {
  ScrollText,
  Search,
  RefreshCw,
  Filter,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Shield,
  Scan,
  Settings,
  LogIn,
  Activity,
} from 'lucide-react';

interface LogEntry {
  id: string;
  device_id: string;
  device_name: string;
  event_type: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

const EVENT_TYPES = ['all', 'alert', 'scan', 'auth', 'command', 'heartbeat', 'system'] as const;
const SEVERITY_LEVELS = ['all', 'info', 'warning', 'error', 'critical'] as const;

const severityConfig: Record<string, { color: string; badge: string; icon: typeof Shield }> = {
  info: { color: 'text-blue-400', badge: 'badge-blue', icon: Activity },
  warning: { color: 'text-yellow-400', badge: 'badge-yellow', icon: AlertTriangle },
  error: { color: 'text-red-400', badge: 'badge-red', icon: AlertTriangle },
  critical: { color: 'text-red-500', badge: 'badge-red', icon: Shield },
};

const eventIcons: Record<string, typeof Shield> = {
  alert: AlertTriangle,
  scan: Scan,
  auth: LogIn,
  command: Settings,
  heartbeat: Activity,
  system: Shield,
};

const PAGE_SIZE = 50;

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [eventType, setEventType] = useState<string>('all');
  const [severity, setSeverity] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchLogs = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
    });
    if (search) params.set('search', search);
    if (eventType !== 'all') params.set('event_type', eventType);
    if (severity !== 'all') params.set('severity', severity);

    fetch(`/api/dashboard/logs?${params}`)
      .then((r) => r.ok ? r.json() : { logs: [], total: 0 })
      .then((data) => {
        setLogs(data.logs || []);
        setTotal(data.total || 0);
      })
      .catch(() => { setLogs([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [page, search, eventType, severity]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold">Audit Logs</h1>
          <p className="text-dark-400 text-sm mt-1">{total} event{total !== 1 ? 's' : ''} recorded</p>
        </div>
        <button onClick={fetchLogs} className="btn-ghost text-sm gap-2">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="glass-card p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search events..."
              className="input-field pl-10"
            />
          </div>
          <div className="flex gap-2">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500 pointer-events-none" />
              <select
                value={eventType}
                onChange={(e) => { setEventType(e.target.value); setPage(1); }}
                className="input-field pl-10 pr-8 appearance-none cursor-pointer min-w-[140px]"
              >
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>
                ))}
              </select>
            </div>
            <select
              value={severity}
              onChange={(e) => { setSeverity(e.target.value); setPage(1); }}
              className="input-field appearance-none cursor-pointer min-w-[120px]"
            >
              {SEVERITY_LEVELS.map((s) => (
                <option key={s} value={s}>{s === 'all' ? 'All severity' : s}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center">
            <ScrollText className="w-12 h-12 text-dark-700 mx-auto mb-4" />
            <h3 className="font-semibold mb-2">No logs found</h3>
            <p className="text-sm text-dark-500">Try adjusting your search or filters.</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="hidden lg:grid lg:grid-cols-[1fr_120px_100px_180px_180px] gap-4 px-5 py-3 border-b border-dark-800/50 text-xs text-dark-500 uppercase tracking-wider font-medium">
              <span>Event</span>
              <span>Type</span>
              <span>Severity</span>
              <span>Device</span>
              <span>Time</span>
            </div>

            {/* Rows */}
            <div className="divide-y divide-dark-800/50">
              {logs.map((log) => {
                const sev = severityConfig[log.severity] || severityConfig.info;
                const EventIcon = eventIcons[log.event_type] || Shield;

                return (
                  <div
                    key={log.id}
                    className="px-5 py-3 lg:grid lg:grid-cols-[1fr_120px_100px_180px_180px] lg:gap-4 lg:items-center hover:bg-dark-800/20 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <EventIcon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${sev.color}`} />
                      <span className="text-sm text-dark-200">{log.message}</span>
                    </div>
                    <div className="mt-2 lg:mt-0">
                      <span className="text-xs text-dark-500 bg-dark-800/50 px-2 py-0.5 rounded">
                        {log.event_type}
                      </span>
                    </div>
                    <div className="mt-1 lg:mt-0">
                      <span className={`text-xs ${sev.badge}`}>{log.severity}</span>
                    </div>
                    <div className="mt-1 lg:mt-0 text-sm text-dark-400 truncate">
                      {log.device_name}
                    </div>
                    <div className="mt-1 lg:mt-0 text-xs text-dark-500">
                      {new Date(log.created_at).toLocaleString()}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-dark-800/50">
            <span className="text-xs text-dark-500">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-ghost text-sm disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn-ghost text-sm disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
