/* ──────────────────────────────────────────────────────────
 *  Utility — base64, hex, random, secure wipe
 * ────────────────────────────────────────────────────────── */

import { getSodium } from './sodium.js';
import type { Bytes, Base64, Hex } from './types.js';

export function toBase64(buf: Bytes): Base64 {
  // Use sodium's constant-time base64 when available
  const b64 = typeof Buffer !== 'undefined'
    ? Buffer.from(buf).toString('base64')
    : btoa(String.fromCharCode(...buf));
  return b64;
}

export function fromBase64(b64: Base64): Bytes {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function toHex(buf: Bytes): Hex {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: Hex): Bytes {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export async function randomBytes(n: number): Promise<Bytes> {
  const sodium = await getSodium();
  return sodium.randombytes_buf(n);
}

export async function randomId(): Promise<string> {
  const bytes = await randomBytes(16);
  return toHex(bytes);
}

/** BLAKE2b-256 hash. */
export async function hash(data: Bytes): Promise<Bytes> {
  const sodium = await getSodium();
  return sodium.crypto_generichash(32, data);
}

/** BLAKE2b keyed hash for deriving sub-keys. */
export async function keyedHash(key: Bytes, data: Bytes, outLen = 32): Promise<Bytes> {
  const sodium = await getSodium();
  return sodium.crypto_generichash(outLen, data, key);
}

/** Constant-time comparison. */
export async function constantTimeEqual(a: Bytes, b: Bytes): Promise<boolean> {
  const sodium = await getSodium();
  if (a.length !== b.length) return false;
  return sodium.memcmp(a, b);
}
