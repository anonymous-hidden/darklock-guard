import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  argon2idHashNeedsUpgrade,
  createSecureStorage,
  hashPasswordArgon2id,
  isArgon2idHash,
  loadServerMasterKey,
  verifyPasswordArgon2id,
} from '../src/index.js';

const baseAad = Object.freeze({
  application: 'ridgeline',
  environment: 'test',
  service: 'ids',
  encryptionDomain: 'profile',
  userId: 'synthetic-user-1',
  collection: 'users',
  recordId: 'synthetic-user-1',
  fieldName: 'profile_bio',
  schemaVersion: 1,
});

async function storage() {
  return createSecureStorage({
    masterKey: randomBytes(32),
    environment: 'test',
    service: 'ids',
    maxPlaintextBytes: 1024,
  });
}

test('round trip uses strict versioned XChaCha20-Poly1305 envelopes and unique nonces', async () => {
  const secure = await storage();
  const first = secure.encryptText('profile', 'private-beta-sentinel', baseAad);
  const second = secure.encryptText('profile', 'private-beta-sentinel', baseAad);
  assert.equal(secure.decryptText('profile', first, baseAad), 'private-beta-sentinel');
  const firstEnvelope = JSON.parse(first);
  const secondEnvelope = JSON.parse(second);
  assert.equal(firstEnvelope.version, 1);
  assert.equal(firstEnvelope.algorithm, 'xchacha20-poly1305');
  assert.equal(firstEnvelope.keyDomain, 'profile');
  assert.notEqual(firstEnvelope.nonce, secondEnvelope.nonce);
  assert.doesNotMatch(first, /private-beta-sentinel/);
  secure.destroy();
});

test('tampering, wrong user, wrong field, wrong domain, and unknown versions fail closed', async () => {
  const secure = await storage();
  const encrypted = secure.encryptText('profile', 'sensitive-profile', baseAad);
  const envelope = JSON.parse(encrypted);
  envelope.ciphertext = `${envelope.ciphertext.slice(0, -1)}${envelope.ciphertext.endsWith('A') ? 'B' : 'A'}`;

  assert.throws(() => secure.decryptText('profile', JSON.stringify(envelope), baseAad), /AUTHENTICATION_FAILED/);
  assert.throws(() => secure.decryptText('profile', encrypted, { ...baseAad, userId: 'other-user' }), /AUTHENTICATION_FAILED/);
  assert.throws(() => secure.decryptText('profile', encrypted, { ...baseAad, fieldName: 'pronouns' }), /AUTHENTICATION_FAILED/);
  assert.throws(() => secure.decryptText('profile', encrypted, { ...baseAad, recordId: 'other-record' }), /AUTHENTICATION_FAILED/);
  assert.throws(() => secure.decryptText('profile', encrypted, { ...baseAad, service: 'other-service' }), /AUTHENTICATION_FAILED/);
  assert.throws(() => secure.decryptText('profile', encrypted, { ...baseAad, environment: 'staging' }), /AUTHENTICATION_FAILED/);
  assert.throws(() => secure.decryptText('settings', encrypted, { ...baseAad, encryptionDomain: 'settings' }), /DOMAIN_MISMATCH/);
  assert.throws(() => secure.decryptText('profile', JSON.stringify({ ...JSON.parse(encrypted), version: 2 }), baseAad), /VERSION_UNSUPPORTED/);
  assert.throws(() => secure.decryptText('profile', 'plaintext fallback', baseAad), /JSON_INVALID/);
  secure.destroy();
});

test('blind indexes are keyed, deterministic, and context separated', async () => {
  const secure = await storage();
  const first = secure.blindIndex('person@example.test', 'users.email');
  assert.equal(first, secure.blindIndex('person@example.test', 'users.email'));
  assert.notEqual(first, secure.blindIndex('person@example.test', 'other.lookup'));
  assert.doesNotMatch(first, /person|example/i);
  secure.destroy();
});

