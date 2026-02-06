import React, { useEffect, useState } from 'react';
import { getSettings, updateSettings } from '../api';
import type { GuardSettings, SecurityMode } from '../state/settings';
import { useService } from '../state/service';

const SettingsPage: React.FC = () => {
  const { serviceAvailable } = useService();
  const [settings, setSettings] = useState<GuardSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((e) => setError(e?.toString?.() ?? 'Failed to load settings'));
  }, []);

  const save = async (next: GuardSettings) => {
    setSaving(true);
    setError(null);
    try {
      await updateSettings(next);
      setSettings(next);
    } catch (e: any) {
      setError(e?.toString?.() ?? 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const updateSecurityMode = (mode: SecurityMode) => {
    if (!settings) return;
    save({ ...settings, security_mode: mode });
  };

  const toggleRealtime = (enabled: boolean) => {
    if (!settings) return;
    save({
      ...settings,
      protection: { ...settings.protection, realtime_enabled: enabled },
    });
  };

  const toggleBaselineLocked = (locked: boolean) => {
    if (!settings) return;
    save({
      ...settings,
      protection: { ...settings.protection, baseline_locked: locked },
    });
  };

  const toggleTelemetry = (enabled: boolean) => {
    if (!settings) return;
    save({
      ...settings,
      privacy: { ...settings.privacy, telemetry_enabled: enabled },
    });
  };

  const toggleAutoUpdate = (enabled: boolean) => {
    if (!settings) return;
    save({
      ...settings,
      updates: { ...settings.updates, auto_update: enabled },
    });
  };

  const updateChannel = (channel: string) => {
    if (!settings) return;
    save({
      ...settings,
      updates: { ...settings.updates, channel },
    });
  };

  const updateMaxCpu = (value: number) => {
    if (!settings) return;
    save({
      ...settings,
      performance: { ...settings.performance, max_cpu_percent: value },
    });
  };

  const updateMaxMemory = (value: number) => {
    if (!settings) return;
    save({
      ...settings,
      performance: { ...settings.performance, max_memory_mb: value },
    });
  };

  const disabled = !serviceAvailable || saving || !settings;

  return (
    <div className="p-6 space-y-4">
      {!serviceAvailable && (
        <div className="bg-[rgba(239,68,68,0.1)] border border-semantic-error text-semantic-error rounded-lg p-3 text-sm">
          Service Unavailable. Settings are read-only.
        </div>
      )}
      {error && (
        <div className="bg-[rgba(239,68,68,0.08)] border border-semantic-error text-semantic-error rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      <div className="bg-bg-card border border-[rgba(148,163,184,0.1)] rounded-lg p-4 space-y-3">
        <div className="text-sm text-text-primary">Security Mode</div>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <button
            className={`px-3 py-1 rounded ${settings?.security_mode === 'Strict' ? 'bg-accent-primary text-black' : 'bg-bg-tertiary text-text-secondary'}`}
            disabled={disabled}
            onClick={() => updateSecurityMode('Strict')}
          >
            Strict (recommended)
          </button>
          <button
            className={`px-3 py-1 rounded ${settings?.security_mode === 'Normal' ? 'bg-accent-primary text-black' : 'bg-bg-tertiary text-text-secondary'}`}
            disabled={disabled}
            onClick={() => updateSecurityMode('Normal')}
          >
            Normal
          </button>
        </div>
      </div>

      <div className="bg-bg-card border border-[rgba(148,163,184,0.1)] rounded-lg p-4 space-y-3">
        <div className="text-sm text-text-primary">Protection</div>
        <label className="flex items-center gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            checked={!!settings?.protection.realtime_enabled}
            disabled={disabled}
            onChange={(e) => toggleRealtime(e.target.checked)}
          />
          Real-time protection
        </label>
        <label className="flex items-center gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            checked={!!settings?.protection.baseline_locked}
            disabled={disabled}
            onChange={(e) => toggleBaselineLocked(e.target.checked)}
          />
          Baseline locked
        </label>
      </div>

      <div className="bg-bg-card border border-[rgba(148,163,184,0.1)] rounded-lg p-4 space-y-3">
        <div className="text-sm text-text-primary">Updates</div>
        <label className="flex items-center gap-2 text-xs text-text-muted">
          Channel
          <select
            className="bg-bg-tertiary text-text-primary rounded px-2 py-1"
            disabled={disabled}
            value={settings?.updates.channel ?? 'stable'}
            onChange={(e) => updateChannel(e.target.value)}
          >
            <option value="stable">stable</option>
            <option value="beta">beta</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            checked={!!settings?.updates.auto_update}
            disabled={disabled}
            onChange={(e) => toggleAutoUpdate(e.target.checked)}
          />
          Auto-update
        </label>
      </div>

      <div className="bg-bg-card border border-[rgba(148,163,184,0.1)] rounded-lg p-4 space-y-3">
        <div className="text-sm text-text-primary">Performance</div>
        <label className="flex items-center gap-2 text-xs text-text-muted">
          Max CPU %
          <input
            type="number"
            className="bg-bg-tertiary text-text-primary rounded px-2 py-1 w-20"
            disabled={disabled}
            min={10}
            max={80}
            value={settings?.performance.max_cpu_percent ?? 30}
            onChange={(e) => updateMaxCpu(Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-text-muted">
          Max Memory (MB)
          <input
            type="number"
            className="bg-bg-tertiary text-text-primary rounded px-2 py-1 w-24"
            disabled={disabled}
            min={128}
            value={settings?.performance.max_memory_mb ?? 512}
            onChange={(e) => updateMaxMemory(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="bg-bg-card border border-[rgba(148,163,184,0.1)] rounded-lg p-4 space-y-3">
        <div className="text-sm text-text-primary">Privacy</div>
        <label className="flex items-center gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            checked={!!settings?.privacy.telemetry_enabled}
            disabled={disabled}
            onChange={(e) => toggleTelemetry(e.target.checked)}
          />
          Telemetry
        </label>
      </div>
    </div>
  );
};

export default SettingsPage;
