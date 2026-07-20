/* ──────────────────────────────────────────────────────────
 *  Attachment encryption — AES-256-GCM via Web Crypto API
 *
 *  Each attachment gets a random 256-bit key + 96-bit IV.
 *  The key is stored on the Message.attachments[].key field
 *  and NEVER sent to any server — only shared inside the
 *  encrypted direct-message envelope (Double Ratchet). Group sending is disabled.
 *
 *  The ciphertext blob (encryptedData) is stored locally or
 *  uploaded to an untrusted relay — it's useless without the
 *  per-attachment key.
 * ────────────────────────────────────────────────────────── */

const ALG = 'AES-GCM';
const KEY_BITS = 256;
const IV_BYTES = 12;

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

/** Generate a random AES-256 key and return it as base64. Nonce is deferred to encrypt time (LOW-4). */
export async function generateAttachmentKey(): Promise<{ key: string; nonce: string }> {
  const k = await crypto.subtle.generateKey({ name: ALG, length: KEY_BITS }, true, ['encrypt', 'decrypt']);
  const rawKey = await crypto.subtle.exportKey('raw', k);
  return {
    key: toBase64(rawKey),
    nonce: '', // nonce generated fresh at encrypt time (LOW-4)
  };
}

/** Encrypt a file's ArrayBuffer. Generates a fresh nonce per encryption (LOW-4). Returns the ciphertext as a Blob and the nonce used. */
export async function encryptAttachment(
  plaintext: ArrayBuffer,
  keyB64: string,
  _nonceB64?: string,
): Promise<{ blob: Blob; nonce: string }> {
  const rawKey = fromBase64(keyB64);
  // LOW-4: Always generate a fresh nonce at encrypt time — never reuse
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await crypto.subtle.importKey('raw', rawKey.buffer as ArrayBuffer, ALG, false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: ALG, iv: iv.buffer as ArrayBuffer }, key, plaintext);
  return {
    blob: new Blob([ciphertext], { type: 'application/octet-stream' }),
    nonce: toBase64(iv),
  };
}

/** Decrypt a ciphertext Blob back to an ArrayBuffer. */
export async function decryptAttachment(
  ciphertext: ArrayBuffer,
  keyB64: string,
  nonceB64: string,
): Promise<ArrayBuffer> {
  const rawKey = fromBase64(keyB64);
  const iv = fromBase64(nonceB64);
  const key = await crypto.subtle.importKey('raw', rawKey.buffer as ArrayBuffer, ALG, false, ['decrypt']);
  return crypto.subtle.decrypt({ name: ALG, iv: iv.buffer as ArrayBuffer }, key, ciphertext);
}

/** Read a File object into an ArrayBuffer. */
export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/** Create a data URL from decrypted bytes + mimeType. */
export function toObjectUrl(data: ArrayBuffer, mimeType: string): string {
  return URL.createObjectURL(new Blob([data], { type: mimeType }));
}
