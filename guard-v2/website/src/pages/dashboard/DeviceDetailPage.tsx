import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Monitor,
  Activity,
  Shield,
  ShieldAlert,
  Clock,
  Lock,
  Scan,
  RotateCcw,
  Send,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from 'lucide-react';

interface DeviceDetail {
  id: string;
  name: string;
  os: string;
  status: 'online' | 'offline' | 'alert';
  last_heartbeat: string;
  baseline_valid: boolean;
  baseline_files: number;
  version: string;
  public_key: string;
  linked_at: string;
  last_scan: string | null;
}

interface DeviceEvent {
  id: string;
  event_type: string;
  message: string;
  created_at: string;
}

interface PendingCommand {
  id: string;
  action: string;
  status: string;
  created_at: string;
}

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [device, setDevice] = useState<DeviceDetail | null>(null);
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [commands, setCommands] = useState<PendingCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetch(`/api/devices/${id}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/devices/${id}/events?limit=20`).then((r) => r.ok ? r.json() : []),
      fetch(`/api/devices/${id}/pending-commands`).then((r) => r.ok ? r.json() : []),
    ])
      .then(([d, e, c]) => {
        if (d) setDevice(d);
        if (e) setEvents(e);
        if (c) setCommands(c);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const sendAction = async (action: string) => {
    if (!id) return;
    setActionLoading(action);
    try {
      const res = await fetch(`/api/devices/${id}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const cmd = await res.json();
        setCommands((prev) => [cmd, ...prev]);
      }
    } catch {
      // handle error
    } finally {
      setActionLoading('');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!device) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="glass-card p-12 text-center">
          <Monitor className="w-12 h-12 text-dark-700 mx-auto mb-4" />
          <h2 className="font-semibold mb-2">Device not found</h2>
          <Link to="/dashboard/devices" className="text-sm text-brand-400 hover:underline">
            Back to devices
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back */}
      <Link to="/dashboard/devices" className="inline-flex items-center gap-2 text-sm text-dark-400 hover:text-white mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to devices
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-8">
        <div className="w-14 h-14 rounded-2xl bg-dark-800/50 flex items-center justify-center flex-shrink-0">
          <Monitor className="w-7 h-7 text-brand-400" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{device.name}</h1>
            <span className={`${
              device.status === 'online' ? 'badge-green' :
              device.status === 'alert' ? 'badge-red' : 'badge-yellow'
            }`}>
              {device.status}
            </span>
          </div>
          <p className="text-sm text-dark-500 mt-1">
            {device.os} &middot; v{device.version} &middot; Linked {new Date(device.linked_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Status Cards */}
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-2">
                {device.baseline_valid ? (
                  <Shield className="w-5 h-5 text-green-400" />
                ) : (
                  <ShieldAlert className="w-5 h-5 text-red-400" />
                )}
                <span className="text-sm font-medium">Baseline</span>
              </div>
              <p className={`text-lg font-bold ${device.baseline_valid ? 'text-green-400' : 'text-red-400'}`}>
                {device.baseline_valid ? 'Valid' : 'Tampered'}
              </p>
              <p className="text-xs text-dark-500">{device.baseline_files} files</p>
            </div>
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-5 h-5 text-brand-400" />
                <span className="text-sm font-medium">Last Heartbeat</span>
              </div>
              <p className="text-sm font-medium">
                {device.last_heartbeat ? new Date(device.last_heartbeat).toLocaleString() : 'Never'}
              </p>
            </div>
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-5 h-5 text-dark-400" />
                <span className="text-sm font-medium">Last Scan</span>
              </div>
              <p className="text-sm font-medium">
                {device.last_scan ? new Date(device.last_scan).toLocaleString() : 'Never'}
              </p>
            </div>
          </div>

          {/* Event History */}
          <div className="glass-card">
            <div className="p-5 border-b border-dark-800/50">
              <h2 className="font-semibold">Recent Events</h2>
            </div>
            <div className="divide-y divide-dark-800/50 max-h-96 overflow-y-auto">
              {events.length === 0 ? (
                <div className="p-8 text-center text-sm text-dark-500">No events recorded</div>
              ) : (
                events.map((ev) => (
                  <div key={ev.id} className="px-5 py-3 flex items-start gap-3">
                    <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
                      ev.event_type === 'alert' ? 'bg-red-400' :
                      ev.event_type === 'warning' ? 'bg-yellow-400' :
                      ev.event_type === 'scan' ? 'bg-blue-400' : 'bg-dark-600'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-dark-200">{ev.message}</p>
                      <p className="text-xs text-dark-600 mt-0.5">
                        {new Date(ev.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Remote Actions */}
          <div className="glass-card p-5">
            <h2 className="font-semibold mb-4">Remote Actions</h2>
            <div className="space-y-2">
              {[
                { action: 'trigger_scan', label: 'Trigger Scan', icon: Scan, desc: 'Run integrity check' },
                { action: 'lock_vault', label: 'Lock Vault', icon: Lock, desc: 'Lock the device vault' },
                { action: 'request_logs', label: 'Request Logs', icon: RotateCcw, desc: 'Pull recent events' },
              ].map((a) => (
                <button
                  key={a.action}
                  onClick={() => sendAction(a.action)}
                  disabled={device.status === 'offline' || actionLoading === a.action}
                  className="w-full flex items-center gap-3 p-3 rounded-lg bg-dark-800/30 hover:bg-dark-800/50 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {actionLoading === a.action ? (
                    <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
                  ) : (
                    <a.icon className="w-5 h-5 text-brand-400" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{a.label}</p>
                    <p className="text-xs text-dark-500">{a.desc}</p>
                  </div>
                </button>
              ))}
            </div>
            {device.status === 'offline' && (
              <p className="text-xs text-dark-600 mt-3 flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3" />
                Device is offline. Commands will queue.
              </p>
            )}
          </div>

          {/* Pending Commands */}
          <div className="glass-card p-5">
            <h2 className="font-semibold mb-4">Pending Commands</h2>
            {commands.length === 0 ? (
              <p className="text-sm text-dark-500">No pending commands</p>
            ) : (
              <div className="space-y-2">
                {commands.map((cmd) => (
                  <div key={cmd.id} className="flex items-center gap-3 text-sm">
                    <div className={`w-2 h-2 rounded-full ${
                      cmd.status === 'completed' ? 'bg-green-400' :
                      cmd.status === 'failed' ? 'bg-red-400' : 'bg-yellow-400'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-dark-300 truncate">{cmd.action}</p>
                      <p className="text-xs text-dark-600">{new Date(cmd.created_at).toLocaleTimeString()}</p>
                    </div>
                    <span className={`text-xs ${
                      cmd.status === 'completed' ? 'text-green-400' :
                      cmd.status === 'failed' ? 'text-red-400' : 'text-yellow-400'
                    }`}>
                      {cmd.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Device Info */}
          <div className="glass-card p-5">
            <h2 className="font-semibold mb-4">Device Info</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-dark-500">Device ID</dt>
                <dd className="text-dark-300 font-mono text-xs">{device.id.slice(0, 8)}...</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-dark-500">OS</dt>
                <dd className="text-dark-300">{device.os}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-dark-500">Version</dt>
                <dd className="text-dark-300">v{device.version}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-dark-500">Linked</dt>
                <dd className="text-dark-300">{new Date(device.linked_at).toLocaleDateString()}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
