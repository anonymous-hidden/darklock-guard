import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

function b64(u8) { return encodeBase64(u8); }
function fromb64(s) { return decodeBase64(s); }

/**
 * Encrypt a message with recipient's public key using X25519 + XSalsa20-Poly1305
 * Returns { nonce, ciphertext } all base64
 */
export async function encryptMessage(plaintext, recipientPublicKeyB64, senderPrivateKeyB64) {
  const recipientPk = fromb64(recipientPublicKeyB64);
  const senderSk = fromb64(senderPrivateKeyB64);
  const nonce = nacl.randomBytes(24);
  const messageBytes = new TextEncoder().encode(plaintext);

  const ciphertext = nacl.box(messageBytes, nonce, recipientPk, senderSk);

  senderSk.fill(0);

  return { nonce: b64(nonce), ciphertext: b64(ciphertext) };
}

/**
 * Decrypt a message from sender's public key
 */
export async function decryptMessage(encryptedPayload, senderPublicKeyB64, recipientPrivateKeyB64) {
  const senderPk = fromb64(senderPublicKeyB64);
  const recipientSk = fromb64(recipientPrivateKeyB64);
  const nonce = fromb64(encryptedPayload.nonce);
  const ciphertext = fromb64(encryptedPayload.ciphertext);

  const decrypted = nacl.box.open(ciphertext, nonce, senderPk, recipientSk);
  recipientSk.fill(0);

  if (!decrypted) throw new Error('Decryption failed');

  const plaintext = new TextDecoder().decode(decrypted);
  decrypted.fill(0);
  return plaintext;
}

/**
 * Encrypt message using a shared session key (symmetric, for ratcheted sessions)
 */
export async function encryptWithSessionKey(plaintext, sessionKeyB64) {
  const key = fromb64(sessionKeyB64);
  const nonce = nacl.randomBytes(24);
  const messageBytes = new TextEncoder().encode(plaintext);

  const ciphertext = nacl.secretbox(messageBytes, nonce, key);
  key.fill(0);

  return { nonce: b64(nonce), ciphertext: b64(ciphertext) };
}

/**
 * Decrypt message using a shared session key
 */
export async function decryptWithSessionKey(encryptedPayload, sessionKeyB64) {
  const key = fromb64(sessionKeyB64);
  const nonce = fromb64(encryptedPayload.nonce);
  const ciphertext = fromb64(encryptedPayload.ciphertext);

  const decrypted = nacl.secretbox.open(ciphertext, nonce, key);
  key.fill(0);

  if (!decrypted) throw new Error('Session key decryption failed');

  const plaintext = new TextDecoder().decode(decrypted);
  decrypted.fill(0);
  return plaintext;
}

