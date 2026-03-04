import { invoke } from '@tauri-apps/api/core';
import { DeviceState, EventEntry, ServiceStatus, UpdateInfo } from './types';

type StatusResponse = ServiceStatus;

type EventsResponse = {
  events: EventEntry[];
};

type UpdateCheckResponse = UpdateInfo;

type CapabilityResponse = {
  capabilities: ServiceStatus['capabilities'];
};

export async function fetchStatus(): Promise<StatusResponse> {
  return invoke<StatusResponse>('get_status');
}

export async function fetchCapabilities(): Promise<CapabilityResponse> {
  return invoke<CapabilityResponse>('get_capabilities');
}

export async function fetchEvents(): Promise<EventsResponse> {
  return invoke<EventsResponse>('get_events');
}

export async function fetchDeviceState(): Promise<DeviceState | { error: string }> {
  return invoke<DeviceState | { error: string }>('get_device_state');
}

export async function triggerScan(kind: 'quick' | 'full' | 'custom'): Promise<{ accepted: boolean }> {
  return invoke<{ accepted: boolean }>('trigger_scan', { kind });
}

export async function updateCheck(channel?: string): Promise<UpdateCheckResponse> {
  return invoke<UpdateCheckResponse>('update_check', { channel: channel || 'stable' });
}

export async function updateInstall(channel?: string): Promise<{ ok: boolean }> {
  return invoke<{ ok: boolean }>('update_install', { channel: channel || 'stable' });
}

export async function updateRollback(backupManifest: string): Promise<{ ok: boolean }> {
  return invoke<{ ok: boolean }>('update_rollback', { backupManifest });
}

export async function sendCrashReport(report: {
  type: string;
  description?: string;
  diagnostics?: string;
  stack_trace?: string;
  app_version?: string;
  platform?: string;
  error_code?: string;
}): Promise<{ ok: boolean }> {
  return invoke<{ ok: boolean }>('send_crash_report', { report });
}

export async function fetchSystemMetrics(): Promise<import('./types').SystemMetrics> {
  return invoke<import('./types').SystemMetrics>('get_system_metrics');
}
