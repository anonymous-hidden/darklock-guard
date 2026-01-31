import React from 'react';
import { useService } from '../state/service';

const Section: React.FC<React.PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <div className="bg-bg-card border border-[rgba(148,163,184,0.1)] rounded-lg p-4 space-y-3">
    <div className="text-sm text-text-muted uppercase tracking-wide">{title}</div>
    {children}
  </div>
);

const ProtectionPage: React.FC = () => {
  const { serviceAvailable, status } = useService();

  if (!serviceAvailable) {
    return (
      <div className="p-6">
        <div className="bg-[rgba(239,68,68,0.1)] border border-semantic-error text-semantic-error rounded-lg p-4">
          Service Unavailable. Protection settings cannot be changed.
        </div>
      </div>
    );
  }

  const isSafeMode = status?.mode === 'safemode';
  const isRemoteSafeMode = isSafeMode && status?.safeModeReason === 'REMOTE_COMMAND';

  if (isSafeMode) {
    return (
      <div className="p-6 space-y-4">
        <div className={`rounded-lg p-4 ${isRemoteSafeMode ? 'bg-[rgba(249,115,22,0.15)] border border-orange-500/50' : 'bg-[rgba(245,158,11,0.1)] border border-semantic-warning'}`}>
          <div className="flex items-center gap-2">
            <span className="text-xl">⚠️</span>
            <span className={`font-semibold ${isRemoteSafeMode ? 'text-orange-400' : 'text-semantic-warning'}`}>
              Safe Mode Active {isRemoteSafeMode && '(Remote)'}
            </span>
          </div>
          <div className="text-sm text-text-secondary mt-1">
            Protection settings are read-only until safe mode is exited locally.
            {isRemoteSafeMode && ' This was triggered by a remote admin command.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <Section title="Vault Status">
        <div className="flex items-center gap-3 text-sm text-text-secondary">
          <span className="font-semibold text-text-primary">Vault</span>
          <span className="text-semantic-success">Unlocked</span>
        </div>
        <div className="text-xs text-text-muted">Lock/Unlock actions will appear when service exposes vault controls.</div>
      </Section>
      <Section title="Security Profile">
        <div className="text-text-primary text-sm">{status?.mode === 'zerotrust' ? 'Zero-Trust' : 'Standard'}</div>
        <div className="text-xs text-text-muted">Profile switching will be enabled when supported by the service.</div>
      </Section>
      <Section title="Auto-Lock Settings">
        <div className="text-xs text-text-muted">Auto-lock configuration is not yet exposed by the service.</div>
      </Section>
      <Section title="Device Binding">
        <div className="text-xs text-text-muted">Device binding info will appear once provided by the service.</div>
      </Section>
    </div>
  );
};

export default ProtectionPage;
