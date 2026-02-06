export type SecurityMode = "Normal" | "Strict";

export interface GuardSettings {
  security_mode: SecurityMode;
  protection: {
    realtime_enabled: boolean;
    baseline_locked: boolean;
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
  };
}
