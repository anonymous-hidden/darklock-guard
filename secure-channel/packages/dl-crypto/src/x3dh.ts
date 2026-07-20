/* ──────────────────────────────────────────────────────────
 *  X3DH — Extended Triple Diffie-Hellman key agreement
 *  Establishes a shared secret between two parties using
 *  identity keys, signed pre-keys, and one-time pre-keys.
 * ────────────────────────────────────────────────────────── */

import { getSodium } from './sodium.js';
import { toBase64, fromBase64 } from './utils.js';
import { ed25519PubToX25519, ed25519SecToX25519, generateX25519KeyPair, verify } from './identity.js';
import type { Bytes, Base64, PreKeyBundle, X3DHHeader, X25519KeyPair } from './types.js';

const INFO_X3DH = new TextEncoder().encode('DarkLock-X3DH-v1');

/** Scalar Diffie-Hellman: shared = X25519(secret, public). */
async function dh(secret: Bytes, pub: Bytes): Promise<Bytes> {
  const sodium = await getSodium();
  return sodium.crypto_scalarmult(secret, pub);
}

/** Concatenate multiple Uint8Arrays. */
function concat(...arrays: Bytes[]): Bytes {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/** KDF over the X3DH DH outputs → 64-byte master secret (32 root + 32 chain). */
async function x3dhKdf(dhResults: Bytes[]): Promise<Bytes> {
  const sodium = await getSodium();
  // HKDF-like: BLAKE2b keyed with INFO over all DH results
  const input = concat(...dhResults);
  return sodium.crypto_generichash(64, input, INFO_X3DH);
}

export interface X3DHSenderResult {
  header: X3DHHeader;
  rootKey: Bytes;        // First 32 bytes — feed into Double Ratchet
  chainKey: Bytes;       // Last 32 bytes — initial chain key
}

export interface X3DHReceiverResult {
  rootKey: Bytes;
  chainKey: Bytes;
}

/**
 * Sender side of X3DH.
 * Alice fetches Bob's pre-key bundle and computes:
 *   DH1 = DH(Alice_IK, Bob_SPK)
 *   DH2 = DH(Alice_EK, Bob_IK)
 *   DH3 = DH(Alice_EK, Bob_SPK)
 *   DH4 = DH(Alice_EK, Bob_OPK)  — optional
 */
export async function x3dhSender(
  localIdentityPub: Bytes,
  localIdentitySecret: Bytes, // Ed25519 secret
  bundle: PreKeyBundle,
): Promise<X3DHSenderResult> {
  const sodium = await getSodium();

  // Verify the signed pre-key signature
  const spkPub = fromBase64(bundle.signedPreKey.publicKey);
  const spkSig = fromBase64(bundle.signedPreKey.signature);
  const remoteIdPub = fromBase64(bundle.identityKey);
  const valid = await verify(spkSig, spkPub, remoteIdPub);
  if (!valid) throw new Error('Invalid signed pre-key signature');

  // Convert identity keys to X25519
  const localIkX = await ed25519SecToX25519(localIdentitySecret);
  const remoteIkX = await ed25519PubToX25519(remoteIdPub);

  // Generate ephemeral key
  const ephemeral = await generateX25519KeyPair();

  // Compute DH values
  const dh1 = await dh(localIkX, spkPub);      // IK_a × SPK_b
  const dh2 = await dh(ephemeral.secretKey, remoteIkX); // EK_a × IK_b
  const dh3 = await dh(ephemeral.secretKey, spkPub);    // EK_a × SPK_b

  const dhResults = [dh1, dh2, dh3];

  // Use one-time pre-key if available
  let usedOPKId: number | undefined;
  if (bundle.oneTimePreKeys.length > 0) {
    const opk = bundle.oneTimePreKeys[0];
    const opkPub = fromBase64(opk.publicKey);
    const dh4 = await dh(ephemeral.secretKey, opkPub); // EK_a × OPK_b
    dhResults.push(dh4);
    usedOPKId = opk.keyId;
    sodium.memzero(dh4);
  }

  const masterSecret = await x3dhKdf(dhResults);

  // Clean up DH intermediates
  sodium.memzero(dh1);
  sodium.memzero(dh2);
  sodium.memzero(dh3);
  sodium.memzero(localIkX);
  sodium.memzero(ephemeral.secretKey);

  const header: X3DHHeader = {
    identityKey: toBase64(localIdentityPub),
    ephemeralKey: toBase64(ephemeral.publicKey),
    signedPreKeyId: bundle.signedPreKey.keyId,
    ...(usedOPKId !== undefined ? { usedOneTimeKeyId: usedOPKId } : {}),
  };

  return {
    header,
    rootKey: masterSecret.slice(0, 32),
    chainKey: masterSecret.slice(32, 64),
  };
}

/**
 * Receiver side of X3DH.
 * Bob receives Alice's X3DH header and computes the same shared secret.
 */
export async function x3dhReceiver(
  localIdentityPub: Bytes,
  localIdentitySecret: Bytes, // Ed25519 secret
  spkSecret: Bytes,           // Signed pre-key X25519 secret
  opkSecrets: Map<number, Bytes>,
  header: X3DHHeader,
): Promise<X3DHReceiverResult> {
  const sodium = await getSodium();

  const remoteIdPub = fromBase64(header.identityKey);
  const remoteEphPub = fromBase64(header.ephemeralKey);

  // Convert identity keys to X25519
  const localIkX = await ed25519SecToX25519(localIdentitySecret);
  const remoteIkX = await ed25519PubToX25519(remoteIdPub);

  // Mirror DH computations (reversed roles)
  const dh1 = await dh(spkSecret, remoteIkX);           // SPK_b × IK_a
  const dh2 = await dh(localIkX, remoteEphPub);         // IK_b × EK_a
  const dh3 = await dh(spkSecret, remoteEphPub);        // SPK_b × EK_a

  const dhResults = [dh1, dh2, dh3];

  if (header.usedOneTimeKeyId !== undefined) {
    const opkSec = opkSecrets.get(header.usedOneTimeKeyId);
    if (!opkSec) throw new Error('One-time pre-key not found');
    const dh4 = await dh(opkSec, remoteEphPub);         // OPK_b × EK_a
    dhResults.push(dh4);
    sodium.memzero(dh4);
    // Delete used OPK
    opkSecrets.delete(header.usedOneTimeKeyId);
  }

  const masterSecret = await x3dhKdf(dhResults);

  sodium.memzero(dh1);
  sodium.memzero(dh2);
  sodium.memzero(dh3);
  sodium.memzero(localIkX);

  return {
    rootKey: masterSecret.slice(0, 32),
    chainKey: masterSecret.slice(32, 64),
  };
}
