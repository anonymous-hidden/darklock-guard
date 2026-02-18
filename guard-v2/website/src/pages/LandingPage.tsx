import { Link } from 'react-router-dom';
import {
  Shield,
  Lock,
  Eye,
  Zap,
  Monitor,
  Globe,
  ChevronRight,
  FileCheck,
  Bell,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';

const features = [
  {
    icon: FileCheck,
    title: 'BLAKE3 Integrity Baseline',
    desc: 'Cryptographic hashes of every protected file, signed with Ed25519 device keys so attackers cannot forge a clean baseline.',
  },
  {
    icon: Eye,
    title: 'Real-Time File Monitoring',
    desc: 'Watches file system events and instantly detects unauthorized modifications, deletions, or permission changes.',
  },
  {
    icon: Lock,
    title: 'Encrypted Vault Storage',
    desc: 'Passwords and keys never touch disk in plaintext. The DLOCK02 vault format uses Argon2 key derivation and authenticated encryption.',
  },
  {
    icon: Bell,
    title: 'Hash-Chained Event Log',
    desc: 'Every event is cryptographically chained to the previous one. Tamper with one record and the entire chain breaks.',
  },
  {
    icon: Globe,
    title: 'Connected Mode Dashboard',
    desc: 'Link devices to your Darklock account. Monitor integrity status, view events, and send remote actions from anywhere.',
  },
  {
    icon: Zap,
    title: 'Crash-Loop & Safe Mode',
    desc: 'Automatic crash detection with safe mode fallback. The service recovers gracefully from any failure scenario.',
  },
];

const stats = [
  { value: 'BLAKE3', label: 'Hash Algorithm' },
  { value: 'Ed25519', label: 'Digital Signatures' },
  { value: 'Argon2', label: 'Key Derivation' },
  { value: '<50ms', label: 'Detection Latency' },
];

export default function LandingPage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-brand-600/5 via-transparent to-transparent" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-brand-600/10 rounded-full blur-[120px] -mt-48" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-20">
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-600/10 border border-brand-500/20 text-brand-400 text-sm mb-8 animate-fadeIn">
              <Shield className="w-4 h-4" />
              Darklock Guard v2 — Now in Beta
            </div>
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6 animate-slideUp">
              Tamper-proof
              <br />
              <span className="bg-gradient-to-r from-brand-400 to-purple-400 bg-clip-text text-transparent">
                integrity protection
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-dark-400 max-w-2xl mx-auto mb-10 leading-relaxed animate-slideUp" style={{ animationDelay: '0.1s' }}>
              Detect unauthorized file changes before they cause damage. Cryptographic baselines,
              real-time monitoring, and signed event logs — all running as a lightweight system service.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-slideUp" style={{ animationDelay: '0.2s' }}>
              <Link to="/download" className="btn-primary text-base px-8 py-3 gap-2">
                <Monitor className="w-5 h-5" />
                Download for Free
                <ChevronRight className="w-4 h-4" />
              </Link>
              <Link to="/docs" className="btn-secondary text-base px-8 py-3">
                Read the Docs
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-dark-800/50 bg-dark-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-2xl font-bold text-brand-400">{s.value}</div>
                <div className="text-sm text-dark-500 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">Security-first architecture</h2>
          <p className="text-dark-400 max-w-2xl mx-auto">
            Every layer is designed to detect tampering, prevent privilege escalation, and provide a verifiable audit trail.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div key={f.title} className="glass-card p-6 group hover:border-brand-500/30 transition-all duration-300">
              <div className="w-12 h-12 rounded-xl bg-brand-600/10 flex items-center justify-center mb-4 group-hover:bg-brand-600/20 transition-colors">
                <f.icon className="w-6 h-6 text-brand-400" />
              </div>
              <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-dark-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="bg-dark-900/50 border-y border-dark-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">How it works</h2>
            <p className="text-dark-400 max-w-2xl mx-auto">
              Three simple steps to protect your system files from unauthorized modification.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                title: 'Install & Initialize',
                desc: 'Run the installer. The setup wizard creates an encrypted vault, generates Ed25519 signing keys, and establishes your first integrity baseline.',
              },
              {
                step: '02',
                title: 'Monitor & Detect',
                desc: 'The guard service watches your protected files in real-time. Any unauthorized change triggers an immediate alert with full context.',
              },
              {
                step: '03',
                title: 'Review & Respond',
                desc: 'View events in the desktop app or the web dashboard. Approve legitimate changes, investigate anomalies, and maintain a signed audit trail.',
              },
            ].map((item) => (
              <div key={item.step} className="relative">
                <div className="text-6xl font-black text-dark-800/50 mb-4">{item.step}</div>
                <h3 className="text-xl font-semibold mb-3">{item.title}</h3>
                <p className="text-sm text-dark-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Local vs Connected */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">Your choice of operation</h2>
          <p className="text-dark-400 max-w-2xl mx-auto">
            Use Darklock Guard in fully offline local mode or connect to the platform for remote management.
          </p>
        </div>
        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          <div className="glass-card p-8">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-4">
              <Lock className="w-6 h-6 text-emerald-400" />
            </div>
            <h3 className="text-xl font-semibold mb-3">Local Mode</h3>
            <p className="text-sm text-dark-400 mb-6 leading-relaxed">
              Everything stays on your machine. No account required, no network calls. Your vault, keys, and event logs never leave the device.
            </p>
            <ul className="space-y-2">
              {['Zero network dependency', 'Encrypted local vault', 'Signed event log', 'Full offline operation'].map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-dark-300">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="glass-card p-8 border-brand-500/20">
            <div className="w-12 h-12 rounded-xl bg-brand-600/10 flex items-center justify-center mb-4">
              <Globe className="w-6 h-6 text-brand-400" />
            </div>
            <h3 className="text-xl font-semibold mb-3">Connected Mode</h3>
            <p className="text-sm text-dark-400 mb-6 leading-relaxed">
              Link your device to a Darklock account. Monitor multiple machines from the web dashboard, send remote actions, and sync settings.
            </p>
            <ul className="space-y-2">
              {['Multi-device management', 'Web dashboard & logs', 'Remote lock & scan', 'Heartbeat monitoring'].map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-dark-300">
                  <CheckCircle2 className="w-4 h-4 text-brand-400 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        <div className="glass-card p-12 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-brand-600/5 via-purple-600/5 to-brand-600/5" />
          <div className="relative">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Ready to protect your system?</h2>
            <p className="text-dark-400 max-w-xl mx-auto mb-8">
              Download Darklock Guard for free and set up tamper-proof protection in under two minutes.
            </p>
            <Link to="/download" className="btn-primary text-base px-10 py-3 gap-2 inline-flex">
              Get Started
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
