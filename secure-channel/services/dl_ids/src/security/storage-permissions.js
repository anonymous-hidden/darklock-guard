import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function assertOwnedPrivatePath(path, kind) {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink()) fail(`RIDGELINE_${kind}_SYMLINK_REJECTED`);
  if (kind === 'DATABASE_DIRECTORY' && !stats.isDirectory()) fail('RIDGELINE_DATABASE_DIRECTORY_INVALID');
  if (kind !== 'DATABASE_DIRECTORY' && !stats.isFile()) fail(`RIDGELINE_${kind}_INVALID`);
  if (stats.uid !== process.getuid()) fail(`RIDGELINE_${kind}_OWNER_INVALID`);
  const mode = stats.mode & 0o777;
  if (kind === 'DATABASE_DIRECTORY' && mode !== 0o700) fail('RIDGELINE_DATABASE_DIRECTORY_MODE_INVALID');
  if (kind !== 'DATABASE_DIRECTORY' && mode !== 0o600) fail(`RIDGELINE_${kind}_MODE_INVALID`);
}

export function prepareIdsPrivateStorage(databasePath, configured) {
  if (!configured || process.platform === 'win32') return;
  if (typeof process.getuid !== 'function' || process.getuid() === 0) {
    fail('RIDGELINE_IDS_MUST_NOT_RUN_AS_ROOT');
  }
  process.umask(0o077);
  const databaseDirectory = dirname(databasePath);
  if (!existsSync(databaseDirectory)) mkdirSync(databaseDirectory, { recursive: true, mode: 0o700 });
  assertOwnedPrivatePath(databaseDirectory, 'DATABASE_DIRECTORY');
  for (const [path, kind] of [
    [databasePath, 'DATABASE_FILE'],
    [`${databasePath}-wal`, 'DATABASE_WAL'],
    [`${databasePath}-shm`, 'DATABASE_SHM'],
  ]) {
    if (existsSync(path)) assertOwnedPrivatePath(path, kind);
  }
}

export function validateIdsPrivateDatabaseFiles(databasePath, configured) {
  if (!configured || process.platform === 'win32') return;
  for (const [path, kind] of [
    [databasePath, 'DATABASE_FILE'],
    [`${databasePath}-wal`, 'DATABASE_WAL'],
    [`${databasePath}-shm`, 'DATABASE_SHM'],
  ]) {
    if (existsSync(path)) assertOwnedPrivatePath(path, kind);
  }
}
