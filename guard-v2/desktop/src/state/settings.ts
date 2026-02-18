export type SecurityMode = "Normal" | "Strict";

export interface StrictModeSettings {
  require_password_for_settings: boolean;
  require_password_for_protection_changes: boolean;
  require_password_for_scans: boolean;
  lock_on_idle: boolean;
  idle_timeout_minutes: number;
}

export interface GuardSettings {
  security_mode: SecurityMode;
  strict_settings?: StrictModeSettings;
  protection: {
    realtime_enabled: boolean;
    baseline_locked: boolean;
    protected_paths: string[];
    quarantine_enabled: boolean;
  };
  performance: {
    max_cpu_percent: number;
    max_memory_mb: number;
  };
  updates: {
    channel: string;
    auto_update: boolean;
  };
  privacy: {
    telemetry_enabled: boolean;
    crash_reports: boolean;
  };
}
