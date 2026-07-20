import { createHash, verify } from 'crypto';
import { gt, lt, valid } from 'semver';
import type {
  SignedUpdateArtifact,
  SignedUpdateEnvelope,
  SignedUpdatePolicy,
  UpdateChannel,
  UpdateClassification,
  UpdateUrgency,
} from './updateTypes.js';

const CLASSIFICATIONS = new Set<UpdateClassification>(['patch', 'minor', 'major', 'security', 'hotfix']);
const URGENCIES = new Set<UpdateUrgency>(['recommended', 'required', 'emergency']);
const CHANNELS = new Set<UpdateChannel>(['stable', 'beta', 'enterprise-preview', 'development']);
const ROLLOUT_PERCENTAGES = new Set([1, 5, 25, 50, 100]);
const HEX_256 = /^[a-f0-9]{64}$/i;
const BASE64_512 = /^[A-Za-z0-9+/]{86}==$/;
const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type UpdatePolicyErrorCode =
  | 'invalid_envelope'
  | 'unknown_signing_key'
  | 'revoked_signing_key'
  | 'recovery_key_not_authorized'
  | 'invalid_signature'
  | 'unsupported_schema'
  | 'invalid_metadata'
  | 'wrong_app'
  | 'invalid_version'
  | 'downgrade_or_current'
  | 'replayed_metadata'
  | 'wrong_channel'
  | 'wrong_platform'
  | 'wrong_architecture'
  | 'expired_metadata'
  | 'future_metadata'
  | 'revoked_release'
  | 'rollout_paused'
  | 'rollout_ineligible'
  | 'unapproved_download_host'
  | 'insecure_download_url'
  | 'oversized_artifact';

export class UpdatePolicyError extends Error {
  constructor(public readonly code: UpdatePolicyErrorCode) {
    super(code);
    this.name = 'UpdatePolicyError';
  }
}

export interface PolicyValidationInput {
  currentVersion: string;
  channel: UpdateChannel;
  platform: NodeJS.Platform;
  arch: string;
  installationId: string;
  nowMs: number;
  trustedKeys: Readonly<Record<string, string>>;
  revokedKeyIds?: readonly string[];
  recoveryKeyIds?: readonly string[];
  approvedHosts: readonly string[];
  highestAcceptedVersion?: string | null;
  highestAcceptedPolicyHash?: string | null;
  highestAcceptedMetadataSequence?: number | null;
  enterpriseEntitled?: boolean;
  allowStableOnBeta?: boolean;
}

export interface ValidatedUpdatePolicy {
  policy: SignedUpdatePolicy;
  artifact: SignedUpdateArtifact;
  policyHash: string;
  mandatory: boolean;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  throw new UpdatePolicyError('invalid_metadata');
}

export function policySha256(policy: SignedUpdatePolicy): string {
  return createHash('sha256').update(canonicalJson(policy), 'utf8').digest('hex');
}

export function rolloutBucket(installationId: string, seed: string): number {
  const digest = createHash('sha256').update(`${installationId}:${seed}`, 'utf8').digest();
  return digest.readUInt32BE(0) % 10_000;
}

function isStrictSemver(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value) && valid(value) === value;
}

function validDate(value: unknown): number {
  if (typeof value !== 'string') return Number.NaN;
  return Date.parse(value);
}

function channelAllowed(policy: SignedUpdatePolicy, input: PolicyValidationInput): boolean {
  if (input.channel === policy.channel) return true;
  return input.channel === 'beta' && input.allowStableOnBeta !== false && policy.channel === 'stable';
}

function selectArtifact(policy: SignedUpdatePolicy, input: PolicyValidationInput): SignedUpdateArtifact {
  const platformArtifacts = policy.artifacts.filter(artifact => artifact.platform === input.platform);
  if (platformArtifacts.length === 0) throw new UpdatePolicyError('wrong_platform');
  const artifact = platformArtifacts.find(candidate => candidate.arch === input.arch);
  if (!artifact) throw new UpdatePolicyError('wrong_architecture');
  if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0 || artifact.size > MAX_ARTIFACT_BYTES) {
    throw new UpdatePolicyError('oversized_artifact');
  }
  if (!HEX_256.test(artifact.sha256) || !BASE64_512.test(artifact.sha512)) {
    throw new UpdatePolicyError('invalid_metadata');
  }
  let parsed: URL;
  try {
    parsed = new URL(artifact.url);
  } catch {
    throw new UpdatePolicyError('invalid_metadata');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new UpdatePolicyError('insecure_download_url');
  }
  if (!input.approvedHosts.includes(parsed.hostname.toLowerCase())) {
    throw new UpdatePolicyError('unapproved_download_host');
  }
  return artifact;
}

