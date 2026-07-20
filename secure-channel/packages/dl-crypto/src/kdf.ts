/* ──────────────────────────────────────────────────────────
 *  Key Derivation — Argon2id master password → vault key
 * ────────────────────────────────────────────────────────── */

import { getSodium } from './sodium.js';
import type { Bytes, Base64, KdfParams } from './types.js';
import { DEFAULT_KDF_PARAMS } from './types.js';
import { toBase64, fromBase64 } from './utils.js';

export async function generateSalt(): Promise<Bytes> {
  const sodium = await getSodium();
  return sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES); // 16 bytes for Argon2id
}

export function createKdfParams(salt: Bytes): KdfParams {
  return { ...DEFAULT_KDF_PARAMS, salt: toBase64(salt) };
}

/**
 * Derive a 64-byte root key from master password.
 * First 32 bytes → encryption key, last 32 bytes → auth key.
 */
export async function deriveVaultKey(
  password: string,
  params: KdfParams,
): Promise<{ encryptionKey: Bytes; authKey: Bytes }> {
  const sodium = await getSodium();
  const salt = fromBase64(params.salt);
  const raw = sodium.crypto_pwhash(
    params.keyLength,
    password,
    salt,
    params.iterations,
    params.memoryBytes,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  const encryptionKey = raw.slice(0, 32);
  const authKey = raw.slice(32, 64);
  sodium.memzero(raw);
  return { encryptionKey, authKey };
}

/** Securely zero a key from memory. */
export async function zeroize(key: Bytes): Promise<void> {
  const sodium = await getSodium();
  sodium.memzero(key);
}

/** Hash auth key for server-side verification (BLAKE2b). */
export async function hashAuthKey(authKey: Bytes): Promise<Base64> {
  const sodium = await getSodium();
  const hash = sodium.crypto_generichash(32, authKey);
  return toBase64(hash);
}
