import {
  closeSync,
  constants,
  lstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';

export const SERVER_MASTER_KEY_BYTES = 32;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function parseDeniedFingerprints(value) {
  return new Set(String(value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean));
}

export function fingerprintKey(key) {
  return `sha256:${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

export function validatePrivatePath(path, options = {}) {
  const {
    platform = process.platform,
    expectedOwnerUid = typeof process.getuid === 'function' ? process.getuid() : null,
    kind = 'key',
  } = options;
  const stats = lstatSync(path);
  if (stats.isSymbolicLink()) fail(`RIDGELINE_${kind.toUpperCase()}_SYMLINK_REJECTED`);
  if (!stats.isFile() && kind === 'key') fail('RIDGELINE_MASTER_KEY_NOT_REGULAR_FILE');
  if (!stats.isDirectory() && kind === 'directory') fail('RIDGELINE_KEY_DIRECTORY_NOT_DIRECTORY');

  if (platform !== 'win32') {
    const mode = stats.mode & 0o777;
    if ((mode & 0o077) !== 0) fail(`RIDGELINE_${kind.toUpperCase()}_PERMISSIONS_TOO_OPEN`);
    if (kind === 'key' && ![0o400, 0o600].includes(mode)) {
      fail('RIDGELINE_MASTER_KEY_MODE_INVALID');
    }
    if (kind === 'directory' && mode !== 0o700) {
      fail('RIDGELINE_KEY_DIRECTORY_MODE_INVALID');
    }
    if (expectedOwnerUid !== null && stats.uid !== Number(expectedOwnerUid)) {
      fail(`RIDGELINE_${kind.toUpperCase()}_OWNER_INVALID`);
    }
  }

  return stats;
}

export function loadServerMasterKey(options = {}) {
  const configuredKeyPath = options.keyPath ?? process.env.RIDGELINE_MASTER_KEY_FILE ?? '';
  const environment = options.environment ?? process.env.NODE_ENV ?? 'development';
  const expectedOwnerUid = options.expectedOwnerUid
    ?? process.env.RIDGELINE_MASTER_KEY_OWNER_UID
    ?? (typeof process.getuid === 'function' ? process.getuid() : null);

  if (!configuredKeyPath) fail('RIDGELINE_MASTER_KEY_PATH_REQUIRED');
  if (environment === 'production' && !isAbsolute(configuredKeyPath)) {
    fail('RIDGELINE_MASTER_KEY_PATH_MUST_BE_ABSOLUTE');
  }
  const keyPath = resolve(configuredKeyPath);

  validatePrivatePath(dirname(keyPath), {
    expectedOwnerUid,
    kind: 'directory',
    platform: options.platform,
  });
  validatePrivatePath(keyPath, {
    expectedOwnerUid,
    kind: 'key',
    platform: options.platform,
  });

  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  const fd = openSync(keyPath, flags);
  let key;
  try {
    key = readFileSync(fd);
  } finally {
    closeSync(fd);
  }

  if (key.length !== SERVER_MASTER_KEY_BYTES) {
    key.fill(0);
    fail('RIDGELINE_MASTER_KEY_LENGTH_INVALID');
  }

  const fingerprint = fingerprintKey(key).toLowerCase();
  const denied = parseDeniedFingerprints(
    options.deniedFingerprints ?? process.env.RIDGELINE_DEVELOPMENT_KEY_FINGERPRINTS,
  );
  if (denied.has(fingerprint)) {
    key.fill(0);
    fail('RIDGELINE_DEVELOPMENT_MASTER_KEY_REJECTED');
  }

  return key;
}
