import { createHmac, hkdfSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { fingerprintKey } from './master-key.js';

const require = createRequire(import.meta.url);
const sodium = require('libsodium-wrappers-sumo');

export const ENVELOPE_VERSION = 1;
export const ENVELOPE_ALGORITHM = 'xchacha20-poly1305';
export const SECRETSTREAM_ALGORITHM = 'xchacha20-poly1305-secretstream';

export const KEY_DOMAINS = Object.freeze({
  authentication: 'ridgeline-authentication-v1',
  profile: 'ridgeline-profile-v1',
  settings: 'ridgeline-settings-v1',
  sync: 'ridgeline-sync-v1',
  integrations: 'ridgeline-integrations-v1',
  media: 'ridgeline-media-v1',
  audit: 'ridgeline-audit-v1',
  backup: 'ridgeline-backup-v1',
  blindIndex: 'ridgeline-blind-index-v1',
});

const AAD_FIELDS = Object.freeze([
  'application',
  'environment',
  'service',
  'encryptionDomain',
  'userId',
  'collection',
  'recordId',
  'fieldName',
  'schemaVersion',
]);

const ENVELOPE_FIELDS = Object.freeze([
  'version',
  'algorithm',
  'keyDomain',
  'nonce',
  'ciphertext',
]);

const DEFAULT_MAX_PLAINTEXT_BYTES = 16 * 1024 * 1024;
const HKDF_SALT = Buffer.from('ridgeline-secure-storage-hkdf-sha256-v1', 'utf8');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function assertExactKeys(value, expected, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code);
  }
}

