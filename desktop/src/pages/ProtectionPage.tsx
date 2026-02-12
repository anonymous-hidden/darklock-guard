import React, { useEffect, useState } from 'react';
import { useService } from '../state/service';
import { getSettings, updateSettings } from '../api';
import type { GuardSettings } from '../state/settings';
import { Shield, Lock, Unlock, Fingerprint, Eye, EyeOff, ToggleLeft, ToggleRight, AlertTriangle, FileKey, FolderLock, ShieldCheck, X } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';

const Toggle: React.FC<{ enabled: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; description?: string }> = ({ enabled, onChange, disabled, label, description }) => (
  <div className="flex items-center justify-between py-3 group">
    <div>
      <p className="text-sm text-text-primary font-medium">{label}</p>
      {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
    </div>
    <button
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-all duration-200 ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${enabled ? 'bg-accent-primary' : 'bg-bg-secondary border border-white/10'}`}
    >
      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200 ${enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  </div>
);

const Section: React.FC<React.PropsWithChildren<{ title: string; icon: React.ElementType; description?: string }>> = ({ title, icon: Icon, description, children }) => (
  <div className="bg-bg-card border border-white/5 rounded-xl p-5">
    <div className="flex items-center gap-2.5 mb-4">
      <div className="p-2 rounded-lg bg-accent-primary/10">
        <Icon size={18} className="text-accent-primary" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {description && <p className="text-xs text-text-muted">{description}</p>}
      </div>
    </div>
    <div className="divide-y divide-white/5">{children}</div>
  </div>
);

const ProtectionPage: React.FC = () => {
  const { serviceAvailable, status } = useService();
  const [settings, setSettings] = useState<GuardSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!serviceAvailable) return;
    getSettings().then(setSettings).catch((e) => setError(e?.toString?.() ?? 'Failed to load'));
  }, [serviceAvailable]);

  const save = async (next: GuardSettings, msg: string) => {
    setSaving(true); setError(null); setSuccess('');
    try {
      await updateSettings(next);
      setSettings(next);
      setSuccess(msg);
      setTimeout(() => setSuccess(''), 2000);
    } catch (e: any) { setError(e?.toString?.() ?? 'Save failed'); }
    finally { setSaving(false); }
  };

  const isSafeMode = status?.mode === 'safemode';
  const isRemoteSafeMode = isSafeMode && status?.safeModeReason === 'REMOTE_COMMAND';
  const disabled = !serviceAvailable || saving || !settings || isSafeMode;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold">Protection Settings</h1>
        <p className="text-sm text-text-muted mt-0.5">Configure real-time protection and security profiles</p>
      </div>

      {isSafeMode && (
        <div className={`rounded-xl p-4 flex items-center gap-3 ${isRemoteSafeMode ? 'bg-orange-500/10 border border-orange-500/30' : 'bg-semantic-warning/10 border border-semantic-warning/30'}`}>
          <AlertTriangle size={20} className={isRemoteSafeMode ? 'text-orange-400' : 'text-semantic-warning'} />
          <p className="text-sm text-text-secondary">Safe Mode active — protection settings are locked.</p>
        </div>
      )}

      {error && <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-3 text-sm text-semantic-error">{error}</div>}
      {success && <div className="bg-semantic-success/10 border border-semantic-success/30 rounded-lg p-3 text-sm text-semantic-success">{success}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Real-time Protection" icon={ShieldCheck} description="Monitor files and system integrity continuously">
          <Toggle
            label="Real-time File Monitoring"
            description="Watch protected directories for unauthorized changes"
            enabled={!!settings?.protection.realtime_enabled}
            onChange={(v) => settings && save({ ...settings, protection: { ...settings.protection, realtime_enabled: v } }, 'Real-time monitoring updated')}
            disabled={disabled}
          />
          <Toggle
            label="Lock Baseline"
            description="Prevent baseline from being regenerated without authentication"
            enabled={!!settings?.protection.baseline_locked}
            onChange={(v) => settings && save({ ...settings, protection: { ...settings.protection, baseline_locked: v } }, 'Baseline lock updated')}
            disabled={disabled}
          />
        </Section>

        <Section title="Security Profile" icon={Shield} description="Choose your security posture">
          <div className="grid grid-cols-2 gap-3 pt-2">
            {[
              { mode: 'Normal' as const, icon: Shield, label: 'Standard', desc: 'Balanced security, vault stays unlocked during session' },
              { mode: 'Strict' as const, icon: Lock, label: 'Strict', desc: 'Maximum security, frequent re-authentication required' },
            ].map((opt) => (
              <button
                key={opt.mode}
                onClick={() => settings && !disabled && save({ ...settings, security_mode: opt.mode }, `Switched to ${opt.label} mode`)}
                disabled={disabled}
                className={`p-4 rounded-lg border text-left transition-all duration-200 ${
                  settings?.security_mode === opt.mode
                    ? 'border-accent-primary bg-accent-primary/5 shadow-glow/20'
                    : 'border-white/10 hover:border-white/20'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <opt.icon size={20} className={settings?.security_mode === opt.mode ? 'text-accent-primary' : 'text-text-muted'} />
                <p className="font-semibold text-sm mt-2">{opt.label}</p>
                <p className="text-xs text-text-muted mt-1">{opt.desc}</p>
              </button>
            ))}
          </div>
        </Section>
      </div>

      <Section title="Vault & Encryption" icon={FileKey} description="Vault status and cryptographic details">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
          {[
            { label: 'Vault Format', value: 'DLOCK02' },
            { label: 'Key Derivation', value: 'Argon2id' },
            { label: 'Signing', value: 'Ed25519' },
            { label: 'Hashing', value: 'BLAKE3' },
          ].map((item) => (
            <div key={item.label} className="text-center p-3 bg-bg-secondary/50 rounded-lg">
              <p className="text-[11px] text-text-muted uppercase tracking-wider">{item.label}</p>
              <p className="text-sm font-mono text-accent-primary mt-1">{item.value}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Protected Directories" icon={FolderLock} description="Directories monitored for file changes">
        <div className="pt-2 space-y-2">
          {(settings?.protection.protected_paths || []).length === 0 ? (
            <p className="text-xs text-text-muted py-2">No directories configured. Add directories to monitor for file changes.</p>
          ) : (
            (settings?.protection.protected_paths || []).map((dir) => (
              <div key={dir} className="flex items-center justify-between text-sm py-2 group">
                <span className="font-mono text-text-secondary text-xs flex-1 truncate">{dir}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-semantic-success flex items-center gap-1"><Eye size={10} /> Active</span>
                  <button
                    onClick={() => {
                      if (!settings) return;
                      const updated = settings.protection.protected_paths.filter(p => p !== dir);
                      save({ ...settings, protection: { ...settings.protection, protected_paths: updated } }, 'Directory removed');
                    }}
                    disabled={disabled}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-semantic-error hover:text-semantic-error/80 disabled:opacity-0"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
          <button
            onClick={async () => {
              if (!settings) return;
              try {
                const selected = await open({
                  directory: true,
                  multiple: false,
                  title: 'Select Directory to Protect',
                });
                if (selected && typeof selected === 'string') {
                  const paths = settings.protection.protected_paths || [];
                  if (!paths.includes(selected)) {
                    await save({ ...settings, protection: { ...settings.protection, protected_paths: [...paths, selected] } }, 'Directory added');
                  }
                }
              } catch (e) {
                console.error('Failed to open directory picker:', e);
              }
            }}
            disabled={disabled}
            className="mt-2 text-xs text-accent-primary hover:underline disabled:opacity-40"
          >
            + Add Directory
          </button>
        </div>
      </Section>
    </div>
  );
};

export default ProtectionPage;
