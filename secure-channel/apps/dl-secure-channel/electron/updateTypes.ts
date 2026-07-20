export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'update_available'
  | 'downloading'
  | 'verifying'
  | 'staged'
  | 'restart_required'
  | 'installing'
  | 'completed'
  | 'no_update'
  | 'deferred'
  | 'failed'
  | 'blocked';

export type UpdateClassification = 'patch' | 'minor' | 'major' | 'security' | 'hotfix';
export type UpdateUrgency = 'recommended' | 'required' | 'emergency';
export type UpdateChannel = 'stable' | 'beta' | 'enterprise-preview' | 'development';

export interface StructuredReleaseNotes {
  title: string;
  summary: string;
  highlights: string[];
  fixes: string[];
  security: string[];
}

export interface SignedUpdateArtifact {
  platform: NodeJS.Platform;
  arch: string;
  installerType: 'nsis' | 'zip' | 'appimage' | 'deb' | 'rpm';
  url: string;
  size: number;
  sha256: string;
  sha512: string;
}

export interface SignedUpdatePolicy {
  schemaVersion: 1;
  keyId: string;
  releaseId: string;
  metadataSequence: number;
  app: 'ridgeline';
  version: string;
  channel: UpdateChannel;
  classification: UpdateClassification;
  urgency: UpdateUrgency;
  minimumSupportedVersion: string;
  publishedAt: string;
  expiresAt: string;
  revoked: boolean;
  rollout: {
    percentage: 1 | 5 | 25 | 50 | 100;
    seed: string;
    paused: boolean;
  };
  releaseNotes: StructuredReleaseNotes;
  artifacts: SignedUpdateArtifact[];
}

export interface SignedUpdateEnvelope {
  payload: SignedUpdatePolicy;
  signature: string;
}

export interface AvailableUpdate {
  version: string;
  channel: UpdateChannel;
  classification: UpdateClassification;
  urgency: UpdateUrgency;
  mandatory: boolean;
  publishedAt: string;
  releaseNotes: StructuredReleaseNotes;
}

export interface UpdateSnapshot {
  phase: UpdatePhase;
  currentVersion: string;
  channel: UpdateChannel;
  lastCheckedAt: string | null;
  available: AvailableUpdate | null;
  progressPercent: number | null;
  bytesPerSecond: number | null;
  errorCode: string | null;
  restartBlockedReason: string | null;
}

export interface RestartSafety {
  activeCall: boolean;
  activeTransfer: boolean;
  unsavedDraft: boolean;
}
