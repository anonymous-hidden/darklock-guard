import { generateKeyPairSync, sign } from 'crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson, UpdatePolicyError, validateSignedUpdatePolicy } from './updatePolicy';
import type { SignedUpdateEnvelope, SignedUpdatePolicy } from './updateTypes';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const rotated = generateKeyPairSync('ed25519');
const rotatedPublicPem = rotated.publicKey.export({ type: 'spki', format: 'pem' }).toString();

function policy(overrides: Partial<SignedUpdatePolicy> = {}): SignedUpdatePolicy {
  return {
    schemaVersion: 1,
    keyId: 'test-key',
    releaseId: 'release-2.1.0',
    metadataSequence: 1,
    app: 'ridgeline',
    version: '2.1.0',
    channel: 'stable',
    classification: 'minor',
    urgency: 'recommended',
    minimumSupportedVersion: '2.0.0',
    publishedAt: '2026-07-14T12:00:00.000Z',
    expiresAt: '2026-07-21T12:00:00.000Z',
    revoked: false,
    rollout: { percentage: 100, seed: 'release-2.1.0', paused: false },
    releaseNotes: {
      title: 'Ridgeline 2.1',
      summary: 'A safer update system.',
      highlights: ['Verified updates'],
      fixes: [],
      security: [],
    },
    artifacts: [{
      platform: 'win32',
      arch: 'x64',
      installerType: 'nsis',
      url: 'https://releases.darklock.net/ridgeline/stable/Ridgeline-2.1.0-win-x64.exe',
      size: 50_000_000,
      sha256: 'a'.repeat(64),
      sha512: Buffer.alloc(64, 7).toString('base64'),
    }],
    ...overrides,
  };
}

function envelope(payload: SignedUpdatePolicy, tamperSignature = false): SignedUpdateEnvelope {
  const signature = sign(null, Buffer.from(canonicalJson(payload)), privateKey);
  if (tamperSignature) signature[0] ^= 0xff;
  return { payload, signature: signature.toString('base64') };
}

function validate(payload: SignedUpdatePolicy, overrides: Record<string, unknown> = {}) {
  return validateSignedUpdatePolicy(envelope(payload), {
    currentVersion: '2.0.0',
    channel: 'stable',
    platform: 'win32',
    arch: 'x64',
    installationId: 'installation-test',
    nowMs: Date.parse('2026-07-15T12:00:00.000Z'),
    trustedKeys: { 'test-key': publicPem },
    approvedHosts: ['releases.darklock.net'],
    ...overrides,
  });
}

