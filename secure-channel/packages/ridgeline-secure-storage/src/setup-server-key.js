#!/usr/bin/env node
import {
  chmodSync,
  chownSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fingerprintKey, SERVER_MASTER_KEY_BYTES } from './master-key.js';

function fail(code) {
  process.stderr.write(`${code}\n`);
  process.exit(1);
}

function valueAfter(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) fail(`MISSING_${flag.slice(2).toUpperCase().replaceAll('-', '_')}`);
  return value;
}

if (process.platform === 'win32') fail('RIDGELINE_SERVER_KEY_SETUP_REQUIRES_LINUX');
if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
  fail('RIDGELINE_SERVER_KEY_SETUP_REQUIRES_ROOT');
}

const keyPath = resolve(valueAfter('--path', '/etc/ridgeline/keys/server-master-key'));
const serviceUser = valueAfter('--service-user', 'ridgeline-ids');
const parent = dirname(keyPath);
if (existsSync(keyPath)) fail('RIDGELINE_MASTER_KEY_ALREADY_EXISTS');

let uid;
let gid;
try {
  uid = Number(execFileSync('id', ['-u', serviceUser], { encoding: 'utf8' }).trim());
  gid = Number(execFileSync('id', ['-g', serviceUser], { encoding: 'utf8' }).trim());
} catch {
  fail('RIDGELINE_SERVICE_ACCOUNT_NOT_FOUND');
}
if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid)) fail('RIDGELINE_SERVICE_ACCOUNT_INVALID');

mkdirSync(parent, { recursive: true, mode: 0o700 });
const parentStats = lstatSync(parent);
if (parentStats.isSymbolicLink() || !parentStats.isDirectory()) fail('RIDGELINE_KEY_DIRECTORY_INVALID');
chmodSync(parent, 0o700);
chownSync(parent, uid, gid);

try {
  const key = randomBytes(SERVER_MASTER_KEY_BYTES);
  let fd;
  let created = false;
  try {
    fd = openSync(keyPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    created = true;
    writeFileSync(fd, key);
    fsyncSync(fd);
    chownSync(keyPath, uid, gid);
    chmodSync(keyPath, 0o600);
    const fingerprint = fingerprintKey(key);
    process.stdout.write(`Ridgeline server master key created successfully. Fingerprint: ${fingerprint}\n`);
  } catch (error) {
    if (created) {
      try {
        unlinkSync(keyPath);
      } catch {
        // Refuse to continue; an operator must inspect any file that could not be removed.
      }
    }
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
    key.fill(0);
  }
} catch (error) {
  process.stderr.write(`${error?.code ?? 'RIDGELINE_MASTER_KEY_CREATE_FAILED'}\n`);
  process.exitCode = 1;
}
