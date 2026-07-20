/* ──────────────────────────────────────────────────────────
 *  AEAD — XChaCha20-Poly1305 symmetric encryption
 * ────────────────────────────────────────────────────────── */

import { getSodium } from './sodium.js';
import { toBase64, fromBase64 } from './utils.js';
import type { Bytes, Envelope } from './types.js';

/** Encrypt bytes with XChaCha20-Poly1305. */
export async function encrypt(
  plaintext: Bytes,
  key: Bytes,
  ad?: Bytes,
): Promise<Envelope> {
  const sodium = await getSodium();
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    ad ?? null,
    null,
    nonce,
    key,
  );
  return {
    v: 1,
    alg: 'xchacha20-poly1305',
    nonce: toBase64(nonce),
    ct: toBase64(ciphertext),
    ...(ad ? { ad: toBase64(ad) } : {}),
  };
}

/** Decrypt an AEAD envelope. */
export async function decrypt(
  envelope: Envelope,
  key: Bytes,
): Promise<Bytes> {
  const sodium = await getSodium();
  const nonce = fromBase64(envelope.nonce);
  const ciphertext = fromBase64(envelope.ct);
  const ad = envelope.ad ? fromBase64(envelope.ad) : null;
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    ad,
    nonce,
    key,
  );
}

/** Encrypt a UTF-8 string. */
export async function encryptString(
  plaintext: string,
  key: Bytes,
  ad?: Bytes,
): Promise<Envelope> {
  const encoded = new TextEncoder().encode(plaintext);
  return encrypt(encoded, key, ad);
}

/** Decrypt to a UTF-8 string. */
export async function decryptString(
  envelope: Envelope,
  key: Bytes,
): Promise<string> {
  const decrypted = await decrypt(envelope, key);
  return new TextDecoder().decode(decrypted);
}

/** Generate a random 256-bit key. */
export async function generateKey(): Promise<Bytes> {
  const sodium = await getSodium();
  return sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
}
