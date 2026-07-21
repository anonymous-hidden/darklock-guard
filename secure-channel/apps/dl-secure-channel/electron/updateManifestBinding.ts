import type { SignedUpdateArtifact, SignedUpdatePolicy } from './updateTypes.js';

export const FRAMEWORK_FEED_URL = 'https://releases.darklock.net/ridgeline/';

export interface FrameworkUpdateFile {
  url: string;
  sha512: string;
  size?: number;
}

export interface FrameworkUpdateInfo {
  version: string;
  files: FrameworkUpdateFile[];
  path?: string;
  sha512?: string;
}

function absoluteArtifactUrl(value: string): string {
  const url = new URL(value, FRAMEWORK_FEED_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('updater_manifest_url_mismatch');
  }
  return url.href;
}

export function assertFrameworkManifestBinding(
  info: FrameworkUpdateInfo,
  policy: SignedUpdatePolicy,
  artifact: SignedUpdateArtifact,
): void {
  if (info.version !== policy.version) throw new Error('updater_manifest_version_mismatch');
  if (!Array.isArray(info.files) || info.files.length !== 1) throw new Error('updater_manifest_file_set_mismatch');

  const file = info.files[0];
  if (absoluteArtifactUrl(file.url) !== absoluteArtifactUrl(artifact.url)) {
    throw new Error('updater_manifest_url_mismatch');
  }
  if (file.sha512 !== artifact.sha512) throw new Error('updater_manifest_sha512_mismatch');
  if (!Number.isSafeInteger(file.size) || file.size !== artifact.size) {
    throw new Error('updater_manifest_size_mismatch');
  }

  if (info.path !== undefined && absoluteArtifactUrl(info.path) !== absoluteArtifactUrl(artifact.url)) {
    throw new Error('updater_manifest_legacy_path_mismatch');
  }
  if (info.sha512 !== undefined && info.sha512 !== artifact.sha512) {
    throw new Error('updater_manifest_legacy_sha512_mismatch');
  }
}
