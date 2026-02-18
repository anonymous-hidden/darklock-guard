import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Monitor,
  Plus,
  Copy,
  Check,
  Activity,
  Shield,
  ShieldAlert,
  ShieldOff,
  Clock,
  RefreshCw,
  Search,
} from 'lucide-react';

interface Device {
  id: string;
  name: string;
  os: string;
  status: 'online' | 'offline' | 'alert';
  last_heartbeat: string;
  baseline_valid: boolean;
  version: string;
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showLink, setShowLink] = useState(false);
  const [linkCode, setLinkCode] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);

  const fetchDevices = () => {
    setLoading(true);
    fetch('/api/devices')
      .then((r) => r.ok ? r.json() : [])
      .then(setDevices)
      .catch(() => setDevices([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchDevices(); }, []);

  const generateLink = async () => {
    try {
      const res = await fetch('/api/devices/generate-link', { method: 'POST' });
      const data = await res.json();
      setLinkCode(data.code);
      setShowLink(true);
    } catch {
      // handle error
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(linkCode);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const filtered = devices.filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    d.os.toLowerCase().includes(search.toLowerCase())
  );

  const statusIcon = (status: string) => {
    switch (status) {
      case 'online': return <Activity className="w-4 h-4 text-green-400" />;
      case 'alert': return <ShieldAlert className="w-4 h-4 text-red-400" />;
      default: return <ShieldOff className="w-4 h-4 text-dark-600" />;
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'online': return 'badge-green';
      case 'alert': return 'badge-red';
      default: return 'badge-yellow';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold">Devices</h1>
          <p className="text-dark-400 text-sm mt-1">{devices.length} device{devices.length !== 1 ? 's' : ''} linked</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={fetchDevices}
            className="btn-ghost text-sm gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={generateLink}
            className="btn-primary text-sm gap-2"
          >
            <Plus className="w-4 h-4" />
            Link Device
          </button>
        </div>
      </div>

      {/* Link Code Modal */}
      {showLink && (
        <div className="glass-card p-6 mb-6 border-brand-500/20">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Device Link Code</h3>
            <button onClick={() => setShowLink(false)} className="text-dark-500 hover:text-white text-sm">
              Dismiss
            </button>
          </div>
          <p className="text-sm text-dark-400 mb-4">
            Enter this code in the Darklock Guard desktop app under Settings → Connected Mode.
          </p>
          <div className="flex items-center gap-3">
            <code className="flex-1 bg-dark-950 rounded-lg px-5 py-3 text-center text-2xl font-mono tracking-[0.3em] text-brand-400">
              {linkCode || '------'}
            </code>
            <button onClick={copyCode} className="btn-ghost">
              {linkCopied ? <Check className="w-5 h-5 text-green-400" /> : <Copy className="w-5 h-5" />}
            </button>
          </div>
          <p className="text-xs text-dark-600 mt-3">Code expires in 10 minutes</p>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search devices..."
          className="input-field pl-10"
        />
      </div>

      {/* Device List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Monitor className="w-12 h-12 text-dark-700 mx-auto mb-4" />
          <h3 className="font-semibold mb-2">
            {devices.length === 0 ? 'No devices linked yet' : 'No matching devices'}
          </h3>
          <p className="text-sm text-dark-500 mb-6">
            {devices.length === 0
              ? 'Link your first device by generating a code and entering it in the desktop app.'
              : 'Try a different search term.'
            }
          </p>
          {devices.length === 0 && (
            <button onClick={generateLink} className="btn-primary text-sm gap-2">
              <Plus className="w-4 h-4" />
              Generate Link Code
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((device) => (
            <Link
              key={device.id}
              to={`/dashboard/devices/${device.id}`}
              className="glass-card p-5 flex items-center gap-4 hover:border-brand-500/20 transition-all group"
            >
              <div className="w-12 h-12 rounded-xl bg-dark-800/50 flex items-center justify-center flex-shrink-0">
                {statusIcon(device.status)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold group-hover:text-brand-400 transition-colors truncate">{device.name}</h3>
                  <span className={statusBadge(device.status)}>{device.status}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-dark-500">
                  <span>{device.os}</span>
                  <span>v{device.version}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {device.last_heartbeat ? new Date(device.last_heartbeat).toLocaleString() : 'Never'}
                  </span>
                </div>
              </div>
              <div className="flex-shrink-0">
                {device.baseline_valid ? (
                  <div className="flex items-center gap-1.5 text-xs text-green-400">
                    <Shield className="w-4 h-4" />
                    Baseline OK
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-red-400">
                    <ShieldAlert className="w-4 h-4" />
                    Tampered
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
