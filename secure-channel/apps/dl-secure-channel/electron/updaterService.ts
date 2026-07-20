import { app, BrowserWindow, net, powerMonitor } from 'electron';
import electronUpdater from 'electron-updater';
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';
import { verifyDownloadedArtifact } from './updateArtifactVerification.js';
import { assertFrameworkManifestBinding, FRAMEWORK_FEED_URL } from './updateManifestBinding.js';
import { validateSignedUpdatePolicy, UpdatePolicyError } from './updatePolicy.js';
import { canTransitionUpdateState } from './updateStateMachine.js';
import {
  APPROVED_UPDATE_HOSTS,
  RIDGELINE_RECOVERY_KEY_IDS,
  RIDGELINE_REVOKED_KEY_IDS,
  RIDGELINE_UPDATE_KEYS,
} from './updateTrust.js';
import type {
  AvailableUpdate,
  RestartSafety,
  SignedUpdateEnvelope,
  SignedUpdatePolicy,
  UpdateChannel,
  UpdatePhase,
  UpdateSnapshot,
} from './updateTypes.js';

const POLICY_ENDPOINT = 'https://cayden.tail333b18.ts.net/ridgeline/policy/latest?app=ridgeline&format=signed-v1';
const TELEMETRY_ENDPOINT = 'https://cayden.tail333b18.ts.net/ridgeline/telemetry';
const CHECK_INTERVAL_MS = 8 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 12_000;
const MAX_POLICY_BYTES = 256 * 1024;
const { autoUpdater } = electronUpdater;

interface PersistedUpdaterState {
  installationId: string;
  highestAcceptedVersion: string | null;
  highestAcceptedPolicyHash: string | null;
  highestAcceptedMetadataSequence: number | null;
  pendingInstall: { update: AvailableUpdate; policyHash: string } | null;
  verifiedHistory: AvailableUpdate[];
  lastSeenMajorReleaseNotesVersion: string | null;
}

function initialSnapshot(channel: UpdateChannel): UpdateSnapshot {
  return {
    phase: 'idle',
    currentVersion: app.getVersion(),
    channel,
    lastCheckedAt: null,
    available: null,
    progressPercent: null,
    bytesPerSecond: null,
    errorCode: null,
    restartBlockedReason: null,
  };
}

function releaseChannel(): UpdateChannel {
  const version = app.getVersion();
  if (version.includes('-beta.')) return 'beta';
  if (version.includes('-dev.')) return 'development';
  return 'stable';
}

function availableUpdate(policy: SignedUpdatePolicy, mandatory: boolean): AvailableUpdate {
  return {
    version: policy.version,
    channel: policy.channel,
    classification: policy.classification,
    urgency: policy.urgency,
    mandatory,
    publishedAt: policy.publishedAt,
    releaseNotes: policy.releaseNotes,
  };
}

function defaultPersistedState(): PersistedUpdaterState {
  return {
    installationId: randomUUID(),
    highestAcceptedVersion: null,
    highestAcceptedPolicyHash: null,
    highestAcceptedMetadataSequence: null,
    pendingInstall: null,
    verifiedHistory: [],
    lastSeenMajorReleaseNotesVersion: null,
  };
}

export class RidgelineUpdaterService {
  private readonly updater: AppUpdater;
  private snapshot: UpdateSnapshot;
  private persisted: PersistedUpdaterState;
  private readonly statePath: string;
  private readonly eventLogPath: string;
  private checkPromise: Promise<UpdateSnapshot> | null = null;
  private interval: NodeJS.Timeout | null = null;
  private suspended = false;
  private started = false;
  private restartSafety: RestartSafety = { activeCall: false, activeTransfer: false, unsavedDraft: false };

