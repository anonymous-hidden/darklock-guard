import React, { useState, useEffect } from 'react';
import { getSettings, updateSettings } from '../api';
import { useService } from '../state/service';
import type { GuardSettings, SecurityMode } from '../state/settings';
import {
  Settings, Shield, Zap, Cpu, Eye, Lock, Save,
  CheckCircle2, AlertTriangle, Database
} from 'lucide-react';

const Toggle: React.FC<{ on: boolean; onChange: () => void; disabled?: boolean }> = ({ on, onChange, disabled }) => (
  <button onClick={disabled ? undefined : onChange} className={`relative w-11 h-6 rounded-full transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${on ? 'bg-accent-primary' : 'bg-bg-secondary'}`}>
    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${on ? 'translate-x-5' : ''}`} />
  </button>
);

const Section: React.FC<{ icon: React.ElementType; title: string; desc?: string; children: React.ReactNode }> = ({ icon: Icon, title, desc, children }) => (
  <div className="bg-bg-card border border-white/5 rounded-xl p-5">
    <div className="flex items-center gap-2 mb-4">
      <Icon size={16} className="text-accent-primary" />
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {desc && <p className="text-[11px] text-text-muted">{desc}</p>}
      </div>
    </div>
    <div className="space-y-3">{children}</div>
  </div>
);

const Row: React.FC<{ label: string; desc?: string; children: React.ReactNode }> = ({ label, desc, children }) => (
  <div className="flex items-center justify-between py-2">
    <div>
      <p className="text-sm">{label}</p>
      {desc && <p className="text-[11px] text-text-muted">{desc}</p>}
    </div>
    {children}
  </div>
);

const SettingsPage: React.FC = () => {
  const { serviceAvailable } = useService();
  const [settings, setSettings] = useState<GuardSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    getSettings().then(s => setSettings(s)).catch(() => {
      // Fallback defaults matching the exact Rust GuardSettings struct
      setSettings({
        security_mode: 'Normal',
        protection: { realtime_enabled: true, baseline_locked: false, protected_paths: [], quarantine_enabled: true },
        performance: { max_cpu_percent: 30, max_memory_mb: 512 },
        updates: { auto_update: true, channel: 'stable' },
        privacy: { telemetry_enabled: false, crash_reports: true },
      });
    });
  }, []);

  const patch = (fn: (s: GuardSettings) => GuardSettings) => {
    setSettings(prev => prev ? fn(JSON.parse(JSON.stringify(prev))) : prev);
    setDirty(true);
    setSaved(false);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError('');
    try {
      await updateSettings(settings);
      setSaved(true);
      setDirty(false);
    } catch (e: any) {
      setError(e?.message || 'Failed to save settings');
    }
    setSaving(false);
  };

  if (!settings) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Settings size={32} className="text-text-muted mx-auto mb-3 animate-spin" />
          <p className="text-sm text-text-muted">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Settings</h1>
          <p className="text-sm text-text-muted mt-0.5">Configure Darklock Guard preferences</p>
        </div>
        <button
          onClick={save}
          disabled={!dirty || saving}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${dirty ? 'bg-accent-primary text-bg-primary hover:opacity-90' : 'bg-bg-card border border-white/5 text-text-muted cursor-not-allowed'}`}
        >
          {saving ? <Settings size={14} className="animate-spin" /> : saved ? <CheckCircle2 size={14} /> : <Save size={14} />}
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>

      {error && (
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-xl p-3 flex items-center gap-2">
          <AlertTriangle size={14} className="text-semantic-error" />
          <p className="text-sm text-text-secondary">{error}</p>
        </div>
      )}

      {/* Security Mode - matches Rust SecurityMode: Normal | Strict */}
      <Section icon={Shield} title="Security Mode" desc="Control the overall protection posture">
        <div className="grid grid-cols-2 gap-2">
          {([
            { id: 'Normal' as SecurityMode, label: 'Normal', desc: 'Balanced protection for everyday use', color: 'accent-primary' },
            { id: 'Strict' as SecurityMode, label: 'Strict', desc: 'Maximum security — lock everything down', color: 'semantic-warning' },
          ]).map(mode => (
            <button
              key={mode.id}
              onClick={() => patch(s => { s.security_mode = mode.id; return s; })}
              className={`p-3 rounded-lg border text-left transition-all ${settings.security_mode === mode.id ? `border-${mode.color}/40 bg-${mode.color}/5` : 'border-white/5 hover:border-white/10'}`}
            >
              <p className="text-sm font-semibold">{mode.label}</p>
              <p className="text-[11px] text-text-muted">{mode.desc}</p>
            </button>
          ))}
        </div>
      </Section>

      {/* Protection - matches Rust ProtectionSettings */}
      <Section icon={Eye} title="Protection" desc="File monitoring and integrity checks">
        <Row label="Real-time File Monitoring" desc="Watch protected directories for changes">
          <Toggle on={settings.protection.realtime_enabled} onChange={() => patch(s => { s.protection.realtime_enabled = !s.protection.realtime_enabled; return s; })} />
        </Row>
        <Row label="Baseline Lock" desc="Prevent baseline modifications without re-signing">
          <Toggle on={settings.protection.baseline_locked} onChange={() => patch(s => { s.protection.baseline_locked = !s.protection.baseline_locked; return s; })} />
        </Row>
        <Row label="Quarantine on Tamper" desc="Move tampered files to quarantine automatically">
          <Toggle on={settings.protection.quarantine_enabled} onChange={() => patch(s => { s.protection.quarantine_enabled = !s.protection.quarantine_enabled; return s; })} />
        </Row>
      </Section>

      {/* Performance - matches Rust PerformanceLimits */}
      <Section icon={Cpu} title="Performance" desc="Resource allocation and optimization">
        <Row label="Max CPU Usage" desc="Maximum CPU percentage for scan operations">
          <select
            value={settings.performance.max_cpu_percent}
            onChange={e => patch(s => { s.performance.max_cpu_percent = parseInt(e.target.value); return s; })}
            className="bg-bg-secondary border border-white/5 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent-primary/50"
          >
            {[10, 20, 30, 50, 75, 100].map(n => <option key={n} value={n}>{n}%</option>)}
          </select>
        </Row>
        <Row label="Memory Limit" desc="Maximum RAM usage for scan operations">
          <select
            value={settings.performance.max_memory_mb}
            onChange={e => patch(s => { s.performance.max_memory_mb = parseInt(e.target.value); return s; })}
            className="bg-bg-secondary border border-white/5 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent-primary/50"
          >
            {[128, 256, 512, 1024].map(n => <option key={n} value={n}>{n} MB</option>)}
          </select>
        </Row>
      </Section>

      {/* Updates - matches Rust UpdateSettings */}
      <Section icon={Zap} title="Updates" desc="Auto-update and channel configuration">
        <Row label="Automatic Updates" desc="Download and install updates in the background">
          <Toggle on={settings.updates.auto_update} onChange={() => patch(s => { s.updates.auto_update = !s.updates.auto_update; return s; })} />
        </Row>
        <Row label="Update Channel">
          <div className="flex gap-1">
            {(['stable', 'beta'] as const).map(ch => (
              <button
                key={ch}
                onClick={() => patch(s => { s.updates.channel = ch; return s; })}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${settings.updates.channel === ch ? 'bg-accent-primary/20 text-accent-primary' : 'bg-bg-secondary text-text-muted'}`}
              >
                {ch}
              </button>
            ))}
          </div>
        </Row>
      </Section>

      {/* Privacy - matches Rust PrivacySettings */}
      <Section icon={Lock} title="Privacy" desc="Data collection and reporting">
        <Row label="Telemetry" desc="Send anonymous usage statistics to improve Darklock">
          <Toggle on={settings.privacy.telemetry_enabled} onChange={() => patch(s => { s.privacy.telemetry_enabled = !s.privacy.telemetry_enabled; return s; })} />
        </Row>
        <Row label="Crash Reports" desc="Automatically report crashes to help fix bugs">
          <Toggle on={settings.privacy.crash_reports} onChange={() => patch(s => { s.privacy.crash_reports = !s.privacy.crash_reports; return s; })} />
        </Row>
      </Section>

      {/* About */}
      <Section icon={Database} title="About" desc="Application information">
        <div className="grid grid-cols-2 gap-2 text-sm">
          {[
            ['Version', 'v2.0.0'],
            ['Framework', 'Tauri v2'],
            ['Vault Format', 'DLOCK02'],
            ['Crypto', 'BLAKE3 + Ed25519'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between bg-bg-secondary/30 rounded-lg px-3 py-2">
              <span className="text-text-muted">{k}</span>
              <span className="font-mono text-xs">{v}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
};

export default SettingsPage;
