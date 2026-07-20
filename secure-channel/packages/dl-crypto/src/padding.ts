/* ──────────────────────────────────────────────────────────
 *  Padding — fixed-size message padding to defeat traffic
 *  analysis. All messages padded to one of several bucket
 *  sizes so an observer cannot infer content length.
 * ────────────────────────────────────────────────────────── */

import { getSodium } from './sodium.js';
import type { Bytes } from './types.js';

// Bucket sizes in bytes — messages are padded to the next bucket
const BUCKETS = [64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];

function nextBucket(len: number): number {
  for (const b of BUCKETS) {
    if (len + 4 <= b) return b; // +4 for the length prefix
  }
  // For very large messages, round up to next 64KB boundary
  return Math.ceil((len + 4) / 65536) * 65536;
}

/** Pad a message to a fixed bucket size. Format: [4-byte LE length][plaintext][random padding]. */
export async function pad(plaintext: Bytes): Promise<Bytes> {
  const sodium = await getSodium();
  const targetLen = nextBucket(plaintext.length);
  const padded = new Uint8Array(targetLen);

  // First 4 bytes: little-endian length of actual plaintext
  const view = new DataView(padded.buffer);
  view.setUint32(0, plaintext.length, true);

  // Copy plaintext after length prefix
  padded.set(plaintext, 4);

  // Fill remainder with random bytes (not zeros — defeats analysis)
  const padding = sodium.randombytes_buf(targetLen - 4 - plaintext.length);
  padded.set(padding, 4 + plaintext.length);

  return padded;
}

/** Remove padding and extract original plaintext. */
export function unpad(padded: Bytes): Bytes {
  if (padded.length < 4) throw new Error('Invalid padded message');
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  const len = view.getUint32(0, true);
  if (len > padded.length - 4) throw new Error('Invalid padding length');
  return padded.slice(4, 4 + len);
}
