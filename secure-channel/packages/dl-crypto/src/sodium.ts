/* ──────────────────────────────────────────────────────────
 *  Sodium initializer — all crypto modules import from here
 * ────────────────────────────────────────────────────────── */

import _sodium from 'libsodium-wrappers-sumo';

let ready = false;

export async function getSodium(): Promise<typeof _sodium> {
  if (!ready) {
    await _sodium.ready;
    ready = true;
  }
  return _sodium;
}

export async function initCrypto(): Promise<void> {
  await getSodium();
}