function expectCode(run: () => unknown, code: string) {
  try {
    run();
    throw new Error('expected validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(UpdatePolicyError);
    expect((error as UpdatePolicyError).code).toBe(code);
  }
}

describe('signed update policy security', () => {
  it.each([
    ['2.0.1', 'patch'],
    ['2.1.0', 'minor'],
    ['3.0.0', 'major'],
    ['2.0.2', 'security'],
    ['2.0.3', 'hotfix'],
  ] as const)('accepts a newer %s %s release', (version, classification) => {
    const result = validate(policy({ version, classification, releaseId: `release-${version}` }));
    expect(result.policy.version).toBe(version);
  });

  it('derives mandatory only from signed urgency and minimum version', () => {
    const result = validate(policy({ urgency: 'required', minimumSupportedVersion: '2.0.5' }));
    expect(result.mandatory).toBe(true);
  });

  it('rejects current, downgrade, and invalid semantic versions', () => {
    expectCode(() => validate(policy({ version: '2.0.0' })), 'downgrade_or_current');
    expectCode(() => validate(policy({ version: '1.9.9', minimumSupportedVersion: '1.9.9' })), 'downgrade_or_current');
    expectCode(() => validate(policy({ version: '2.1' })), 'invalid_version');
  });

  it('rejects missing, unknown, and invalid signatures', () => {
    const payload = policy();
    expectCode(() => validateSignedUpdatePolicy({ payload, signature: '' }, {
      currentVersion: '2.0.0', channel: 'stable', platform: 'win32', arch: 'x64',
      installationId: 'id', nowMs: Date.parse('2026-07-15T12:00:00Z'),
      trustedKeys: { 'test-key': publicPem }, approvedHosts: ['releases.darklock.net'],
    }), 'invalid_signature');
    expectCode(() => validate(policy({ keyId: 'unknown' })), 'unknown_signing_key');
    expectCode(() => validateSignedUpdatePolicy(envelope(payload, true), {
      currentVersion: '2.0.0', channel: 'stable', platform: 'win32', arch: 'x64',
      installationId: 'id', nowMs: Date.parse('2026-07-15T12:00:00Z'),
      trustedKeys: { 'test-key': publicPem }, approvedHosts: ['releases.darklock.net'],
    }), 'invalid_signature');
  });

  it.each([
    ['version', (value: SignedUpdatePolicy) => { value.version = '2.1.1'; }],
    ['channel', (value: SignedUpdatePolicy) => { value.channel = 'beta'; }],
    ['platform', (value: SignedUpdatePolicy) => { value.artifacts[0].platform = 'linux'; }],
    ['architecture', (value: SignedUpdatePolicy) => { value.artifacts[0].arch = 'arm64'; }],
    ['artifact URL', (value: SignedUpdatePolicy) => { value.artifacts[0].url = 'https://releases.darklock.net/ridgeline/other.exe'; }],
    ['artifact size', (value: SignedUpdatePolicy) => { value.artifacts[0].size += 1; }],
    ['SHA-256', (value: SignedUpdatePolicy) => { value.artifacts[0].sha256 = 'b'.repeat(64); }],
    ['SHA-512', (value: SignedUpdatePolicy) => { value.artifacts[0].sha512 = Buffer.alloc(64, 8).toString('base64'); }],
    ['publication time', (value: SignedUpdatePolicy) => { value.publishedAt = '2026-07-14T12:01:00.000Z'; }],
    ['expiry', (value: SignedUpdatePolicy) => { value.expiresAt = '2026-07-21T12:01:00.000Z'; }],
    ['key ID', (value: SignedUpdatePolicy) => { value.keyId = 'alternate-key'; }],
  ])('cryptographically binds signed %s', (_name, mutate) => {
    const original = policy();
    const signed = envelope(original);
    const tampered = structuredClone(original);
    mutate(tampered);
    expectCode(() => validateSignedUpdatePolicy({ payload: tampered, signature: signed.signature }, {
      currentVersion: '2.0.0', channel: 'stable', platform: 'win32', arch: 'x64',
      installationId: 'id', nowMs: Date.parse('2026-07-15T12:00:00Z'),
      trustedKeys: { 'test-key': publicPem, 'alternate-key': publicPem },
      approvedHosts: ['releases.darklock.net'],
    }), 'invalid_signature');
  });

  it('accepts a rotated release key and explicitly rejects a revoked key', () => {
    const rotatedPolicy = policy({ keyId: 'rotated-key' });
    const rotatedEnvelope = {
      payload: rotatedPolicy,
      signature: sign(null, Buffer.from(canonicalJson(rotatedPolicy)), rotated.privateKey).toString('base64'),
    };
    expect(validateSignedUpdatePolicy(rotatedEnvelope, {
      currentVersion: '2.0.0', channel: 'stable', platform: 'win32', arch: 'x64',
      installationId: 'id', nowMs: Date.parse('2026-07-15T12:00:00Z'),
      trustedKeys: { 'rotated-key': rotatedPublicPem }, approvedHosts: ['releases.darklock.net'],
    })).toBeTruthy();
    expectCode(() => validate(policy(), { revokedKeyIds: ['test-key'] }), 'revoked_signing_key');
  });

  it('allows recovery signing only for an explicit full-rollout emergency security release', () => {
    const recoveryPolicy = policy({ keyId: 'recovery-key' });
    const recoveryEnvelope = (payload: SignedUpdatePolicy) => ({
      payload,
      signature: sign(null, Buffer.from(canonicalJson(payload)), rotated.privateKey).toString('base64'),
    });
    const input = {
      currentVersion: '2.0.0', channel: 'stable' as const, platform: 'win32' as const, arch: 'x64',
      installationId: 'id', nowMs: Date.parse('2026-07-15T12:00:00Z'),
      trustedKeys: { 'recovery-key': rotatedPublicPem }, recoveryKeyIds: ['recovery-key'],
      approvedHosts: ['releases.darklock.net'],
    };
    expectCode(() => validateSignedUpdatePolicy(recoveryEnvelope(recoveryPolicy), input), 'recovery_key_not_authorized');
    const emergency = policy({
      keyId: 'recovery-key', classification: 'security', urgency: 'emergency',
      rollout: { percentage: 100, seed: 'emergency', paused: false },
    });
    expect(validateSignedUpdatePolicy(recoveryEnvelope(emergency), input)).toBeTruthy();
  });

  it('rejects expired, future, revoked, paused, and replayed metadata', () => {
    expectCode(() => validate(policy({ expiresAt: '2026-07-15T11:59:00Z' })), 'expired_metadata');
    expectCode(() => validate(policy({ publishedAt: '2026-07-15T12:06:00Z', expiresAt: '2026-07-22T12:00:00Z' })), 'future_metadata');
    expectCode(() => validate(policy({ revoked: true })), 'revoked_release');
    expectCode(() => validate(policy({ rollout: { percentage: 100, seed: 'release', paused: true } })), 'rollout_paused');
    expectCode(() => validate(policy(), { highestAcceptedVersion: '2.2.0' }), 'replayed_metadata');
  });

  it('accepts only a higher signed metadata revision for the same candidate version', () => {
    const revised = policy({ metadataSequence: 2, rollout: { percentage: 100, seed: 'release-2.1.0-revision-2', paused: false } });
    expect(validate(revised, { highestAcceptedVersion: '2.1.0', highestAcceptedMetadataSequence: 1 })).toBeTruthy();
    expectCode(() => validate(policy(), {
      highestAcceptedVersion: '2.1.0',
      highestAcceptedMetadataSequence: 2,
    }), 'replayed_metadata');
    expectCode(() => validate(revised, {
      highestAcceptedVersion: '2.1.0',
      highestAcceptedMetadataSequence: 2,
      highestAcceptedPolicyHash: 'f'.repeat(64),
    }), 'replayed_metadata');
  });

  it('rejects wrong channel, platform, architecture, and unapproved hosts', () => {
    expectCode(() => validate(policy({ channel: 'beta' })), 'wrong_channel');
    expectCode(() => validate(policy(), { platform: 'darwin' }), 'wrong_platform');
    expectCode(() => validate(policy(), { arch: 'arm64' }), 'wrong_architecture');
    const artifacts = [{ ...policy().artifacts[0], url: 'https://evil.example/update.exe' }];
    expectCode(() => validate(policy({ artifacts })), 'unapproved_download_host');
  });

  it('rejects HTTP and oversized artifacts', () => {
    expectCode(() => validate(policy({ artifacts: [{ ...policy().artifacts[0], url: 'http://releases.darklock.net/update.exe' }] })), 'insecure_download_url');
    expectCode(() => validate(policy({ artifacts: [{ ...policy().artifacts[0], size: 2 * 1024 * 1024 * 1024 }] })), 'oversized_artifact');
  });
});
