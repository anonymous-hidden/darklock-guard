import React from 'react';
import { ServiceStatus } from '../types';
import { Circle } from 'lucide-react';

export const StatusBadge: React.FC<{ status: ServiceStatus | null; serviceAvailable: boolean }> = ({ status, serviceAvailable }) => {
  if (!serviceAvailable) {
    return (
      <div className="flex items-center gap-2 text-text-muted text-sm" title="Service Unavailable">
        <Circle className="text-text-muted" size={14} /> Service Unavailable
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-text-secondary text-sm">
        <Circle className="text-text-secondary" size={14} /> Loading...
      </div>
    );
  }

  const isRemoteSafeMode = status.mode === 'safemode' && status.safeModeReason === 'REMOTE_COMMAND';

  const modeLabel =
    status.mode === 'zerotrust'
      ? 'Zero-Trust Mode'
      : status.mode === 'safemode'
      ? isRemoteSafeMode
        ? 'Safe Mode (Remote)'
        : 'Safe Mode'
      : status.mode === 'disconnected'
      ? 'Disconnected'
      : 'Protected';

  const color =
    status.mode === 'zerotrust'
      ? 'text-state-zerotrust'
      : status.mode === 'safemode'
      ? isRemoteSafeMode
        ? 'text-orange-400'
        : 'text-state-safemode'
      : status.mode === 'disconnected'
      ? 'text-state-disconnected'
      : 'text-accent-primary';

  return (
    <div className={`flex items-center gap-2 text-sm font-medium ${color}`}>
      <Circle className={color} size={14} /> {modeLabel}
    </div>
  );
};
