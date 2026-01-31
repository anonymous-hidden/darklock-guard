import React from 'react';
import { useService } from '../state/service';

const SettingsPage: React.FC = () => {
  const { serviceAvailable } = useService();
  return (
    <div className="p-6 space-y-4">
      {!serviceAvailable && (
        <div className="bg-[rgba(239,68,68,0.1)] border border-semantic-error text-semantic-error rounded-lg p-3 text-sm">
          Service Unavailable. Settings are read-only.
        </div>
      )}
      <div className="bg-bg-card border border-[rgba(148,163,184,0.1)] rounded-lg p-4 space-y-2">
        <div className="text-sm text-text-primary">Appearance</div>
        <div className="text-xs text-text-muted">Theme selection will be wired when supported.</div>
      </div>
      <div className="bg-bg-card border border-[rgba(148,163,184,0.1)] rounded-lg p-4 space-y-2">
        <div className="text-sm text-text-primary">Advanced</div>
        <div className="text-xs text-text-muted">IPC path, log rotation, and debug toggles will be surfaced once the service exposes them.</div>
      </div>
    </div>
  );
};

export default SettingsPage;
