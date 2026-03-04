export type ServiceMode = 'normal' | 'zerotrust' | 'safemode' | 'disconnected';
export type SafeModeReason = 'MANUAL' | 'VAULT_CORRUPT' | 'CRYPTO_ERROR' | 'SERVICE_CRASH_LOOP' | 'INTEGRITY_FAILURE' | 'IPC_FAILURE' | 'REMOTE_COMMAND' | 'UNKNOWN';

export type CapabilityMap = {
  updates: boolean;
  events: boolean;
  scans: boolean;
  deviceControl: boolean;
  connectedMode: boolean;
};

export type ServiceStatus = {
  ok: boolean;
  mode: ServiceMode;
  connected: boolean;
  safeModeReason?: SafeModeReason | string;
  version?: string;
  vaultLocked?: boolean;
  capabilities: CapabilityMap;
};

export type EventEntry = {
  event_type: string;
  severity: string;
  timestamp: string;
  data?: Record<string, unknown>;
  detail?: string;
  seq?: number;
  hash?: string;
};

export type UpdateInfo = {
  available: boolean;
  version?: string;
  backupManifest?: string;
  notes?: string;
};

export type RemoteActivityStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REJECTED';
export type UpdateChannel = 'stable' | 'beta';

export type DeviceState = {
  connected: boolean;
  lastHeartbeat?: string;
  deviceId?: string;
  securityProfile?: 'NORMAL' | 'ZERO_TRUST';
  remoteActivity?: {
    command: string;
    timestamp: string;
    status: RemoteActivityStatus;
  } | null;
  updates?: {
    installedVersion: string;
    channel: UpdateChannel;
    updateAvailable: boolean;
  } | null;
  safeMode?: boolean;
  safeModeReason?: string;
  error?: string;
};

export type SystemMetrics = {
  cpu_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  memory_percent: number;
};
