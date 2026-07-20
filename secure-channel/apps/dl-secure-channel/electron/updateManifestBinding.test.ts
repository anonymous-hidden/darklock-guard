import { describe, expect, it } from 'vitest';
import { assertFrameworkManifestBinding, type FrameworkUpdateInfo } from './updateManifestBinding';
import type { SignedUpdateArtifact, SignedUpdatePolicy } from './updateTypes';

const artifact: SignedUpdateArtifact = {
  platform: 'win32',
  arch: 'x64',
  installerType: 'nsis',
  url: 'https://releases.darklock.net/ridgeline/Ridgeline-2.1.0-win-x64.exe',
  size: 50_000_000,
  sha256: 'a'.repeat(64),
  sha512: Buffer.alloc(64, 7).toString('base64'),
};

const policy = {
  version: '2.1.0',
} as SignedUpdatePolicy;

function manifest(overrides: Partial<FrameworkUpdateInfo> = {}): FrameworkUpdateInfo {
  return {
    version: '2.1.0',
    files: [{ url: artifact.url, sha512: artifact.sha512, size: artifact.size }],
    path: artifact.url,
    sha512: artifact.sha512,
    ...overrides,
  };
}

describe('electron-updater manifest binding', () => {
  it('accepts only an exact signed artifact match', () => {
    expect(() => assertFrameworkManifestBinding(manifest(), policy, artifact)).not.toThrow();
  });

  it.each([
    ['version', manifest({ version: '2.1.1' }), 'updater_manifest_version_mismatch'],
    ['URL', manifest({ files: [{ ...manifest().files[0], url: 'https://releases.darklock.net/ridgeline/other.exe' }] }), 'updater_manifest_url_mismatch'],
    ['SHA-512', manifest({ files: [{ ...manifest().files[0], sha512: Buffer.alloc(64, 8).toString('base64') }] }), 'updater_manifest_sha512_mismatch'],
    ['size', manifest({ files: [{ ...manifest().files[0], size: artifact.size + 1 }] }), 'updater_manifest_size_mismatch'],
    ['missing size', manifest({ files: [{ url: artifact.url, sha512: artifact.sha512 }] }), 'updater_manifest_size_mismatch'],
    ['extra artifact', manifest({ files: [...manifest().files, { ...manifest().files[0], url: `${artifact.url}.extra` }] }), 'updater_manifest_file_set_mismatch'],
    ['missing artifact', manifest({ files: [] }), 'updater_manifest_file_set_mismatch'],
    ['legacy path', manifest({ path: 'other.exe' }), 'updater_manifest_legacy_path_mismatch'],
    ['legacy SHA-512', manifest({ sha512: Buffer.alloc(64, 9).toString('base64') }), 'updater_manifest_legacy_sha512_mismatch'],
  ])('rejects a mismatched %s', (_name, info, code) => {
    expect(() => assertFrameworkManifestBinding(info, policy, artifact)).toThrow(code);
  });

  it('rejects URL credentials, query substitution, fragments, and insecure URLs', () => {
    for (const url of [
      'https://user:pass@releases.darklock.net/ridgeline/update.exe',
      `${artifact.url}?alternate=1`,
      `${artifact.url}#alternate`,
      'http://releases.darklock.net/ridgeline/update.exe',
    ]) {
      expect(() => assertFrameworkManifestBinding(
        manifest({ files: [{ ...manifest().files[0], url }] }), policy, artifact,
      )).toThrow('updater_manifest_url_mismatch');
    }
  });
});
