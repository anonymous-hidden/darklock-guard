import React, { useState, useEffect } from 'react';
import { getSettings, updateSettings } from '../api';
import { useService } from '../state/service';
import type { GuardSettings, SecurityMode } from '../state/settings';
import {
  Settings, Shield, Zap, Cpu, Eye, Lock, Save,
  CheckCircle2, AlertTriangle, Database
} from 'lucide-react';
import { StrictModePasswordDialog } from '../components/StrictModePasswordDialog';
import {
  setStrictModePassword,
  verifyStrictModePassword,
  clearStrictModePassword,
} from '../utils/strictMode';

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
  const [passwordDialog, setPasswordDialog] = useState<{
    mode: 'create' | 'verify';
    targetMode: SecurityMode;
  } | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<{
    title: string;
    description: string;
    onConfirm: (password: string) => Promise<void>;
  } | null>(null);

  useEffect(() => {
    getSettings().then(s => {
      // Sync settings with localStorage strict mode state
      const strictModeEnabled = localStorage.getItem('darklock_strict_mode_enabled') === 'true';
      if (strictModeEnabled && s.security_mode !== 'Strict') {
        // If strict mode is enabled in localStorage but settings say Normal, fix it
        s.security_mode = 'Strict';
        updateSettings(s).catch(console.error); // Save corrected settings
      }
      
      // Ensure strict_settings exists if in strict mode
      if (s.security_mode === 'Strict' && !s.strict_settings) {
        s.strict_settings = {
          require_password_for_settings: true,
          require_password_for_protection_changes: true,
          require_password_for_scans: false,
          lock_on_idle: false,
          idle_timeout_minutes: 5,
        };
      }
      
      setSettings(s);
    }).catch(() => {
      // Fallback defaults matching the exact Rust GuardSettings struct
      const strictModeEnabled = localStorage.getItem('darklock_strict_mode_enabled') === 'true';
      setSettings({
        security_mode: strictModeEnabled ? 'Strict' : 'Normal',
        strict_settings: strictModeEnabled ? {
          require_password_for_settings: true,
          require_password_for_protection_changes: true,
          require_password_for_scans: false,
          lock_on_idle: false,
          idle_timeout_minutes: 5,
        } : undefined,
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

  const patchWithPasswordCheck = async (fn: (s: GuardSettings) => GuardSettings, actionDescription: string) => {
    // Check if password is required for settings changes
    if (settings?.security_mode === 'Strict' && settings.strict_settings?.require_password_for_settings) {
      return new Promise<void>((resolve, reject) => {
        setPasswordPrompt({
          title: 'Confirm Password',
          description: `Enter your Strict Mode password to ${actionDescription}`,
          onConfirm: async (password) => {
            const valid = await verifyStrictModePassword(password);
            if (!valid) {
              throw new Error('Incorrect password');
            }
            patch(fn);
            setPasswordPrompt(null);
            resolve();
          },
        });
      });
    } else {
      patch(fn);
    }
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
              onClick={() => {
                // Switching to Strict: require password creation
                if (mode.id === 'Strict' && settings.security_mode !== 'Strict') {
                  setPasswordDialog({ mode: 'create', targetMode: 'Strict' });
                }
                // Switching from Strict to Normal: require password verification
                else if (mode.id === 'Normal' && settings.security_mode === 'Strict') {
                  setPasswordDialog({ mode: 'verify', targetMode: 'Normal' });
                }
                // Same mode clicked: no action
                else if (mode.id !== settings.security_mode) {
                  patch(s => { s.security_mode = mode.id; return s; });
                }
              }}
              className={`p-3 rounded-lg border text-left transition-all ${settings.security_mode === mode.id ? `border-${mode.color}/40 bg-${mode.color}/5` : 'border-white/5 hover:border-white/10'}`}
            >
              <p className="text-sm font-semibold">{mode.label}</p>
              <p className="text-[11px] text-text-muted">{mode.desc}</p>
            </button>
          ))}
        </div>
      </Section>

      {/* Strict Mode Settings - only shown when strict mode is enabled */}
      {settings.security_mode === 'Strict' && settings.strict_settings && (
        <Section icon={Lock} title="Strict Mode Settings" desc="Enhanced security controls for strict mode">
          <Row label="Require Password for Settings Changes" desc="Prompt for password when changing any setting">
            <Toggle 
              on={settings.strict_settings.require_password_for_settings} 
              onChange={async () => {
                // This setting itself doesn't require password verification - it controls future changes
                if (!settings.strict_settings.require_password_for_settings) {
                  // Enabling - just enable it
                  patch(s => { 
                    if (s.strict_settings) {
                      s.strict_settings.require_password_for_settings = true;
                    }
                    return s;
                  });
                } else {
                  // Disabling - require password to turn off
                  setPasswordPrompt({
                    title: 'Disable Password Requirement',
                    description: 'Enter your Strict Mode password to disable password requirement for settings changes',
                    onConfirm: async (password) => {
                      const valid = await verifyStrictModePassword(password);
                      if (!valid) {
                        throw new Error('Incorrect password');
                      }
                      patch(s => { 
                        if (s.strict_settings) {
                          s.strict_settings.require_password_for_settings = false;
                        }
                        return s;
                      });
                      setPasswordPrompt(null);
                    },
                  });
                }
              }}
            />
          </Row>
          <Row label="Require Password for Protection Changes" desc="Prompt for password when changing protection settings">
            <Toggle 
              on={settings.strict_settings.require_password_for_protection_changes} 
              onChange={() => patchWithPasswordCheck(
                s => { 
                  if (s.strict_settings) {
                    s.strict_settings.require_password_for_protection_changes = !s.strict_settings.require_password_for_protection_changes;
                  }
                  return s;
                },
                'change this setting'
              )}
            />
          </Row>
          <Row label="Require Password for Scans" desc="Prompt for password when starting manual scans">
            <Toggle 
              on={settings.strict_settings.require_password_for_scans} 
              onChange={() => patchWithPasswordCheck(
                s => { 
                  if (s.strict_settings) {
                    s.strict_settings.require_password_for_scans = !s.strict_settings.require_password_for_scans;
                  }
                  return s;
                },
                'change this setting'
              )}
            />
          </Row>
          <Row label="Lock on Idle" desc="Automatically lock the app after period of inactivity">
            <Toggle 
              on={settings.strict_settings.lock_on_idle} 
              onChange={() => patchWithPasswordCheck(
                s => { 
                  if (s.strict_settings) {
                    s.strict_settings.lock_on_idle = !s.strict_settings.lock_on_idle;
                  }
                  return s;
                },
                'change this setting'
              )}
            />
          </Row>
          {settings.strict_settings.lock_on_idle && (
            <Row label="Idle Timeout" desc="Minutes of inactivity before auto-lock">
              <select
                value={settings.strict_settings.idle_timeout_minutes}
                onChange={async (e) => {
                  const newValue = parseInt(e.target.value);
                  await patchWithPasswordCheck(
                    s => { 
                      if (s.strict_settings) {
                        s.strict_settings.idle_timeout_minutes = newValue;
                      }
                      return s;
                    },
                    'change idle timeout'
                  );
                }}
                className="bg-bg-secondary border border-white/5 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent-primary/50"
              >
                {[1, 2, 5, 10, 15, 30].map(n => <option key={n} value={n}>{n} min</option>)}
              </select>
            </Row>
          )}
        </Section>
      )}

      {/* Protection - matches Rust ProtectionSettings */}
      <Section icon={Eye} title="Protection" desc="File monitoring and integrity checks">
        <Row label="Real-time File Monitoring" desc="Watch protected directories for changes">
          <Toggle 
            on={settings.protection.realtime_enabled} 
            onChange={async () => {
              if (settings.security_mode === 'Strict' && settings.strict_settings?.require_password_for_protection_changes) {
                await patchWithPasswordCheck(
                  s => { s.protection.realtime_enabled = !s.protection.realtime_enabled; return s; },
                  'change real-time monitoring'
                );
              } else {
                patch(s => { s.protection.realtime_enabled = !s.protection.realtime_enabled; return s; });
              }
            }}
          />
        </Row>
        <Row label="Baseline Lock" desc="Prevent baseline modifications without re-signing">
          <Toggle 
            on={settings.protection.baseline_locked} 
            onChange={async () => {
              if (settings.security_mode === 'Strict' && settings.strict_settings?.require_password_for_protection_changes) {
                await patchWithPasswordCheck(
                  s => { s.protection.baseline_locked = !s.protection.baseline_locked; return s; },
                  'change baseline lock'
                );
              } else {
                patch(s => { s.protection.baseline_locked = !s.protection.baseline_locked; return s; });
              }
            }}
          />
        </Row>
        <Row label="Quarantine on Tamper" desc="Move tampered files to quarantine automatically">
          <Toggle 
            on={settings.protection.quarantine_enabled} 
            onChange={async () => {
              if (settings.security_mode === 'Strict' && settings.strict_settings?.require_password_for_protection_changes) {
                await patchWithPasswordCheck(
                  s => { s.protection.quarantine_enabled = !s.protection.quarantine_enabled; return s; },
                  'change quarantine setting'
                );
              } else {
                patch(s => { s.protection.quarantine_enabled = !s.protection.quarantine_enabled; return s; });
              }
            }}
          />
        </Row>
      </Section>

      {/* Performance - matches Rust PerformanceSettings */}
      <Section icon={Cpu} title="Performance" desc="Resource allocation and optimization">
        <Row label="Max CPU %" desc="Maximum CPU percentage to use">
          <input type="number" min="5" max="100" value={settings.performance.max_cpu_percent}
            onChange={e => patch(s => { s.performance.max_cpu_percent = Number(e.target.value); return s; })}
            className="bg-bg-secondary border border-white/5 rounded-lg px-3 py-1.5 text-sm w-20 focus: outline-none focus:border-accent-primary/50"
          />
        </Row>
        <Row label="Max Memory (MB)" desc="Memory limit in megabytes">
          <input type="number" min="128" max="4096" step="128" value={settings.performance.max_memory_mb}
            onChange={e => patch(s => { s.performance.max_memory_mb = Number(e.target.value); return s; })}
            className="bg-bg-secondary border border-white/5 rounded-lg px-3 py-1.5 text-sm w-24 focus:outline-none focus:border-accent-primary/50"
          />
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
        <div className="grid grid-cols-2 gap-3 font-mono text-sm">
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

      {/* Password Dialog for Strict Mode */}
      {passwordDialog && (
        <StrictModePasswordDialog
          mode={passwordDialog.mode}
          title={
            passwordDialog.mode === 'create'
              ? 'Create Strict Mode Password'
              : 'Enter Strict Mode Password'
          }
          description={
            passwordDialog.mode === 'create'
              ? 'Create a password to protect Strict Mode. You\'ll need this password to unlock the app and disable Strict Mode.'
              : 'Enter your Strict Mode password to switch back to Normal mode.'
          }
          onConfirm={async (password) => {
            if (passwordDialog.mode === 'create') {
              // Creating password for Strict mode
              await setStrictModePassword(password);
              
              // Update settings and save immediately
              if (settings) {
                const updatedSettings = {
                  ...settings,
                  security_mode: 'Strict' as SecurityMode,
                  strict_settings: {
                    require_password_for_settings: true,
                    require_password_for_protection_changes: true,
                    require_password_for_scans: false,
                    lock_on_idle: false,
                    idle_timeout_minutes: 5,
                  }
                };
                setSettings(updatedSettings);
                await updateSettings(updatedSettings);
                setDirty(false);
                setSaved(true);
              }
              setPasswordDialog(null);
            } else {
              // Verifying password to disable Strict mode
              const valid = await verifyStrictModePassword(password);
              if (!valid) {
                throw new Error('Incorrect password');
              }
              clearStrictModePassword();
              
              // Update settings and save immediately
              if (settings) {
                const updatedSettings = {
                  ...settings,
                  security_mode: 'Normal' as SecurityMode,
                  strict_settings: undefined, // Clear strict settings when switching to Normal
                };
                setSettings(updatedSettings);
                await updateSettings(updatedSettings);
                setDirty(false);
                setSaved(true);
              }
              setPasswordDialog(null);
            }
          }}
          onCancel={() => setPasswordDialog(null)}
        />
      )}

      {passwordPrompt && (
        <StrictModePasswordDialog
          mode="verify"
          title={passwordPrompt.title}
          description={passwordPrompt.description}
          onConfirm={passwordPrompt.onConfirm}
          onCancel={() => setPasswordPrompt(null)}
        />
      )}
    </div>
  );
};

export default SettingsPage;
