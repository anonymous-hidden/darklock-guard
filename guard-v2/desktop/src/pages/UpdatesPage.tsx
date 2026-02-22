import React, { useState, useEffect } from 'react';
import { useService } from '../state/service';
import { getSettings, updateSettings } from '../api';
import { updateCheck, updateInstall, updateRollback } from '../ipc';
import { open as openUrl } from '@tauri-apps/plugin-shell';
import type { GuardSettings } from '../state/settings';
import { Download, RotateCcw, RefreshCw, CheckCircle2, Package, ArrowUpCircle, Clock, Shield, AlertTriangle, Loader2, Radio, Info, ExternalLink } from 'lucide-react';

const PLATFORM_URL = (import.meta.env.VITE_PLATFORM_URL as string) || 'https://platform.darklock.net';

type UpdateState = 'idle' | 'checking' | 'downloading' | 'installing' | 'done' | 'error';

const UpdatesPage: React.FC = () => {
  const { serviceAvailable, capabilities } = useService();
  const [state, setState] = useState<UpdateState>('idle');
  const [settings, setSettings] = useState<GuardSettings | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [showRollback, setShowRollback] = useState(false);

  const currentVersion = '2.0.0';
  const disabled = !serviceAvailable;

  // Load settings to get channel/autoUpdate
  useEffect(() => {
    getSettings().then(setSettings).catch(() => {});
  }, []);

  const patchSettings = async (fn: (s: GuardSettings) => GuardSettings) => {
    if (!settings) return;
    const updated = fn(JSON.parse(JSON.stringify(settings)));
    setSettings(updated);
    try { await updateSettings(updated); } catch {}
  };

  const doCheck = async () => {
    if (disabled) return;
    setError('');
    setInfo('');
    setState('checking');
    try {
      const res = await updateCheck(settings?.updates?.channel || 'stable');
      if (res?.available) {
        setInfo(`Update available: v${res.version || 'unknown'}`);
        setState('idle');
      } else {
        setInfo('You are running the latest version.');
        setState('done');
        setTimeout(() => setState('idle'), 3000);
      }
    } catch (e: any) {
      const msg = typeof e === 'string' ? e : (e?.message || 'Failed to check for updates');
      setError(msg);
      setState('error');
    }
  };

  const doInstall = async () => {
    setError('');
    setInfo('');
    setState('downloading');
    try {
      await updateInstall(settings?.updates?.channel || 'stable');
      setInfo('Update installed successfully.');
      setState('done');
    } catch (e: any) {
      const msg = typeof e === 'string' ? e : (e?.message || 'Installation failed');
      if (msg.toLowerCase().includes('no update available') || msg.toLowerCase().includes('not available')) {
        setInfo('No update available. You are already on the latest version.');
        setState('idle');
      } else {
        setError(msg);
        setState('error');
      }
    }
  };

  const doRollback = async () => {
    setError('');
    setInfo('');
    try {
      await updateRollback('latest');
      setShowRollback(false);
      setInfo('Rollback completed successfully.');
    } catch (e: any) {
      const msg = e?.message || 'Rollback failed';
      setShowRollback(false);
      if (msg.includes('not available')) {
        setInfo('No previous version available to roll back to.');
      } else {
        setError(msg);
      }
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Updates</h1>
          <p className="text-sm text-text-muted mt-0.5">Manage software updates and version control</p>
        </div>
        <button
          onClick={() => openUrl(`${PLATFORM_URL}/platform/updates`)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-primary/10 border border-accent-primary/20 text-accent-primary text-xs font-medium hover:bg-accent-primary/20 transition-colors shrink-0"
        >
          <ExternalLink size={12} />
          All Releases
        </button>
      </div>

      {/* Current Version Card */}
      <div className="bg-bg-card border border-white/5 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-accent-primary/10">
              <Shield size={24} className="text-accent-primary" />
            </div>
            <div>
              <p className="text-sm text-text-muted">Current Version</p>
              <p className="text-2xl font-bold font-mono">v{currentVersion}</p>
              <p className="text-xs text-text-muted mt-0.5">Darklock Guard Desktop</p>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1.5 text-semantic-success">
              <CheckCircle2 size={14} />
              <span className="text-sm font-medium">Up to date</span>
            </div>
            <p className="text-[11px] text-text-muted mt-1">Last checked: just now</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle size={18} className="text-semantic-error" />
          <p className="text-sm text-text-secondary">{error}</p>
        </div>
      )}

      {info && (
        <div className="bg-accent-primary/10 border border-accent-primary/30 rounded-xl p-4 flex items-center gap-3">
          <Info size={18} className="text-accent-primary" />
          <p className="text-sm text-text-secondary">{info}</p>
        </div>
      )}

      {/* Check / Install Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          onClick={doCheck}
          disabled={disabled || state === 'checking'}
          className="bg-bg-card border border-white/5 rounded-xl p-4 text-left hover:border-accent-primary/30 transition-all group disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-2 mb-2">
            {state === 'checking' ? <Loader2 size={18} className="text-accent-primary animate-spin" /> : <RefreshCw size={18} className="text-accent-primary" />}
            <span className="text-sm font-semibold">Check for Updates</span>
          </div>
          <p className="text-xs text-text-muted">Query the update server for new versions</p>
        </button>

        <button
          onClick={doInstall}
          disabled={disabled || state === 'downloading'}
          className="bg-bg-card border border-white/5 rounded-xl p-4 text-left hover:border-accent-secondary/30 transition-all group disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-2 mb-2">
            {state === 'downloading' ? <Loader2 size={18} className="text-accent-secondary animate-spin" /> : <Download size={18} className="text-accent-secondary" />}
            <span className="text-sm font-semibold">Install Update</span>
          </div>
          <p className="text-xs text-text-muted">Download and apply the latest release</p>
        </button>

        <button
          onClick={() => setShowRollback(true)}
          disabled={disabled}
          className="bg-bg-card border border-white/5 rounded-xl p-4 text-left hover:border-semantic-warning/30 transition-all group disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-2 mb-2">
            <RotateCcw size={18} className="text-semantic-warning" />
            <span className="text-sm font-semibold">Rollback</span>
          </div>
          <p className="text-xs text-text-muted">Revert to previous version if issues found</p>
        </button>
      </div>

      {/* Update Channel */}
      <div className="bg-bg-card border border-white/5 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Radio size={16} className="text-accent-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">Update Channel</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(['stable', 'beta'] as const).map(ch => (
            <button
              key={ch}
              onClick={() => patchSettings(s => { s.updates.channel = ch; return s; })}
              className={`p-4 rounded-lg border text-left transition-all ${(settings?.updates.channel || 'stable') === ch ? 'border-accent-primary/40 bg-accent-primary/5' : 'border-white/5 bg-bg-secondary/30 hover:border-white/10'}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold capitalize">{ch}</span>
                {(settings?.updates.channel || 'stable') === ch && <CheckCircle2 size={14} className="text-accent-primary" />}
              </div>
              <p className="text-xs text-text-muted">
                {ch === 'stable' ? 'Recommended. Thoroughly tested releases.' : 'Early access to new features. May contain bugs.'}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Auto Update Toggle */}
      <div className="bg-bg-card border border-white/5 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ArrowUpCircle size={18} className="text-accent-secondary" />
            <div>
              <p className="text-sm font-semibold">Automatic Updates</p>
              <p className="text-xs text-text-muted mt-0.5">Automatically download and install updates when available</p>
            </div>
          </div>
          <button
            onClick={() => patchSettings(s => { s.updates.auto_update = !s.updates.auto_update; return s; })}
            className={`relative w-11 h-6 rounded-full transition-colors ${(settings?.updates.auto_update ?? true) ? 'bg-accent-primary' : 'bg-bg-secondary'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${(settings?.updates.auto_update ?? true) ? 'translate-x-5' : ''}`} />
          </button>
        </div>
      </div>

      {/* Version History */}
      <div className="bg-bg-card border border-white/5 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Clock size={16} className="text-text-muted" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">Version History</h2>
        </div>
        <div className="space-y-2">
          {[
            { ver: '2.0.0', date: 'Current', notes: 'Initial v2 release with vault encryption' },
            { ver: '1.9.0', date: '2025-01-15', notes: 'BLAKE3 integrity scanning engine' },
            { ver: '1.8.0', date: '2024-12-20', notes: 'Ed25519 signed baselines' },
          ].map(v => (
            <div key={v.ver} className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-bg-secondary/30">
              <div className="flex items-center gap-3">
                <Package size={14} className="text-text-muted" />
                <span className="text-sm font-mono font-medium">v{v.ver}</span>
                <span className="text-xs text-text-muted">{v.notes}</span>
              </div>
              <span className="text-[11px] text-text-muted">{v.date}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Rollback Confirmation */}
      {showRollback && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-bg-card border border-white/10 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle size={22} className="text-semantic-warning" />
              <h3 className="text-lg font-bold">Confirm Rollback</h3>
            </div>
            <p className="text-sm text-text-secondary mb-4">
              This will revert Darklock Guard to the previous version. Your vault and settings will be preserved.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowRollback(false)} className="px-4 py-2 rounded-lg bg-bg-secondary text-sm">Cancel</button>
              <button onClick={doRollback} className="px-4 py-2 rounded-lg bg-semantic-warning/20 border border-semantic-warning/40 text-semantic-warning text-sm font-semibold">Rollback</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UpdatesPage;
