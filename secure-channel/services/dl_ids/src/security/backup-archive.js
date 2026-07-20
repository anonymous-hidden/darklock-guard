import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const MAGIC = Buffer.from('RIDGELINE-BACKUP\n', 'ascii');
const ARCHIVE_VERSION = 1;
const ARCHIVE_ALGORITHM = 'xchacha20-poly1305-secretstream';
const CHUNK_BYTES = 256 * 1024;
const MAX_PREAMBLE_BYTES = 4096;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function backupAad(secureFields, backupId) {
  return {
    application: 'ridgeline',
    environment: secureFields.environment,
    service: 'ids',
    encryptionDomain: 'backup',
    userId: 'ridgeline-server',
    collection: 'backups',
    recordId: backupId,
    fieldName: 'archive',
    schemaVersion: 1,
  };
}

function writeFrame(fd, value) {
  const bytes = Buffer.from(value);
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length, 0);
  writeSync(fd, length);
  writeSync(fd, bytes);
}

function readExact(fd, length, positionState) {
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const read = readSync(fd, buffer, offset, length - offset, positionState.position);
    if (read === 0) fail('RIDGELINE_BACKUP_TRUNCATED');
    positionState.position += read;
    offset += read;
  }
  return buffer;
}

function readFrame(fd, positionState, fileSize) {
  if (positionState.position === fileSize) return null;
  if (fileSize - positionState.position < 4) fail('RIDGELINE_BACKUP_TRUNCATED');
  const length = readExact(fd, 4, positionState).readUInt32BE(0);
  if (length < 17 || length > CHUNK_BYTES + 2048) fail('RIDGELINE_BACKUP_FRAME_SIZE_INVALID');
  if (positionState.position + length > fileSize) fail('RIDGELINE_BACKUP_TRUNCATED');
  return readExact(fd, length, positionState);
}

function parsePreamble(fd, fileSize, positionState) {
  const magic = readExact(fd, MAGIC.length, positionState);
  if (!magic.equals(MAGIC)) fail('RIDGELINE_BACKUP_MAGIC_INVALID');
  const preambleLength = readExact(fd, 4, positionState).readUInt32BE(0);
  if (preambleLength < 2 || preambleLength > MAX_PREAMBLE_BYTES) fail('RIDGELINE_BACKUP_PREAMBLE_SIZE_INVALID');
  if (positionState.position + preambleLength > fileSize) fail('RIDGELINE_BACKUP_TRUNCATED');
  let preamble;
  try {
    preamble = JSON.parse(readExact(fd, preambleLength, positionState).toString('utf8'));
  } catch {
    fail('RIDGELINE_BACKUP_PREAMBLE_INVALID');
  }
  const keys = Object.keys(preamble || {}).sort().join(',');
  if (keys !== 'algorithm,backupId,streamHeader,version'
    || preamble.version !== ARCHIVE_VERSION
    || preamble.algorithm !== ARCHIVE_ALGORITHM
    || !/^[0-9a-f-]{36}$/i.test(preamble.backupId)
    || typeof preamble.streamHeader !== 'string') {
    fail('RIDGELINE_BACKUP_PREAMBLE_INVALID');
  }
  return preamble;
}

function ensurePrivateDirectory(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') return;
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) fail('RIDGELINE_BACKUP_DIRECTORY_INVALID');
  if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) fail('RIDGELINE_BACKUP_DIRECTORY_OWNER_INVALID');
  if ((stats.mode & 0o777) !== 0o700) fail('RIDGELINE_BACKUP_DIRECTORY_MODE_INVALID');
}

function assertPrivateFile(path, kind) {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) fail(`RIDGELINE_${kind}_FILE_INVALID`);
  if (process.platform === 'win32') return;
  if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) fail(`RIDGELINE_${kind}_FILE_OWNER_INVALID`);
  if ((stats.mode & 0o777) !== 0o600) fail(`RIDGELINE_${kind}_FILE_MODE_INVALID`);
}

async function snapshotDatabase(databasePath, snapshotPath) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(snapshotPath);
  } finally {
    db.close();
  }
}

