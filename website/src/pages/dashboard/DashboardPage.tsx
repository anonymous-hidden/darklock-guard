import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Monitor,
  Shield,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRight,
} from 'lucide-react';

interface DashboardStats {
  totalDevices: number;
  onlineDevices: number;
  recentAlerts: number;
  lastScanTime: string | null;
}

interface RecentEvent {
  id: string;
  device_name: string;
  event_type: string;
  message: string;
  created_at: string;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalDevices: 0,
    onlineDevices: 0,
    recentAlerts: 0,
    lastScanTime: null,
  });
  const [events, setEvents] = useState<RecentEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/dashboard/stats').then((r) => r.ok ? r.json() : null),
      fetch('/api/dashboard/recent-events').then((r) => r.ok ? r.json() : null),
    ])
      .then(([s, e]) => {
        if (s) setStats(s);
        if (e) setEvents(e);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-dark-400 text-sm mt-1">Overview of your protected devices</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          {
            icon: Monitor,
            label: 'Total Devices',
            value: stats.totalDevices,
            color: 'text-brand-400',
            bg: 'bg-brand-600/10',
          },
          {
            icon: Activity,
            label: 'Online Now',
            value: stats.onlineDevices,
            color: 'text-green-400',
            bg: 'bg-green-500/10',
          },
          {
            icon: AlertTriangle,
            label: 'Recent Alerts',
            value: stats.recentAlerts,
            color: stats.recentAlerts > 0 ? 'text-red-400' : 'text-dark-500',
            bg: stats.recentAlerts > 0 ? 'bg-red-500/10' : 'bg-dark-800/50',
          },
          {
            icon: Clock,
            label: 'Last Scan',
            value: stats.lastScanTime ? new Date(stats.lastScanTime).toLocaleString() : 'Never',
            color: 'text-dark-400',
            bg: 'bg-dark-800/50',
            small: true,
          },
        ].map((card) => (
          <div key={card.label} className="glass-card p-5">
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-xl ${card.bg} flex items-center justify-center`}>
                <card.icon className={`w-5 h-5 ${card.color}`} />
              </div>
            </div>
            <div className={`${card.small ? 'text-sm' : 'text-2xl'} font-bold`}>{card.value}</div>
            <div className="text-xs text-dark-500 mt-1">{card.label}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent Events */}
        <div className="lg:col-span-2">
          <div className="glass-card">
            <div className="flex items-center justify-between p-5 border-b border-dark-800/50">
              <h2 className="font-semibold">Recent Events</h2>
              <Link to="/dashboard/logs" className="text-sm text-brand-400 hover:underline flex items-center gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="divide-y divide-dark-800/50">
              {events.length === 0 ? (
                <div className="p-8 text-center text-sm text-dark-500">
                  <Shield className="w-8 h-8 mx-auto mb-2 text-dark-700" />
                  No events recorded yet
                </div>
              ) : (
                events.slice(0, 8).map((ev) => (
                  <div key={ev.id} className="px-5 py-3 flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      ev.event_type === 'alert' ? 'bg-red-400' :
                      ev.event_type === 'warning' ? 'bg-yellow-400' : 'bg-dark-600'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-dark-200 truncate">{ev.message}</p>
                      <p className="text-xs text-dark-500">{ev.device_name}</p>
                    </div>
                    <span className="text-xs text-dark-600 flex-shrink-0">
                      {new Date(ev.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div>
          <div className="glass-card p-5">
            <h2 className="font-semibold mb-4">Quick Actions</h2>
            <div className="space-y-2">
              <Link
                to="/dashboard/devices"
                className="flex items-center gap-3 p-3 rounded-lg bg-dark-800/30 hover:bg-dark-800/50 transition-colors"
              >
                <Monitor className="w-5 h-5 text-brand-400" />
                <div>
                  <p className="text-sm font-medium">Manage Devices</p>
                  <p className="text-xs text-dark-500">View and manage linked devices</p>
                </div>
              </Link>
              <Link
                to="/dashboard/logs"
                className="flex items-center gap-3 p-3 rounded-lg bg-dark-800/30 hover:bg-dark-800/50 transition-colors"
              >
                <Activity className="w-5 h-5 text-green-400" />
                <div>
                  <p className="text-sm font-medium">View Audit Log</p>
                  <p className="text-xs text-dark-500">Browse the full event history</p>
                </div>
              </Link>
              <Link
                to="/dashboard/settings"
                className="flex items-center gap-3 p-3 rounded-lg bg-dark-800/30 hover:bg-dark-800/50 transition-colors"
              >
                <Shield className="w-5 h-5 text-yellow-400" />
                <div>
                  <p className="text-sm font-medium">Security Settings</p>
                  <p className="text-xs text-dark-500">2FA, API keys, preferences</p>
                </div>
              </Link>
            </div>
          </div>

          {/* System Status */}
          <div className="glass-card p-5 mt-4">
            <h2 className="font-semibold mb-4">System Status</h2>
            <div className="space-y-3">
              {[
                { label: 'Platform API', status: 'operational' },
                { label: 'Update Server', status: 'operational' },
                { label: 'Event Ingestion', status: 'operational' },
              ].map((s) => (
                <div key={s.label} className="flex items-center justify-between text-sm">
                  <span className="text-dark-400">{s.label}</span>
                  <span className="flex items-center gap-1.5 text-green-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Operational
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
