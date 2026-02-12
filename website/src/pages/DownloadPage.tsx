import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Download,
  Monitor,
  Apple,
  Terminal,
  Shield,
  CheckCircle2,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';

type OS = 'windows' | 'macos' | 'linux';

function detectOS(): OS {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'macos';
  return 'linux';
}

const platforms: Record<OS, { label: string; icon: typeof Monitor; ext: string; cmd?: string }> = {
  windows: { label: 'Windows', icon: Monitor, ext: '.msi' },
  macos: { label: 'macOS', icon: Apple, ext: '.dmg' },
  linux: { label: 'Linux', icon: Terminal, ext: '.deb', cmd: 'curl -fsSL https://get.darklock.net | bash' },
};

const changelog = [
  { version: 'v2.0.0-beta.3', date: '2025-01-15', notes: ['BLAKE3 integrity scanner', 'Connected mode dashboard', 'Crash-loop safe mode', 'Hash-chained event log'] },
  { version: 'v2.0.0-beta.2', date: '2024-12-20', notes: ['Ed25519 signed baselines', 'IPC authentication', 'Real-time file watcher'] },
  { version: 'v2.0.0-beta.1', date: '2024-12-01', notes: ['Initial beta release', 'Encrypted vault (DLOCK02)', 'Local mode setup wizard'] },
];

export default function DownloadPage() {
  const [os, setOS] = useState<OS>('linux');
  const [copied, setCopied] = useState(false);

  useEffect(() => setOS(detectOS()), []);

  const info = platforms[os];

  const copyCmd = () => {
    if (info.cmd) {
      navigator.clipboard.writeText(info.cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl sm:text-5xl font-bold mb-4">Download Darklock Guard</h1>
        <p className="text-dark-400 max-w-xl mx-auto">
          Free to use. No account required for local mode. Works on Windows, macOS, and Linux.
        </p>
      </div>

      {/* OS Tabs */}
      <div className="flex justify-center gap-2 mb-10">
        {(Object.entries(platforms) as [OS, typeof info][]).map(([key, p]) => (
          <button
            key={key}
            onClick={() => setOS(key)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
              os === key
                ? 'bg-brand-600/20 text-brand-400 border border-brand-500/30'
                : 'text-dark-400 hover:text-white hover:bg-dark-800/50 border border-transparent'
            }`}
          >
            <p.icon className="w-4 h-4" />
            {p.label}
          </button>
        ))}
      </div>

      {/* Download Card */}
      <div className="glass-card p-8 mb-8">
        <div className="flex flex-col md:flex-row items-center gap-8">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-brand-600/10 flex items-center justify-center">
                <info.icon className="w-6 h-6 text-brand-400" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">Darklock Guard for {info.label}</h2>
                <p className="text-sm text-dark-500">v2.0.0-beta.3 &middot; 28 MB</p>
              </div>
            </div>
            <ul className="space-y-2 mb-6">
              {['Runs as a background service', 'Desktop management app included', 'Auto-updates with signed releases'].map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-dark-300">
                  <CheckCircle2 className="w-4 h-4 text-brand-400 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-3">
              <a href={`/releases/darklock-guard-v2.0.0-beta.3-${os}${info.ext}`} className="btn-primary gap-2">
                <Download className="w-4 h-4" />
                Download {info.ext}
              </a>
              <Link to="/docs" className="btn-ghost gap-2 text-sm">
                Installation guide
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
          <div className="hidden md:block w-px h-32 bg-dark-800" />
          <div className="flex-shrink-0 text-center">
            <Shield className="w-20 h-20 text-brand-500/20 mx-auto mb-3" />
            <p className="text-xs text-dark-500 max-w-[200px]">
              All releases are Ed25519-signed.
              <br />
              Verify checksums before installing.
            </p>
          </div>
        </div>
      </div>

      {/* Linux CLI install */}
      {os === 'linux' && info.cmd && (
        <div className="glass-card p-6 mb-8">
          <h3 className="text-sm font-semibold text-dark-300 mb-3">Install via command line</h3>
          <div className="flex items-center gap-3 bg-dark-950 rounded-lg px-4 py-3 font-mono text-sm">
            <code className="flex-1 text-brand-400 overflow-x-auto">{info.cmd}</code>
            <button onClick={copyCmd} className="text-dark-500 hover:text-white transition-colors flex-shrink-0">
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {/* System Requirements */}
      <div className="glass-card p-6 mb-12">
        <h3 className="font-semibold mb-4">System Requirements</h3>
        <div className="grid sm:grid-cols-3 gap-6 text-sm">
          <div>
            <h4 className="text-dark-300 font-medium mb-2">Windows</h4>
            <ul className="space-y-1 text-dark-500">
              <li>Windows 10 (1809) or later</li>
              <li>64-bit x86_64</li>
              <li>WebView2 Runtime</li>
              <li>100 MB disk space</li>
            </ul>
          </div>
          <div>
            <h4 className="text-dark-300 font-medium mb-2">macOS</h4>
            <ul className="space-y-1 text-dark-500">
              <li>macOS 11 Big Sur or later</li>
              <li>Apple Silicon or Intel</li>
              <li>100 MB disk space</li>
            </ul>
          </div>
          <div>
            <h4 className="text-dark-300 font-medium mb-2">Linux</h4>
            <ul className="space-y-1 text-dark-500">
              <li>Ubuntu 20.04+ / Fedora 36+</li>
              <li>x86_64 or aarch64</li>
              <li>WebKitGTK 4.1</li>
              <li>100 MB disk space</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Changelog */}
      <div>
        <h2 className="text-2xl font-bold mb-6">Release History</h2>
        <div className="space-y-6">
          {changelog.map((r) => (
            <div key={r.version} className="glass-card p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="badge-blue">{r.version}</span>
                <span className="text-sm text-dark-500">{r.date}</span>
              </div>
              <ul className="space-y-1">
                {r.notes.map((n) => (
                  <li key={n} className="text-sm text-dark-400 flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-brand-500 flex-shrink-0" />
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