function validateText(value, field, max = 256) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u001f]/.test(value)) {
    fail(`RIDGELINE_AAD_${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function canonicalAad(domain, input) {
  assertExactKeys(input, AAD_FIELDS, 'RIDGELINE_AAD_FIELDS_INVALID');
  if (input.application !== 'ridgeline') fail('RIDGELINE_AAD_APPLICATION_INVALID');
  if (!['development', 'test', 'staging', 'production'].includes(input.environment)) {
    fail('RIDGELINE_AAD_ENVIRONMENT_INVALID');
  }
  if (input.encryptionDomain !== domain) fail('RIDGELINE_AAD_DOMAIN_INVALID');
  if (input.schemaVersion !== 1) fail('RIDGELINE_AAD_SCHEMA_VERSION_INVALID');

  const canonical = {
    application: input.application,
    environment: input.environment,
    service: validateText(input.service, 'service', 64),
    encryptionDomain: input.encryptionDomain,
    userId: validateText(input.userId, 'user_id'),
    collection: validateText(input.collection, 'collection', 128),
    recordId: validateText(input.recordId, 'record_id'),
    fieldName: validateText(input.fieldName, 'field_name', 128),
    schemaVersion: input.schemaVersion,
  };
  return Buffer.from(JSON.stringify(canonical), 'utf8');
}

function encode(bytes) {
  return sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
}

function decode(value, code, expectedLength = null) {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) fail(code);
  let decoded;
  try {
    decoded = sodium.from_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
  } catch {
    fail(code);
  }
  if (expectedLength !== null && decoded.length !== expectedLength) fail(code);
  return decoded;
}

function parseEnvelope(serialized, maxCiphertextBytes) {
  if (typeof serialized !== 'string' || serialized.length > Math.ceil(maxCiphertextBytes * 1.5) + 1024) {
    fail('RIDGELINE_ENVELOPE_SIZE_INVALID');
  }
  let envelope;
  try {
    envelope = JSON.parse(serialized);
  } catch {
    fail('RIDGELINE_ENVELOPE_JSON_INVALID');
  }
  assertExactKeys(envelope, ENVELOPE_FIELDS, 'RIDGELINE_ENVELOPE_FIELDS_INVALID');
  if (envelope.version !== ENVELOPE_VERSION) fail('RIDGELINE_ENVELOPE_VERSION_UNSUPPORTED');
  if (envelope.algorithm !== ENVELOPE_ALGORITHM) fail('RIDGELINE_ENVELOPE_ALGORITHM_UNSUPPORTED');
  if (!Object.hasOwn(KEY_DOMAINS, envelope.keyDomain) || envelope.keyDomain === 'blindIndex') {
    fail('RIDGELINE_ENVELOPE_DOMAIN_INVALID');
  }
  return envelope;
}

export async function createSecureStorage(options) {
  if (!options?.masterKey || !Buffer.isBuffer(options.masterKey) || options.masterKey.length !== 32) {
    fail('RIDGELINE_MASTER_KEY_INVALID');
  }
  await sodium.ready;

  const masterKey = Buffer.from(options.masterKey);
  const keyFingerprint = fingerprintKey(masterKey);
  const environment = options.environment ?? 'production';
  const service = options.service ?? 'ids';
  const maxPlaintextBytes = options.maxPlaintextBytes ?? DEFAULT_MAX_PLAINTEXT_BYTES;
  if (!Number.isSafeInteger(maxPlaintextBytes) || maxPlaintextBytes < 1) {
    masterKey.fill(0);
    fail('RIDGELINE_MAX_PLAINTEXT_INVALID');
  }

  const keys = new Map();
  try {
    for (const [domain, info] of Object.entries(KEY_DOMAINS)) {
      const key = Buffer.from(hkdfSync('sha256', masterKey, HKDF_SALT, Buffer.from(info, 'utf8'), 32));
      keys.set(domain, key);
    }
  } finally {
    masterKey.fill(0);
    options.masterKey.fill(0);
  }

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) fail('RIDGELINE_SECURE_STORAGE_DESTROYED');
  };
  const getKey = (domain) => {
    assertActive();
    const key = keys.get(domain);
    if (!key) fail('RIDGELINE_KEY_DOMAIN_INVALID');
    return key;
  };

  function bindAad(domain, aad) {
    return canonicalAad(domain, {
      ...aad,
      application: aad?.application ?? 'ridgeline',
      environment: aad?.environment ?? environment,
      service: aad?.service ?? service,
      encryptionDomain: aad?.encryptionDomain ?? domain,
      schemaVersion: aad?.schemaVersion ?? 1,
    });
  }

  function encryptBytes(domain, plaintext, aad) {
    const bytes = plaintext instanceof Uint8Array ? plaintext : Buffer.from(plaintext ?? []);
    if (bytes.length > maxPlaintextBytes) fail('RIDGELINE_PLAINTEXT_TOO_LARGE');
    const key = getKey(domain);
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const aadBytes = bindAad(domain, aad);
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      bytes,
      aadBytes,
      null,
      nonce,
      key,
    );
    return JSON.stringify({
      version: ENVELOPE_VERSION,
      algorithm: ENVELOPE_ALGORITHM,
      keyDomain: domain,
      nonce: encode(nonce),
      ciphertext: encode(ciphertext),
    });
  }

  function decryptBytes(domain, serialized, aad) {
    const envelope = parseEnvelope(serialized, maxPlaintextBytes + sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES);
    if (envelope.keyDomain !== domain) fail('RIDGELINE_ENVELOPE_DOMAIN_MISMATCH');
    const nonce = decode(
      envelope.nonce,
      'RIDGELINE_ENVELOPE_NONCE_INVALID',
      sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
    );
    const ciphertext = decode(envelope.ciphertext, 'RIDGELINE_ENVELOPE_CIPHERTEXT_INVALID');
    if (ciphertext.length < sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES
      || ciphertext.length > maxPlaintextBytes + sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES) {
      fail('RIDGELINE_ENVELOPE_CIPHERTEXT_SIZE_INVALID');
    }
    try {
      return Buffer.from(sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        ciphertext,
        bindAad(domain, aad),
        nonce,
        getKey(domain),
      ));
    } catch {
      fail('RIDGELINE_ENVELOPE_AUTHENTICATION_FAILED');
    }
  }

  function encryptText(domain, plaintext, aad) {
    if (typeof plaintext !== 'string') fail('RIDGELINE_PLAINTEXT_TYPE_INVALID');
    return encryptBytes(domain, Buffer.from(plaintext, 'utf8'), aad);
  }

  function decryptText(domain, serialized, aad) {
    return decryptBytes(domain, serialized, aad).toString('utf8');
  }

  function blindIndex(value, context = '') {
    if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
      fail('RIDGELINE_BLIND_INDEX_VALUE_INVALID');
    }
    if (typeof context !== 'string' || context.length > 128) fail('RIDGELINE_BLIND_INDEX_CONTEXT_INVALID');
    return createHmac('sha256', getKey('blindIndex'))
      .update('ridgeline-blind-index-v1\0', 'utf8')
      .update(context, 'utf8')
      .update('\0', 'utf8')
      .update(value, 'utf8')
      .digest('base64url');
  }

  function createSecretStreamEncryptor(domain, aad) {
    if (domain !== 'backup' && domain !== 'media') fail('RIDGELINE_SECRETSTREAM_DOMAIN_INVALID');
    const aadBytes = bindAad(domain, aad);
    const initialized = sodium.crypto_secretstream_xchacha20poly1305_init_push(getKey(domain));
    let finalized = false;
    return {
      header: encode(initialized.header),
      push(chunk, final = false) {
        if (finalized) fail('RIDGELINE_SECRETSTREAM_ALREADY_FINALIZED');
        const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk ?? []);
        const tag = final
          ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
          : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
        const ciphertext = sodium.crypto_secretstream_xchacha20poly1305_push(
          initialized.state,
          bytes,
          aadBytes,
          tag,
        );
        if (final) finalized = true;
        return Buffer.from(ciphertext);
      },
    };
  }

  function createSecretStreamDecryptor(domain, header, aad) {
    if (domain !== 'backup' && domain !== 'media') fail('RIDGELINE_SECRETSTREAM_DOMAIN_INVALID');
    const decodedHeader = decode(
      header,
      'RIDGELINE_SECRETSTREAM_HEADER_INVALID',
      sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES,
    );
    const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(decodedHeader, getKey(domain));
    const aadBytes = bindAad(domain, aad);
    let finalized = false;
    return {
      pull(chunk) {
        if (finalized) fail('RIDGELINE_SECRETSTREAM_ALREADY_FINALIZED');
        let result;
        try {
          result = sodium.crypto_secretstream_xchacha20poly1305_pull(state, chunk, aadBytes);
        } catch {
          fail('RIDGELINE_SECRETSTREAM_AUTHENTICATION_FAILED');
        }
        if (!result) fail('RIDGELINE_SECRETSTREAM_AUTHENTICATION_FAILED');
        const final = result.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL;
        if (final) finalized = true;
        return { plaintext: Buffer.from(result.message), final };
      },
    };
  }

  return Object.freeze({
    environment,
    service,
    keyFingerprint,
    encryptBytes,
    decryptBytes,
    encryptText,
    decryptText,
    blindIndex,
    createSecretStreamEncryptor,
    createSecretStreamDecryptor,
    isEncryptedRecord(value) {
      try {
        parseEnvelope(value, maxPlaintextBytes + sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES);
        return true;
      } catch {
        return false;
      }
    },
    destroy() {
      if (destroyed) return;
      for (const key of keys.values()) key.fill(0);
      keys.clear();
      destroyed = true;
    },
  });
}