function validateShape(policy: SignedUpdatePolicy): void {
  if (policy.schemaVersion !== 1) throw new UpdatePolicyError('unsupported_schema');
  if (policy.app !== 'ridgeline') throw new UpdatePolicyError('wrong_app');
  if (!isStrictSemver(policy.version) || !isStrictSemver(policy.minimumSupportedVersion)) {
    throw new UpdatePolicyError('invalid_version');
  }
  if (gt(policy.minimumSupportedVersion, policy.version)) throw new UpdatePolicyError('invalid_metadata');
  if (!CLASSIFICATIONS.has(policy.classification) || !URGENCIES.has(policy.urgency) || !CHANNELS.has(policy.channel)) {
    throw new UpdatePolicyError('invalid_metadata');
  }
  if (!policy.releaseId || !Number.isSafeInteger(policy.metadataSequence) || policy.metadataSequence < 1
    || !policy.rollout?.seed || !ROLLOUT_PERCENTAGES.has(policy.rollout?.percentage)) {
    throw new UpdatePolicyError('invalid_metadata');
  }
  if (!Array.isArray(policy.artifacts) || policy.artifacts.length === 0) throw new UpdatePolicyError('invalid_metadata');
  const notes = policy.releaseNotes;
  if (!notes || typeof notes.title !== 'string' || typeof notes.summary !== 'string'
    || notes.title.length > 160 || notes.summary.length > 1000
    || !Array.isArray(notes.highlights) || !Array.isArray(notes.fixes) || !Array.isArray(notes.security)
    || [...notes.highlights, ...notes.fixes, ...notes.security].some(item => typeof item !== 'string' || item.length > 500)) {
    throw new UpdatePolicyError('invalid_metadata');
  }
}

export function validateSignedUpdatePolicy(
  envelope: SignedUpdateEnvelope,
  input: PolicyValidationInput,
): ValidatedUpdatePolicy {
  if (!envelope || typeof envelope !== 'object' || !envelope.payload || typeof envelope.signature !== 'string') {
    throw new UpdatePolicyError('invalid_envelope');
  }
  const policy = envelope.payload;
  validateShape(policy);
  if (input.revokedKeyIds?.includes(policy.keyId)) throw new UpdatePolicyError('revoked_signing_key');
  const trustedKey = input.trustedKeys[policy.keyId];
  if (!trustedKey) throw new UpdatePolicyError('unknown_signing_key');
  let signature: Buffer;
  try {
    signature = Buffer.from(envelope.signature, 'base64');
  } catch {
    throw new UpdatePolicyError('invalid_signature');
  }
  const payloadBytes = Buffer.from(canonicalJson(policy), 'utf8');
  if (signature.length !== 64 || !verify(null, payloadBytes, trustedKey, signature)) {
    throw new UpdatePolicyError('invalid_signature');
  }
  if (input.recoveryKeyIds?.includes(policy.keyId)
    && (!['security', 'hotfix'].includes(policy.classification)
      || policy.urgency !== 'emergency'
      || policy.rollout.percentage !== 100
      || policy.rollout.paused)) {
    throw new UpdatePolicyError('recovery_key_not_authorized');
  }

  const publishedAt = validDate(policy.publishedAt);
  const expiresAt = validDate(policy.expiresAt);
  if (!Number.isFinite(publishedAt) || !Number.isFinite(expiresAt) || expiresAt <= publishedAt) {
    throw new UpdatePolicyError('invalid_metadata');
  }
  if (publishedAt > input.nowMs + MAX_CLOCK_SKEW_MS) throw new UpdatePolicyError('future_metadata');
  if (expiresAt <= input.nowMs) throw new UpdatePolicyError('expired_metadata');
  if (policy.revoked) throw new UpdatePolicyError('revoked_release');
  if (!isStrictSemver(input.currentVersion) || !gt(policy.version, input.currentVersion)) {
    throw new UpdatePolicyError('downgrade_or_current');
  }
  if (!channelAllowed(policy, input)) throw new UpdatePolicyError('wrong_channel');
  if (policy.channel === 'enterprise-preview' && !input.enterpriseEntitled) {
    throw new UpdatePolicyError('wrong_channel');
  }

  const hash = policySha256(policy);
  if (input.highestAcceptedVersion) {
    if (lt(policy.version, input.highestAcceptedVersion)) throw new UpdatePolicyError('replayed_metadata');
    if (policy.version === input.highestAcceptedVersion) {
      const previousSequence = input.highestAcceptedMetadataSequence ?? 0;
      if (policy.metadataSequence < previousSequence) throw new UpdatePolicyError('replayed_metadata');
      if (policy.metadataSequence === previousSequence && input.highestAcceptedPolicyHash
        && input.highestAcceptedPolicyHash !== hash) {
        throw new UpdatePolicyError('replayed_metadata');
      }
    }
  }
  if (policy.rollout.paused) throw new UpdatePolicyError('rollout_paused');
  if (rolloutBucket(input.installationId, policy.rollout.seed) >= policy.rollout.percentage * 100) {
    throw new UpdatePolicyError('rollout_ineligible');
  }

  const artifact = selectArtifact(policy, input);
  const mandatory = policy.urgency !== 'recommended' && lt(input.currentVersion, policy.minimumSupportedVersion);
  return { policy, artifact, policyHash: hash, mandatory };
}