test('unexpected AAD and envelope fields, missing keys, and size violations are rejected', async () => {
  await assert.rejects(
    () => createSecureStorage({ masterKey: Buffer.alloc(31), environment: 'test', service: 'ids' }),
    /MASTER_KEY_INVALID/,
  );
  const secure = await storage();
  assert.throws(
    () => secure.encryptText('profile', 'value', { ...baseAad, extra: 'not-allowed' }),
    /AAD_FIELDS_INVALID/,
  );
  const encrypted = secure.encryptText('profile', 'value', baseAad);
  assert.throws(
    () => secure.decryptText('profile', JSON.stringify({ ...JSON.parse(encrypted), extra: true }), baseAad),
    /ENVELOPE_FIELDS_INVALID/,
  );
  assert.throws(() => secure.encryptText('profile', 'x'.repeat(1025), baseAad), /PLAINTEXT_TOO_LARGE/);
  secure.destroy();
});

test('secretstream backup chunks authenticate and require the final tag', async () => {
  const secure = await storage();
  const aad = { ...baseAad, encryptionDomain: 'backup', collection: 'backups', fieldName: 'archive' };
  const encryptor = secure.createSecretStreamEncryptor('backup', aad);
  const first = encryptor.push(Buffer.from('first-'));
  const second = encryptor.push(Buffer.from('second'), true);
  const decryptor = secure.createSecretStreamDecryptor('backup', encryptor.header, aad);
  const pulledFirst = decryptor.pull(first);
  const pulledSecond = decryptor.pull(second);
  assert.equal(pulledFirst.plaintext.toString(), 'first-');
  assert.equal(pulledFirst.final, false);
  assert.equal(pulledSecond.plaintext.toString(), 'second');
  assert.equal(pulledSecond.final, true);
  secure.destroy();
});

test('master-key loader rejects wrong length, symlinks, open permissions, and denied development keys', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'ridgeline-master-key-'));
  const keyDir = join(root, 'keys');
  const keyPath = join(keyDir, 'server-master-key');
  mkdirSync(keyDir, { mode: 0o700 });
  const key = randomBytes(32);
  writeFileSync(keyPath, key, { mode: 0o600 });
  assert.equal(loadServerMasterKey({ keyPath, environment: 'test' }).length, 32);

  chmodSync(keyPath, 0o644);
  assert.throws(() => loadServerMasterKey({ keyPath, environment: 'test' }), /PERMISSIONS_TOO_OPEN/);
  chmodSync(keyPath, 0o600);

  const linkPath = join(keyDir, 'linked-key');
  symlinkSync(keyPath, linkPath);
  assert.throws(() => loadServerMasterKey({ keyPath: linkPath, environment: 'test' }), /SYMLINK_REJECTED/);

  writeFileSync(keyPath, Buffer.alloc(31));
  assert.throws(() => loadServerMasterKey({ keyPath, environment: 'test' }), /LENGTH_INVALID/);
  key.fill(0);
});

test('Argon2id passwords verify and reject the wrong password', async () => {
  const hash = await hashPasswordArgon2id('synthetic-password-123', { environment: 'test' });
  assert.equal(isArgon2idHash(hash), true);
  assert.equal(await verifyPasswordArgon2id(hash, 'synthetic-password-123'), true);
  assert.equal(await verifyPasswordArgon2id(hash, 'wrong-password'), false);
  assert.equal(await argon2idHashNeedsUpgrade(hash, { environment: 'test' }), false);
});

test('master-key loader rejects missing, relative production, and denied development keys', () => {
  assert.throws(() => loadServerMasterKey({ keyPath: '', environment: 'test' }), /PATH_REQUIRED/);
  assert.throws(() => loadServerMasterKey({ keyPath: 'relative-master-key', environment: 'production' }), /MUST_BE_ABSOLUTE/);

  const root = mkdtempSync(join(tmpdir(), 'ridgeline-denied-key-'));
  const keyPath = join(root, 'server-master-key');
  const key = randomBytes(32);
  writeFileSync(keyPath, key);
  if (process.platform !== 'win32') chmodSync(keyPath, 0o600);
  const fingerprint = `sha256:${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
  assert.throws(
    () => loadServerMasterKey({ keyPath, environment: 'test', deniedFingerprints: fingerprint }),
    /DEVELOPMENT_MASTER_KEY_REJECTED/,
  );
  key.fill(0);
});
