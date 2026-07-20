import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sodium = require('libsodium-wrappers-sumo');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function validatePassword(password) {
  if (typeof password !== 'string') fail('RIDGELINE_PASSWORD_TYPE_INVALID');
  const bytes = Buffer.from(password, 'utf8');
  if (bytes.length < 8 || bytes.length > 1024) {
    bytes.fill(0);
    fail('RIDGELINE_PASSWORD_LENGTH_INVALID');
  }
  return bytes;
}

function passwordLimits(options = {}) {
  const testMode = options.environment === 'test' || process.env.NODE_ENV === 'test';
  if (testMode) {
    return {
      opsLimit: sodium.crypto_pwhash_OPSLIMIT_MIN,
      memLimit: sodium.crypto_pwhash_MEMLIMIT_MIN,
    };
  }
  return {
    opsLimit: sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    memLimit: sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
  };
}

export function isArgon2idHash(value) {
  return typeof value === 'string' && value.startsWith('$argon2id$');
}

export async function hashPasswordArgon2id(password, options = {}) {
  await sodium.ready;
  const bytes = validatePassword(password);
  try {
    const { opsLimit, memLimit } = passwordLimits(options);
    return sodium.crypto_pwhash_str(bytes, opsLimit, memLimit);
  } finally {
    bytes.fill(0);
  }
}

export async function verifyPasswordArgon2id(hash, password) {
  await sodium.ready;
  if (!isArgon2idHash(hash)) return false;
  const bytes = validatePassword(password);
  try {
    return sodium.crypto_pwhash_str_verify(hash, bytes);
  } catch {
    return false;
  } finally {
    bytes.fill(0);
  }
}

export async function argon2idHashNeedsUpgrade(hash, options = {}) {
  await sodium.ready;
  if (!isArgon2idHash(hash)) return true;
  const { opsLimit, memLimit } = passwordLimits(options);
  try {
    return sodium.crypto_pwhash_str_needs_rehash(hash, opsLimit, memLimit);
  } catch {
    return true;
  }
}