  constructor(private readonly getWindows: () => BrowserWindow[]) {
    this.updater = autoUpdater;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = true;
    this.updater.allowDowngrade = false;
    this.updater.allowPrerelease = releaseChannel() !== 'stable';
    // electron-updater's default stable manifest is `latest.yml`; the product
    // release channel remains `stable` in the signed policy and user-facing UI.
    this.updater.channel = releaseChannel() === 'stable' ? 'latest' : releaseChannel();
    this.updater.setFeedURL({ provider: 'generic', url: FRAMEWORK_FEED_URL });
    this.snapshot = initialSnapshot(releaseChannel());
    this.statePath = path.join(app.getPath('userData'), 'updater-state.json');
    this.eventLogPath = path.join(app.getPath('userData'), 'updater-events.log');
    this.persisted = this.loadPersistedState();
    this.registerUpdaterEvents();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.detectCompletedInstall();
    powerMonitor.on('suspend', () => { this.suspended = true; });
    powerMonitor.on('resume', () => { this.suspended = false; });
    this.interval = setInterval(() => {
      if (!this.suspended && net.isOnline()) void this.check('interval');
    }, CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  getSnapshot(): UpdateSnapshot {
    return structuredClone(this.snapshot);
  }

  getHistory(): AvailableUpdate[] {
    return structuredClone(this.persisted.verifiedHistory);
  }

  getPendingMajorReleaseNotes(): AvailableUpdate | null {
    const pending = this.persisted.pendingInstall?.update;
    if (!pending || pending.classification !== 'major') return null;
    if (pending.version !== app.getVersion()) return null;
    if (this.persisted.lastSeenMajorReleaseNotesVersion === pending.version) return null;
    return structuredClone(pending);
  }

  markMajorReleaseNotesSeen(version: unknown): void {
    if (typeof version !== 'string' || version !== app.getVersion()) return;
    const pending = this.getPendingMajorReleaseNotes();
    if (!pending || pending.version !== version) return;
    this.persisted.lastSeenMajorReleaseNotesVersion = version;
    this.persisted.pendingInstall = null;
    this.savePersistedState();
    this.logEvent('release_notes_dismissed', version);
    this.broadcast();
  }

  recordReleaseNotesOpened(version: unknown): void {
    if (typeof version !== 'string') return;
    const known = this.snapshot.available?.version === version
      || this.persisted.verifiedHistory.some(update => update.version === version);
    if (known) this.logEvent('release_notes_opened', version);
  }

  setRestartSafety(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const input = value as Partial<RestartSafety>;
    this.restartSafety = {
      activeCall: input.activeCall === true,
      activeTransfer: input.activeTransfer === true,
      unsavedDraft: input.unsavedDraft === true,
    };
  }

  async check(reason: 'startup' | 'manual' | 'interval'): Promise<UpdateSnapshot> {
    if (this.checkPromise) return this.checkPromise;
    this.checkPromise = this.performCheck(reason).finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  }

  defer(): UpdateSnapshot {
    if (this.snapshot.phase === 'restart_required' || this.snapshot.phase === 'update_available') {
      this.transition('deferred');
    }
    return this.getSnapshot();
  }

  restartAndInstall(): UpdateSnapshot {
    if (!['staged', 'restart_required', 'deferred', 'blocked'].includes(this.snapshot.phase)) return this.getSnapshot();
    const blockedReason = this.getRestartBlockedReason();
    if (blockedReason) {
      this.snapshot.restartBlockedReason = blockedReason;
      this.broadcast();
      return this.getSnapshot();
    }
    this.transition('installing', { restartBlockedReason: null });
    this.logEvent('restart_requested', this.snapshot.available?.version);
    setImmediate(() => this.updater.quitAndInstall(false, true));
    return this.getSnapshot();
  }

  private async performCheck(reason: string): Promise<UpdateSnapshot> {
    if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) {
      this.transition('checking', { errorCode: null });
      this.transition('no_update', { lastCheckedAt: new Date().toISOString(), errorCode: null });
      return this.getSnapshot();
    }
    if (this.suspended || !net.isOnline()) return this.getSnapshot();
    this.transition('checking', { errorCode: null, progressPercent: null, bytesPerSecond: null });
    this.logEvent('check_started', reason);
    try {
      const response = await fetch(`${POLICY_ENDPOINT}&channel=${encodeURIComponent(this.snapshot.channel)}`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        headers: { Accept: 'application/json' },
      });
      if (response.status >= 300 && response.status < 400) throw new Error('redirect_rejected');
      if (!response.ok) throw new Error(`http_${response.status}`);
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_POLICY_BYTES) throw new Error('metadata_too_large');
      const parsed = JSON.parse(raw) as SignedUpdateEnvelope | { available: false };
      const checkedAt = new Date().toISOString();
      if ('available' in parsed && parsed.available === false) {
        this.transition('no_update', { lastCheckedAt: checkedAt, available: null });
        this.logEvent('no_update');
        return this.getSnapshot();
      }

      const validated = validateSignedUpdatePolicy(parsed as SignedUpdateEnvelope, {
        currentVersion: app.getVersion(),
        channel: this.snapshot.channel,
        platform: process.platform,
        arch: process.arch,
        installationId: this.persisted.installationId,
        nowMs: Date.now(),
        trustedKeys: RIDGELINE_UPDATE_KEYS,
        revokedKeyIds: RIDGELINE_REVOKED_KEY_IDS,
        recoveryKeyIds: RIDGELINE_RECOVERY_KEY_IDS,
        approvedHosts: APPROVED_UPDATE_HOSTS,
        highestAcceptedVersion: this.persisted.highestAcceptedVersion,
        highestAcceptedPolicyHash: this.persisted.highestAcceptedPolicyHash,
        highestAcceptedMetadataSequence: this.persisted.highestAcceptedMetadataSequence,
      });
      const update = availableUpdate(validated.policy, validated.mandatory);
      this.logEvent('check_succeeded', update.version);
      this.persisted.highestAcceptedVersion = validated.policy.version;
      this.persisted.highestAcceptedPolicyHash = validated.policyHash;
      this.persisted.highestAcceptedMetadataSequence = validated.policy.metadataSequence;
      this.savePersistedState();
      this.transition('update_available', { lastCheckedAt: checkedAt, available: update });
      this.logEvent('update_available', update.version);

      await this.rejectArtifactRedirects(validated.artifact.url);

      const result = await this.updater.checkForUpdates();
      if (!result) throw new Error('updater_manifest_missing');
      assertFrameworkManifestBinding(result.updateInfo as UpdateInfo, validated.policy, validated.artifact);
      this.transition('downloading');
      this.logEvent('download_started', update.version);
      const downloadedFiles = await this.updater.downloadUpdate();
      const downloadedFile = downloadedFiles.find(file => path.basename(file) === path.basename(new URL(validated.artifact.url).pathname))
        ?? downloadedFiles[0];
      if (!downloadedFile || !existsSync(downloadedFile)) throw new Error('download_missing');
      this.transition('verifying');
      const verification = await verifyDownloadedArtifact(downloadedFile, validated.artifact.size, validated.artifact.sha256);
      if (verification !== 'verified') {
        try { unlinkSync(downloadedFile); } catch { /* best-effort cache cleanup */ }
        throw new Error(verification);
      }
      this.logEvent('download_completed', update.version);
      this.persisted.pendingInstall = { update, policyHash: validated.policyHash };
      this.persisted.verifiedHistory = [update, ...this.persisted.verifiedHistory.filter(item => item.version !== update.version)].slice(0, 20);
      this.savePersistedState();
      this.transition('staged', { progressPercent: 100, bytesPerSecond: null });
      this.logEvent('update_staged', update.version);
      if (update.classification === 'major' || update.mandatory) this.transition(update.mandatory ? 'blocked' : 'restart_required');
      return this.getSnapshot();
    } catch (error) {
      if (error instanceof UpdatePolicyError && error.code === 'downgrade_or_current') {
        this.transition('no_update', {
          lastCheckedAt: new Date().toISOString(),
          available: null,
          errorCode: null,
        });
        this.logEvent('no_update');
        return this.getSnapshot();
      }
      const code = error instanceof UpdatePolicyError ? error.code : this.safeErrorCode(error);
      this.transition(code === 'revoked_release' ? 'blocked' : 'failed', {
        lastCheckedAt: new Date().toISOString(),
        errorCode: code,
      });
      this.logEvent(error instanceof UpdatePolicyError ? 'verification_failed' : 'check_failed', code);
      return this.getSnapshot();
    }
  }

  private registerUpdaterEvents(): void {
    this.updater.on('download-progress', (progress: ProgressInfo) => {
      if (this.snapshot.phase !== 'downloading') return;
      this.snapshot.progressPercent = Math.max(0, Math.min(100, progress.percent));
      this.snapshot.bytesPerSecond = progress.bytesPerSecond;
      this.broadcast();
    });
    this.updater.on('error', error => {
      if (this.snapshot.phase === 'idle' || this.snapshot.phase === 'no_update') return;
      this.logEvent('installation_failed', this.safeErrorCode(error));
    });
  }

  private async rejectArtifactRedirects(url: string): Promise<void> {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      headers: { Range: 'bytes=0-0', Accept: 'application/octet-stream' },
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error('redirect_rejected');
    }
    if (!response.ok && response.status !== 206) {
      await response.body?.cancel();
      throw new Error(`http_${response.status}`);
    }
    await response.body?.cancel();
  }

  private detectCompletedInstall(): void {
    const pending = this.persisted.pendingInstall?.update;
    if (!pending || pending.version !== app.getVersion()) return;
    this.transition('completed', { available: pending, progressPercent: 100 });
    this.logEvent('installation_succeeded', pending.version);
    if (pending.classification !== 'major') {
      this.persisted.pendingInstall = null;
      this.savePersistedState();
    }
  }

  private transition(phase: UpdatePhase, patch: Partial<UpdateSnapshot> = {}): void {
    if (!canTransitionUpdateState(this.snapshot.phase, phase)) {
      throw new Error(`invalid_update_transition:${this.snapshot.phase}:${phase}`);
    }
    this.snapshot = { ...this.snapshot, ...patch, phase };
    this.broadcast();
  }

  private broadcast(): void {
    const payload = this.getSnapshot();
    for (const window of this.getWindows()) {
      if (!window.isDestroyed()) window.webContents.send('updater:state', payload);
    }
  }

  private getRestartBlockedReason(): string | null {
    if (this.restartSafety.activeCall) return 'End the active call before restarting.';
    if (this.restartSafety.activeTransfer) return 'Wait for the active file transfer before restarting.';
    if (this.restartSafety.unsavedDraft) return 'Send or clear your message draft before restarting.';
    return null;
  }

  private loadPersistedState(): PersistedUpdaterState {
    try {
      const parsed = JSON.parse(readFileSync(this.statePath, 'utf8')) as Partial<PersistedUpdaterState>;
      return {
        ...defaultPersistedState(),
        ...parsed,
        installationId: typeof parsed.installationId === 'string' ? parsed.installationId : randomUUID(),
        verifiedHistory: Array.isArray(parsed.verifiedHistory) ? parsed.verifiedHistory.slice(0, 20) : [],
      };
    } catch {
      return defaultPersistedState();
    }
  }

  private savePersistedState(): void {
    const tempPath = `${this.statePath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(this.persisted), { encoding: 'utf8', mode: 0o600 });
    renameSync(tempPath, this.statePath);
  }

  private logEvent(event: string, detail?: string): void {
    const safeDetail = detail ? String(detail).replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 120) : null;
    const line = `${JSON.stringify({ at: new Date().toISOString(), event, detail: safeDetail })}\n`;
    try {
      writeFileSync(this.eventLogPath, line, { encoding: 'utf8', flag: 'a', mode: 0o600 });
    } catch { /* telemetry never blocks updates */ }
    void this.publishTelemetry(event, safeDetail);
  }

  private async publishTelemetry(event: string, detail: string | null): Promise<void> {
    const allowed = new Set([
      'check_started', 'check_succeeded', 'no_update', 'update_available', 'download_started',
      'download_completed', 'verification_failed', 'update_staged', 'restart_requested',
      'installation_succeeded', 'installation_failed', 'release_notes_opened', 'release_notes_dismissed',
    ]);
    if (!allowed.has(event) || !app.isPackaged) return;
    const errorCode = event === 'verification_failed' || event === 'installation_failed' ? detail : null;
    try {
      await fetch(TELEMETRY_ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: this.snapshot.available?.version ?? app.getVersion(),
          event,
          errorCode,
          platform: process.platform,
          architecture: process.arch,
        }),
      });
    } catch { /* telemetry never blocks updates */ }
  }

  private safeErrorCode(error: unknown): string {
    const message = error instanceof Error ? error.message : 'update_failed';
    if (/timeout/i.test(message)) return 'timeout';
    if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|network/i.test(message)) return 'network_unavailable';
    if (/ENOSPC|disk space/i.test(message)) return 'insufficient_disk_space';
    if (/EACCES|EPERM|permission/i.test(message)) return 'permission_failure';
    if (/INVALID_SIGNATURE|not signed by the application owner/i.test(message)) return 'invalid_signature';
    if (/hash_mismatch/.test(message)) return 'artifact_hash_mismatch';
    if (/size_mismatch/.test(message)) return 'artifact_size_mismatch';
    if (/manifest_mismatch/.test(message)) return 'updater_manifest_mismatch';
    if (/redirect_rejected/.test(message)) return 'unapproved_redirect';
    if (/^http_429/.test(message)) return 'rate_limited';
    if (/^http_5/.test(message)) return 'server_error';
    if (/^http_404|CHANNEL_FILE_NOT_FOUND|Cannot find channel/i.test(message)) return 'metadata_not_found';
    if (/JSON/.test(message)) return 'invalid_json';
    return 'update_failed';
  }
}
