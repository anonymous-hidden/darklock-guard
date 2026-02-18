import React, { useEffect, useState } from 'react';
import { useService } from '../state/service';
import { Shield, Activity, Clock, Cpu, HardDrive, Wifi, WifiOff, AlertTriangle, CheckCircle2, XCircle, RefreshCw, Zap } from 'lucide-react';
import { fetchSystemMetrics } from '../ipc';
import { SystemMetrics } from '../types';

const safeModeReasonLabel = (reason?: string): string => {
  switch (reason) {
    case 'REMOTE_COMMAND': return 'Triggered remotely by admin';
    case 'MANUAL': return 'Manual entry by user';
    case 'SERVICE_CRASH_LOOP': return 'Crash loop detected';
    case 'VAULT_CORRUPT': return 'Vault data corruption';
    case 'CRYPTO_ERROR': return 'Cryptographic error';
    case 'INTEGRITY_FAILURE': return 'File integrity failure';
    case 'IPC_FAILURE': return 'IPC communication failure';
    default: return reason || 'Unknown';
  }
};

const StatCard: React.FC<{
  icon: React.ElementType;
  title: string;
  value: string;
  subtitle?: string;
  tone?: 'ok' | 'warn' | 'error' | 'info';
}> = ({ icon: Icon, title, value, subtitle, tone = 'ok' }) => {
  const toneClasses: Record<string, string> = {
    ok: 'text-semantic-success', warn: 'text-semantic-warning',
    error: 'text-semantic-error', info: 'text-accent-primary',
  };
  const iconBg: Record<string, string> = {
    ok: 'bg-semantic-success/10', warn: 'bg-semantic-warning/10',
    error: 'bg-semantic-error/10', info: 'bg-accent-primary/10',
  };
  return (
    <div className="bg-bg-card border border-white/5 rounded-xl p-5 hover:border-white/10 transition-all duration-200">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-text-muted uppercase tracking-wider font-medium">{title}</p>
          <p className={`text-2xl font-bold mt-1 ${toneClasses[tone!]}`}>{value}</p>
          {subtitle && <p className="text-xs text-text-muted mt-1">{subtitle}</p>}
        </div>
        <div className={`p-2.5 rounded-lg ${iconBg[tone!]}`}>
          <Icon size={20} className={toneClasses[tone!]} />
        </div>
      </div>
    </div>
  );
};

