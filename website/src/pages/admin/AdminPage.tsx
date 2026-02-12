import React, { useState, useEffect, useCallback } from 'react';
import {
  Bug, RefreshCw, Shield, Monitor, Users, Package, ChevronDown, ChevronRight,
  Check, X, Trash2, Send, AlertTriangle, Clock, CheckCircle2, Loader2, Eye
} from 'lucide-react';

interface Stats {
  crash_reports: { total: number; unresolved: number };
  devices: number;
  users: number;
  recent_by_type: { report_type: string; count: string }[];
}

interface CrashReport {
  id: string;
  report_type: string;
  description: string;
  app_version: string;
  platform: string;
  error_code: string | null;
  resolved: boolean;
  notes: string | null;
  created_at: string;
  diagnostics?: string;
  stack_trace?: string;
  metadata?: any;
}

interface Device {
  id: string;
  name: string | null;
  os: string | null;
  version: string | null;
  status: string;
  security_profile: string;
  baseline_valid: boolean;
  last_seen_at: string | null;
}

type Tab = 'overview' | 'crashes' | 'updates' | 'devices';

const API = '/api/admin';

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${API}${path}`, { credentials: 'include', ...opts });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<Stats | null>(null);
  const [reports, setReports] = useState<CrashReport[]>([]);
  const [reportTotal, setReportTotal] = useState(0);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filterResolved, setFilterResolved] = useState<boolean | undefined>(false);
  const [pushVersion, setPushVersion] = useState('');
  const [pushChannel, setPushChannel] = useState('stable');
  const [pushNotes, setPushNotes] = useState('');
  const [pushHistory, setPushHistory] = useState<any[]>([]);
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState('');

  const loadStats = useCallback(async () => {
    try { setStats(await api('/stats')); } catch (e: any) { setError(e.message); }
  }, []);

  const loadReports = useCallback(async () => {
    try {
      const qs = filterResolved !== undefined ? `?resolved=${filterResolved}` : '';
      const data = await api(`/crash-reports${qs}`);
      setReports(data.reports);
      setReportTotal(data.total);
    } catch (e: any) { setError(e.message); }
  }, [filterResolved]);

  const loadDevices = useCallback(async () => {
    try { setDevices(await api('/devices')); } catch (e: any) { setError(e.message); }
  }, []);

  const loadPushHistory = useCallback(async () => {
    try { setPushHistory(await api('/push-updates')); } catch (e: any) { setError(e.message); }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadStats(), loadReports(), loadDevices(), loadPushHistory()])
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadReports(); }, [filterResolved]);

  const resolveReport = async (id: string, resolved: boolean) => {
    await api(`/crash-reports/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolved }) });
    loadReports();
    loadStats();
  };

  const deleteReport = async (id: string) => {
    await api(`/crash-reports/${id}`, { method: 'DELETE' });
    loadReports();
    loadStats();
  };

  const pushUpdate = async () => {
    if (!pushVersion.trim()) return;
    setPushing(true);
    try {
      await api('/push-update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: pushVersion, channel: pushChannel, release_notes: pushNotes }) });
      setPushMsg(`Update v${pushVersion} pushed to ${pushChannel} channel`);
      setPushVersion('');
      setPushNotes('');
      loadPushHistory();
    } catch (e: any) { setPushMsg(`Error: ${e.message}`); }
    setPushing(false);
  };

  const viewDetail = async (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    try {
      const detail = await api(`/crash-reports/${id}`);
      setReports(prev => prev.map(r => r.id === id ? { ...r, ...detail } : r));
      setExpanded(id);
    } catch {}
  };

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Overview', icon: Shield },
    { id: 'crashes', label: 'Crash Reports', icon: Bug },
    { id: 'updates', label: 'Push Updates', icon: Package },
    { id: 'devices', label: 'Devices', icon: Monitor },
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Admin Panel</h1>
          <p className="text-sm text-gray-400 mt-1">Desktop app management — anonymous telemetry only, no user data</p>
        </div>
        <button 
          onClick={() => { loadStats(); loadReports(); loadDevices(); loadPushHistory(); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500/20 text-brand-400 hover:bg-brand-500/30 transition-colors text-sm"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2 text-sm text-red-400">
          <AlertTriangle size={14} /> {error}
          <button onClick={() => setError('')} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {/* Tab nav */}
      <div className="flex gap-1 bg-dark-800 rounded-lg p-1 border border-white/5">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === t.id ? 'bg-brand-500/20 text-brand-400' : 'text-gray-400 hover:text-gray-300'}`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && stats && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Crashes', value: stats.crash_reports.total, color: 'text-red-400', bg: 'bg-red-500/10' },
              { label: 'Unresolved', value: stats.crash_reports.unresolved, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
              { label: 'Devices', value: stats.devices, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
              { label: 'Users', value: stats.users, color: 'text-green-400', bg: 'bg-green-500/10' },
            ].map(s => (
              <div key={s.label} className={`${s.bg} border border-white/5 rounded-xl p-5`}>
                <p className="text-xs text-gray-400 uppercase tracking-wider">{s.label}</p>
                <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {stats.recent_by_type.length > 0 && (
            <div className="bg-dark-800 border border-white/5 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">Last 7 Days by Type</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {stats.recent_by_type.map(r => (
                  <div key={r.report_type} className="bg-dark-900/50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 capitalize">{r.report_type.replace('_', ' ')}</p>
                    <p className="text-xl font-bold text-white mt-0.5">{r.count}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Crash Reports */}
      {tab === 'crashes' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">{reportTotal} reports</span>
            <div className="flex gap-1 bg-dark-800 rounded-lg p-0.5 border border-white/5">
              {([
                { label: 'Unresolved', val: false },
                { label: 'Resolved', val: true },
                { label: 'All', val: undefined },
              ] as const).map(f => (
                <button
                  key={f.label}
                  onClick={() => setFilterResolved(f.val)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filterResolved === f.val ? 'bg-brand-500/20 text-brand-400' : 'text-gray-400 hover:text-gray-300'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {reports.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Bug size={32} className="mx-auto mb-3 opacity-30" />
              <p>No crash reports found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {reports.map(r => (
                <div key={r.id} className="bg-dark-800 border border-white/5 rounded-xl overflow-hidden">
                  <button onClick={() => viewDetail(r.id)} className="w-full flex items-center gap-3 p-4 text-left hover:bg-dark-700/50 transition-colors">
                    {r.resolved
                      ? <CheckCircle2 size={16} className="text-green-400 shrink-0" />
                      : <AlertTriangle size={16} className="text-yellow-400 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white truncate">{r.description?.slice(0, 80) || r.report_type}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-dark-600 text-gray-400 capitalize shrink-0">{r.report_type.replace('_', ' ')}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span>{r.app_version || 'unknown'}</span>
                        <span>{r.platform || 'unknown'}</span>
                        <span>{new Date(r.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                    {expanded === r.id ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                  </button>
                  {expanded === r.id && (
                    <div className="px-4 pb-4 space-y-3 border-t border-white/5">
                      <div className="grid grid-cols-2 gap-3 mt-3">
                        <div className="bg-dark-900/50 rounded-lg p-3">
                          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Description</p>
                          <p className="text-sm text-gray-300">{r.description || 'None'}</p>
                        </div>
                        {r.diagnostics && (
                          <div className="bg-dark-900/50 rounded-lg p-3">
                            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Diagnostics</p>
                            <pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono">{r.diagnostics}</pre>
                          </div>
                        )}
                        {r.stack_trace && (
                          <div className="col-span-2 bg-dark-900/50 rounded-lg p-3">
                            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Stack Trace</p>
                            <pre className="text-xs text-red-300 whitespace-pre-wrap font-mono max-h-48 overflow-auto">{r.stack_trace}</pre>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2 pt-2">
                        <button
                          onClick={() => resolveReport(r.id, !r.resolved)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${r.resolved ? 'bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20' : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'}`}
                        >
                          <Check size={12} /> {r.resolved ? 'Unresolve' : 'Mark Resolved'}
                        </button>
                        <button
                          onClick={() => { if (confirm('Delete this report?')) deleteReport(r.id); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Push Updates */}
      {tab === 'updates' && (
        <div className="space-y-6">
          <div className="bg-dark-800 border border-white/5 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">Push a New Update</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Version</label>
                <input
                  value={pushVersion}
                  onChange={e => setPushVersion(e.target.value)}
                  placeholder="2.0.1"
                  className="w-full bg-dark-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-brand-500/50"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Channel</label>
                <select
                  value={pushChannel}
                  onChange={e => setPushChannel(e.target.value)}
                  className="w-full bg-dark-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500/50"
                >
                  <option value="stable">Stable</option>
                  <option value="beta">Beta</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  onClick={pushUpdate}
                  disabled={pushing || !pushVersion.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pushing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Push Update
                </button>
              </div>
            </div>
            <div className="mt-3">
              <label className="text-xs text-gray-500 block mb-1">Release Notes</label>
              <textarea
                value={pushNotes}
                onChange={e => setPushNotes(e.target.value)}
                placeholder="What's new in this version..."
                className="w-full bg-dark-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-brand-500/50 min-h-[60px] resize-none"
              />
            </div>
            {pushMsg && (
              <p className={`mt-3 text-sm ${pushMsg.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>{pushMsg}</p>
            )}
          </div>

          {pushHistory.length > 0 && (
            <div className="bg-dark-800 border border-white/5 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">Push History</h3>
              <div className="space-y-2">
                {pushHistory.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between bg-dark-900/50 rounded-lg px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Package size={14} className="text-brand-400" />
                      <span className="text-sm font-mono text-white">v{p.version}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-dark-600 text-gray-400 capitalize">{p.channel}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>{p.target_count} devices</span>
                      <span>{new Date(p.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Devices */}
      {tab === 'devices' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">{devices.length} devices registered</p>
          {devices.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Monitor size={32} className="mx-auto mb-3 opacity-30" />
              <p>No devices found</p>
            </div>
          ) : (
            <div className="bg-dark-800 border border-white/5 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-xs text-gray-500 uppercase tracking-wider">
                    <th className="text-left p-3 pl-4">Device</th>
                    <th className="text-left p-3">OS</th>
                    <th className="text-left p-3">Version</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-left p-3">Profile</th>
                    <th className="text-left p-3">Baseline</th>
                    <th className="text-left p-3 pr-4">Last Seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {devices.map(d => (
                    <tr key={d.id} className="hover:bg-dark-700/30 transition-colors">
                      <td className="p-3 pl-4 font-mono text-xs text-gray-300">{d.name || d.id.slice(0, 8)}</td>
                      <td className="p-3 text-gray-400">{d.os || '—'}</td>
                      <td className="p-3 font-mono text-gray-400">{d.version || '—'}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${d.status === 'online' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>
                          {d.status}
                        </span>
                      </td>
                      <td className="p-3 text-gray-400">{d.security_profile || '—'}</td>
                      <td className="p-3">
                        {d.baseline_valid
                          ? <CheckCircle2 size={14} className="text-green-400" />
                          : <AlertTriangle size={14} className="text-yellow-400" />}
                      </td>
                      <td className="p-3 pr-4 text-xs text-gray-500">{d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
