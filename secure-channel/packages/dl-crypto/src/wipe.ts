/* ──────────────────────────────────────────────────────────
 *  Wipe — secure memory zeroing
 * ────────────────────────────────────────────────────────── */

import { getSodium } from './sodium.js';
import type { Bytes } from './types.js';

/** Zero-fill a Uint8Array using sodium.memzero for constant-time operation. */
export async function wipe(buf: Bytes): Promise<void> {
  const sodium = await getSodium();
  sodium.memzero(buf);
}

/** Zero-fill multiple buffers. */
export async function wipeAll(...bufs: (Bytes | null | undefined)[]): Promise<void> {
  const sodium = await getSodium();
  for (const buf of bufs) {
    if (buf && buf.length > 0) sodium.memzero(buf);
  }
}
