/* ──────────────────────────────────────────────────────────
 *  Identity — Ed25519 signing + X25519 key exchange pairs
 * ────────────────────────────────────────────────────────── */

import { getSodium } from './sodium.js';
import { toBase64 } from './utils.js';
import type { Bytes, Base64, IdentityKeyPair, X25519KeyPair, SignedPreKey, OneTimePreKey, PreKeyBundle } from './types.js';

/** Generate a long-term Ed25519 identity key pair. */
export async function generateIdentityKey(): Promise<IdentityKeyPair> {
  const sodium = await getSodium();
  const kp = sodium.crypto_sign_keypair();
  return { publicKey: kp.publicKey, secretKey: kp.privateKey };
}

/** Generate an X25519 key pair for Diffie-Hellman. */
export async function generateX25519KeyPair(): Promise<X25519KeyPair> {
  const sodium = await getSodium();
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, secretKey: kp.privateKey };
}

/** Convert Ed25519 public key to X25519 for DH. */
export async function ed25519PubToX25519(edPub: Bytes): Promise<Bytes> {
  const sodium = await getSodium();
  return sodium.crypto_sign_ed25519_pk_to_curve25519(edPub);
}

/** Convert Ed25519 secret key to X25519 for DH. */
export async function ed25519SecToX25519(edSec: Bytes): Promise<Bytes> {
  const sodium = await getSodium();
  return sodium.crypto_sign_ed25519_sk_to_curve25519(edSec);
}

/** Sign data with Ed25519. */
export async function sign(data: Bytes, secretKey: Bytes): Promise<Bytes> {
  const sodium = await getSodium();
  return sodium.crypto_sign_detached(data, secretKey);
}

/** Verify Ed25519 signature. */
export async function verify(signature: Bytes, data: Bytes, publicKey: Bytes): Promise<boolean> {
  const sodium = await getSodium();
  return sodium.crypto_sign_verify_detached(signature, data, publicKey);
}

/** Create a signed pre-key: X25519 pair signed by identity key. */
export async function createSignedPreKey(
  identitySecret: Bytes,
  keyId: number,
): Promise<{ spk: SignedPreKey; secretKey: Bytes }> {
  const kp = await generateX25519KeyPair();
  const pubB64 = toBase64(kp.publicKey);
  const sig = await sign(kp.publicKey, identitySecret);
  return {
    spk: {
      keyId,
      publicKey: pubB64,
      signature: toBase64(sig),
      createdAt: Date.now(),
    },
    secretKey: kp.secretKey,
  };
}

/** Generate a batch of one-time pre-keys. */
export async function generateOneTimePreKeys(
  startId: number,
  count: number,
): Promise<{ keys: OneTimePreKey[]; secrets: Map<number, Bytes> }> {
  const keys: OneTimePreKey[] = [];
  const secrets = new Map<number, Bytes>();
  for (let i = 0; i < count; i++) {
    const kp = await generateX25519KeyPair();
    const keyId = startId + i;
    keys.push({ keyId, publicKey: toBase64(kp.publicKey) });
    secrets.set(keyId, kp.secretKey);
  }
  return { keys, secrets };
}

/** Build a pre-key bundle for upload to IDS. */
export function buildPreKeyBundle(
  identityPub: Bytes,
  spk: SignedPreKey,
  otpks: OneTimePreKey[],
): PreKeyBundle {
  return {
    identityKey: toBase64(identityPub),
    signedPreKey: spk,
    oneTimePreKeys: otpks,
  };
}

/** Compute safety number for contact verification (truncated BLAKE2b of both identity keys). */
export async function computeSafetyNumber(
  localIdentityPub: Bytes,
  remoteIdentityPub: Bytes,
): Promise<string> {
  const sodium = await getSodium();
  // Sort deterministically to ensure both sides get the same number
  // DARK-002: Use full lexicographic comparison, not just first byte
  const [a, b] = (() => {
    for (let i = 0; i < Math.min(localIdentityPub.length, remoteIdentityPub.length); i++) {
      if (localIdentityPub[i] < remoteIdentityPub[i]) return [localIdentityPub, remoteIdentityPub];
      if (localIdentityPub[i] > remoteIdentityPub[i]) return [remoteIdentityPub, localIdentityPub];
    }
    return localIdentityPub.length <= remoteIdentityPub.length
      ? [localIdentityPub, remoteIdentityPub]
      : [remoteIdentityPub, localIdentityPub];
  })();

  const combined = new Uint8Array(a.length + b.length);
  combined.set(a, 0);
  combined.set(b, a.length);
  const hash = sodium.crypto_generichash(30, combined);
  // Format as 12 groups of 5 digits
  const nums: string[] = [];
  for (let i = 0; i < 12; i++) {
    const val = ((hash[i * 2] || 0) << 8 | (hash[i * 2 + 1] || 0)) % 100000;
    nums.push(val.toString().padStart(5, '0'));
  }
  return nums.join(' ');
}
