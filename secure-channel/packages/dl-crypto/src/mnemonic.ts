/* ──────────────────────────────────────────────────────────
 *  Mnemonic — BIP39-compatible recovery phrase generation
 *
 *  128 bits entropy → 12-word phrase (+ 4 checksum bits).
 *  Uses libsodium for entropy and BLAKE2b for checksum.
 *  Embeds the standard BIP39 English wordlist (2048 words).
 * ────────────────────────────────────────────────────────── */

import { getSodium } from './sodium.js';
import type { Bytes } from './types.js';

// BIP39 English wordlist (2048 words) — standard, publicly available
// Compressed: stored as a single newline-delimited string to save space
// Full list at https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt
import { WORDLIST } from './wordlist.js';

/**
 * Generate a 12-word recovery phrase from 128 bits of entropy.
 *
 * BIP39 process:
 *   1. Generate 128 random bits (16 bytes)
 *   2. Compute BLAKE2b-256 hash, take first 4 bits as checksum
 *   3. Append checksum to entropy → 132 bits
 *   4. Split into 12 × 11-bit indices → 12 words
 */
export async function generateMnemonic(): Promise<string> {
  const sodium = await getSodium();
  const entropy = sodium.randombytes_buf(16); // 128 bits
  return entropyToMnemonic(entropy);
}

/** Convert 16 bytes of entropy to a 12-word mnemonic. */
export async function entropyToMnemonic(entropy: Bytes): Promise<string> {
  if (entropy.length !== 16) throw new Error('Expected 16 bytes of entropy');

  const sodium = await getSodium();

  // Checksum: BLAKE2b-256 of entropy, take first byte
  const hash = sodium.crypto_generichash(32, entropy);
  const checksumBits = hash[0]; // we only need first 4 bits for 128-bit entropy

  // Convert entropy bytes to bit string
  let bits = '';
  for (const byte of entropy) {
    bits += byte.toString(2).padStart(8, '0');
  }
  // Append first 4 checksum bits (ENT/32 = 128/32 = 4)
  bits += checksumBits.toString(2).padStart(8, '0').slice(0, 4);

  // Split into 12 groups of 11 bits → word indices
  const words: string[] = [];
  for (let i = 0; i < 12; i++) {
    const index = parseInt(bits.slice(i * 11, (i + 1) * 11), 2);
    words.push(WORDLIST[index]);
  }

  return words.join(' ');
}

/** Validate a mnemonic phrase (correct word count + checksum). */
export async function validateMnemonic(phrase: string): Promise<boolean> {
  const words = phrase.trim().toLowerCase().split(/\s+/);
  if (words.length !== 12) return false;

  // Look up each word
  const indices: number[] = [];
  for (const word of words) {
    const idx = WORDLIST.indexOf(word);
    if (idx === -1) return false;
    indices.push(idx);
  }

  // Reconstruct bits
  let bits = '';
  for (const idx of indices) {
    bits += idx.toString(2).padStart(11, '0');
  }

  // Split into entropy (128 bits) + checksum (4 bits)
  const entropyBits = bits.slice(0, 128);
  const checksumBits = bits.slice(128, 132);

  // Convert entropy bits back to bytes
  const entropy = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    entropy[i] = parseInt(entropyBits.slice(i * 8, (i + 1) * 8), 2);
  }

  // Verify checksum
  const sodium = await getSodium();
  const hash = sodium.crypto_generichash(32, entropy);
  const expectedChecksum = hash[0].toString(2).padStart(8, '0').slice(0, 4);

  return checksumBits === expectedChecksum;
}

/** Convert a mnemonic phrase back to its 16-byte entropy. */
export async function mnemonicToEntropy(phrase: string): Promise<Bytes> {
  const valid = await validateMnemonic(phrase);
  if (!valid) throw new Error('Invalid mnemonic');

  const words = phrase.trim().toLowerCase().split(/\s+/);
  let bits = '';
  for (const word of words) {
    const idx = WORDLIST.indexOf(word);
    bits += idx.toString(2).padStart(11, '0');
  }

  const entropy = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    entropy[i] = parseInt(bits.slice(i * 8, (i + 1) * 8), 2);
  }
  return entropy;
}