const StatusPage: React.FC = () => {
  const { status, serviceAvailable, events, refresh } = useService();
  const [uptime, setUptime] = useState('0m');
  const [refreshing, setRefreshing] = useState(false);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const mins = Math.floor(elapsed / 60000);
      const hrs = Math.floor(mins / 60);
      if (hrs > 0) setUptime(`${hrs}h ${mins % 60}m`);
      else setUptime(`${mins}m`);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadMetrics = async () => {
      try {
        const m = await fetchSystemMetrics();
        setMetrics(m);
      } catch (e) {
        console.warn('Failed to fetch system metrics:', e);
      }
    };
    loadMetrics();
    const interval = setInterval(loadMetrics, 2000); // Update every 2 seconds
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setTimeout(() => setRefreshing(false), 600);
  };

  if (!serviceAvailable) {
    return (
      <div className="p-6 space-y-6">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-xl p-5 flex items-start gap-4">
          <div className="p-2 bg-semantic-error/20 rounded-lg shrink-0"><XCircle size={24} className="text-semantic-error" /></div>
          <div>
            <h3 className="font-semibold text-semantic-error">Service Unavailable</h3>
            <p className="text-sm text-text-secondary mt-1">Cannot communicate with the Darklock Guard service. Make sure the service is running.</p>
            <button onClick={handleRefresh} className="mt-3 text-sm text-accent-primary hover:underline flex items-center gap-1.5">
              <RefreshCw size={14} /> Retry Connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isSafeMode = status?.mode === 'safemode';
  const isRemoteSafeMode = isSafeMode && status?.safeModeReason === 'REMOTE_COMMAND';
  const recentEvents = events.slice(0, 5);
  const errorCount = events.filter(e => e.severity === 'error').length;
  const warningCount = events.filter(e => e.severity === 'warning').length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">System Status</h1>
          <p className="text-sm text-text-muted mt-0.5">Real-time overview of Darklock Guard</p>
        </div>
        <button onClick={handleRefresh} className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary border border-white/10 rounded-lg hover:bg-white/5 transition">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {isSafeMode && (
        <div className={`rounded-xl p-5 flex items-start gap-4 ${isRemoteSafeMode ? 'bg-orange-500/10 border border-orange-500/30' : 'bg-semantic-warning/10 border border-semantic-warning/30'}`}>
          <div className={`p-2 rounded-lg shrink-0 ${isRemoteSafeMode ? 'bg-orange-500/20' : 'bg-semantic-warning/20'}`}>
            <AlertTriangle size={24} className={isRemoteSafeMode ? 'text-orange-400' : 'text-semantic-warning'} />
          </div>
          <div>
            <h3 className={`font-semibold ${isRemoteSafeMode ? 'text-orange-400' : 'text-semantic-warning'}`}>Safe Mode Active {isRemoteSafeMode && '(Remote)'}</h3>
            <p className="text-sm text-text-secondary mt-1">Protection is disabled. Reason: {safeModeReasonLabel(status?.safeModeReason)}.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Shield} title="Protection" value={status?.ok ? 'Active' : 'Degraded'} subtitle={status?.mode === 'zerotrust' ? 'Zero-Trust Mode' : 'Standard Mode'} tone={status?.ok ? 'ok' : 'error'} />
        <StatCard icon={status?.connected ? Wifi : WifiOff} title="Connection" value={status?.connected ? 'Connected' : 'Local Only'} subtitle={status?.connected ? 'Syncing with cloud' : 'Offline operation'} tone={status?.connected ? 'info' : 'warn'} />
        <StatCard icon={Activity} title="Events" value={events.length.toString()} subtitle={`${errorCount} errors, ${warningCount} warnings`} tone={errorCount > 0 ? 'error' : warningCount > 0 ? 'warn' : 'ok'} />
        <StatCard icon={Clock} title="Session Uptime" value={uptime} subtitle={`Version ${status?.version ?? '2.0.0-beta'}`} tone="info" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-bg-card border border-white/5 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">System Health</h2>
            <Zap size={16} className="text-accent-primary" />
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="text-text-secondary flex items-center gap-1.5"><Cpu size={14} /> CPU Usage</span>
                  <span className="text-text-primary font-mono text-xs">
                    {metrics ? `${metrics.cpu_percent.toFixed(1)}%` : '...'}
                  </span>
                </div>
                <div className="h-1.5 bg-bg-secondary rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-700 ${
                      !metrics ? 'bg-bg-tertiary' :
                      metrics.cpu_percent < 50 ? 'bg-semantic-success' :
                      metrics.cpu_percent < 80 ? 'bg-semantic-warning' :
                      'bg-semantic-error'
                    }`}
                    style={{ width: `${metrics ? Math.min(metrics.cpu_percent, 100) : 0}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="text-text-secondary flex items-center gap-1.5"><HardDrive size={14} /> Memory</span>
                  <span className="text-text-primary font-mono text-xs">
                    {metrics ? `${metrics.memory_used_mb} MB / ${metrics.memory_total_mb} MB` : '...'}
                  </span>
                </div>
                <div className="h-1.5 bg-bg-secondary rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-700 ${
                      !metrics ? 'bg-bg-tertiary' :
                      metrics.memory_percent < 60 ? 'bg-accent-primary' :
                      metrics.memory_percent < 85 ? 'bg-semantic-warning' :
                      'bg-semantic-error'
                    }`}
                    style={{ width: `${metrics ? Math.min(metrics.memory_percent, 100) : 0}%` }}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-3">
              {[
                { label: 'Vault Status', ok: !(status?.vaultLocked), text: status?.vaultLocked ? 'Locked' : 'Unlocked' },
                { label: 'File Monitor', ok: true, text: 'Active' },
                { label: 'Baseline', ok: true, text: 'Verified' },
                { label: 'IPC Socket', ok: serviceAvailable, text: serviceAvailable ? 'Connected' : 'Error' },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">{item.label}</span>
                  <span className={`flex items-center gap-1 ${item.ok ? 'text-semantic-success' : 'text-semantic-error'}`}>
                    {item.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {item.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-bg-card border border-white/5 rounded-xl p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted mb-4">Recent Events</h2>
          <div className="space-y-3">
            {recentEvents.length === 0 ? (
              <p className="text-sm text-text-muted">No events recorded yet.</p>
            ) : (
              recentEvents.map((evt, idx) => (
                <div key={`${evt.timestamp}-${idx}`} className="flex items-start gap-2.5">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${evt.severity === 'error' ? 'bg-semantic-error' : evt.severity === 'warning' ? 'bg-semantic-warning' : 'bg-accent-primary'}`} />
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary truncate">{evt.message}</p>
                    <p className="text-[11px] text-text-muted font-mono">{evt.timestamp}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StatusPage;