export async function createEncryptedBackup({ databasePath, backupDirectory, secureFields, retain = 7 }) {
  if (!secureFields?.configured) fail('RIDGELINE_SECURE_STORAGE_NOT_CONFIGURED');
  const source = resolve(databasePath);
  const outputDirectory = resolve(backupDirectory);
  ensurePrivateDirectory(outputDirectory);
  assertPrivateFile(source, 'DATABASE');

  const backupId = randomUUID();
  const outputPath = join(outputDirectory, `${randomUUID()}.rlbackup`);
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'ridgeline-backup-'));
  if (process.platform !== 'win32') chmodSync(temporaryDirectory, 0o700);
  const snapshotPath = join(temporaryDirectory, 'snapshot.db');
  let outputFd;

  try {
    await snapshotDatabase(source, snapshotPath);
    if (process.platform !== 'win32') chmodSync(snapshotPath, 0o600);

    const stream = secureFields.createSecretStreamEncryptor('backup', backupAad(secureFields, backupId));
    const preamble = Buffer.from(JSON.stringify({
      version: ARCHIVE_VERSION,
      algorithm: ARCHIVE_ALGORITHM,
      backupId,
      streamHeader: stream.header,
    }), 'utf8');
    outputFd = openSync(outputPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeSync(outputFd, MAGIC);
    const preambleLength = Buffer.allocUnsafe(4);
    preambleLength.writeUInt32BE(preamble.length, 0);
    writeSync(outputFd, preambleLength);
    writeSync(outputFd, preamble);

    const manifest = Buffer.from(JSON.stringify({
      version: ARCHIVE_VERSION,
      algorithm: ARCHIVE_ALGORITHM,
      backupId,
      format: 'sqlite-snapshot',
    }), 'utf8');
    writeFrame(outputFd, stream.push(manifest));

    const snapshotFd = openSync(snapshotPath, constants.O_RDONLY);
    try {
      const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
      let bytesRead;
      while ((bytesRead = readSync(snapshotFd, buffer, 0, buffer.length, null)) > 0) {
        writeFrame(outputFd, stream.push(buffer.subarray(0, bytesRead)));
      }
      buffer.fill(0);
    } finally {
      closeSync(snapshotFd);
    }
    writeFrame(outputFd, stream.push(Buffer.alloc(0), true));
    fsyncSync(outputFd);
    closeSync(outputFd);
    outputFd = undefined;
    if (process.platform !== 'win32') chmodSync(outputPath, 0o600);

    await verifyEncryptedBackup({ archivePath: outputPath, secureFields });

    const keep = Number.isSafeInteger(retain) && retain >= 1 ? retain : 7;
    const archives = readdirSync(outputDirectory)
      .filter((name) => name.endsWith('.rlbackup'))
      .map((name) => ({ path: join(outputDirectory, name), modified: statSync(join(outputDirectory, name)).mtimeMs }))
      .sort((a, b) => b.modified - a.modified);
    for (const old of archives.slice(keep)) unlinkSync(old.path);
    return { archivePath: outputPath, backupId };
  } catch (error) {
    if (outputFd !== undefined) closeSync(outputFd);
    if (existsSync(outputPath)) unlinkSync(outputPath);
    throw error;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function restoreEncryptedBackup({ archivePath, destinationPath, secureFields }) {
  if (!secureFields?.configured) fail('RIDGELINE_SECURE_STORAGE_NOT_CONFIGURED');
  const archive = resolve(archivePath);
  const destination = resolve(destinationPath);
  if (existsSync(destination)) fail('RIDGELINE_RESTORE_DESTINATION_EXISTS');
  assertPrivateFile(archive, 'BACKUP');
  ensurePrivateDirectory(dirname(destination));

  const archiveFd = openSync(archive, constants.O_RDONLY);
  const fileSize = statSync(archive).size;
  const positionState = { position: 0 };
  let destinationFd;
  try {
    const preamble = parsePreamble(archiveFd, fileSize, positionState);
    const stream = secureFields.createSecretStreamDecryptor(
      'backup',
      preamble.streamHeader,
      backupAad(secureFields, preamble.backupId),
    );
    destinationFd = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    let frameIndex = 0;
    let finalized = false;
    while (positionState.position < fileSize) {
      const frame = readFrame(archiveFd, positionState, fileSize);
      const pulled = stream.pull(frame);
      if (frameIndex === 0) {
        let manifest;
        try {
          manifest = JSON.parse(pulled.plaintext.toString('utf8'));
        } catch {
          fail('RIDGELINE_BACKUP_MANIFEST_INVALID');
        }
        if (manifest?.version !== ARCHIVE_VERSION
          || manifest?.algorithm !== ARCHIVE_ALGORITHM
          || manifest?.backupId !== preamble.backupId
          || manifest?.format !== 'sqlite-snapshot') {
          fail('RIDGELINE_BACKUP_MANIFEST_INVALID');
        }
      } else if (pulled.plaintext.length > 0) {
        writeSync(destinationFd, pulled.plaintext);
      }
      frameIndex += 1;
      finalized = pulled.final;
      if (finalized && positionState.position !== fileSize) fail('RIDGELINE_BACKUP_TRAILING_DATA');
    }
    if (!finalized || frameIndex < 3) fail('RIDGELINE_BACKUP_FINAL_TAG_MISSING');
    fsyncSync(destinationFd);
    closeSync(destinationFd);
    destinationFd = undefined;
    if (process.platform !== 'win32') chmodSync(destination, 0o600);

    const restored = new Database(destination, { readonly: true, fileMustExist: true });
    try {
      const result = restored.pragma('integrity_check', { simple: true });
      if (result !== 'ok') fail('RIDGELINE_BACKUP_SQLITE_INTEGRITY_FAILED');
    } finally {
      restored.close();
    }
    return { destinationPath: destination, backupId: preamble.backupId };
  } catch (error) {
    if (destinationFd !== undefined) closeSync(destinationFd);
    if (existsSync(destination)) unlinkSync(destination);
    throw error;
  } finally {
    closeSync(archiveFd);
  }
}

export async function verifyEncryptedBackup({ archivePath, secureFields }) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'ridgeline-restore-verify-'));
  if (process.platform !== 'win32') chmodSync(temporaryDirectory, 0o700);
  const destinationPath = join(temporaryDirectory, 'verified.db');
  try {
    const result = await restoreEncryptedBackup({ archivePath, destinationPath, secureFields });
    return { ok: true, backupId: result.backupId };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export const BACKUP_ARCHIVE_EXTENSION = '.rlbackup';
