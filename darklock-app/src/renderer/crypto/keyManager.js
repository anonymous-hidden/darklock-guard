import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

// --- helpers ----------------------------------------------------------------

function b64(u8) { return encodeBase64(u8); }
function fromb64(s) { return decodeBase64(s); }

async function pbkdf2(password, salt, keyLen = 32) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 200_000, hash: 'SHA-256' },
    keyMaterial, keyLen * 8
  );
  return new Uint8Array(bits);
}

async function sha256(data) {
  const buf = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(buf);
}

function zero(arr) { if (arr) arr.fill(0); }

// ---------------------------------------------------------------------------

/**
 * Generate an X25519 keypair for identity (long-term)
 */
export async function generateIdentityKeypair() {
  const kp = nacl.box.keyPair();
  return { publicKey: b64(kp.publicKey), privateKey: b64(kp.secretKey) };
}

/**
 * Generate an ephemeral X25519 keypair for PFS sessions
 */
export async function generateEphemeralKeypair() {
  const kp = nacl.box.keyPair();
  return { publicKey: b64(kp.publicKey), privateKey: b64(kp.secretKey) };
}

/**
 * Encrypt private key with password-derived key for storage on server
 */
export async function encryptPrivateKey(privateKeyB64, password) {
  const salt = nacl.randomBytes(16);
  const key = await pbkdf2(password, salt);
  const nonce = nacl.randomBytes(24);
  const privateKeyBytes = fromb64(privateKeyB64);
  const ciphertext = nacl.secretbox(privateKeyBytes, nonce, key);

  zero(key);
  zero(privateKeyBytes);

  const blob = new Uint8Array(salt.length + nonce.length + ciphertext.length);
  blob.set(salt);
  blob.set(nonce, salt.length);
  blob.set(ciphertext, salt.length + nonce.length);
  return b64(blob);
}

/**
 * Decrypt private key using password-derived key
 */
export async function decryptPrivateKey(encryptedBlob, password) {
  const data = fromb64(encryptedBlob);
  const salt = data.slice(0, 16);
  const nonce = data.slice(16, 40);
  const ciphertext = data.slice(40);

  const key = await pbkdf2(password, salt);
  const privateKeyBytes = nacl.secretbox.open(ciphertext, nonce, key);
  zero(key);

  if (!privateKeyBytes) throw new Error('Decryption failed — wrong password');

  const result = b64(privateKeyBytes);
  zero(privateKeyBytes);
  return result;
}

/**
 * Derive password hash for sending to server (never send raw password)
 */
export async function hashPasswordForServer(password, username) {
  const enc = new TextEncoder();
  // Deterministic salt from username
  const saltInput = enc.encode('darklock-salt:' + username);
  const salt = (await sha256(saltInput)).slice(0, 16);
  const hash = await pbkdf2(password, salt);
  const result = b64(hash);
  zero(hash);
  return result;
}

/**
 * Hash username for server (username never stored in plaintext)
 */
export async function hashUsername(username) {
  const enc = new TextEncoder();
  return b64(await sha256(enc.encode(username)));
}

/**
 * Compute key fingerprint for display
 */
export async function getKeyFingerprint(publicKeyB64) {
  const bytes = fromb64(publicKeyB64);
  const hash = await sha256(bytes);
  return Array.from(hash.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(':');
}

export function secureZero(arr) { zero(arr); }
