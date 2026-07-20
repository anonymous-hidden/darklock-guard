/* ──────────────────────────────────────────────────────────
 *  Mnemonic recovery phrase tests
 * ────────────────────────────────────────────────────────── */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  initCrypto,
  generateMnemonic,
  validateMnemonic,
  mnemonicToEntropy,
  entropyToMnemonic,
  deriveVaultKey,
  generateSalt,
  createKdfParams,
  encrypt,
  decrypt,
  toBase64,
} from '../index.js';

describe('Mnemonic recovery phrase', () => {
  beforeAll(async () => {
    await initCrypto();
  });

  it('generates a valid 12-word phrase', async () => {
    const phrase = await generateMnemonic();
    const words = phrase.split(' ');
    expect(words).toHaveLength(12);
    expect(await validateMnemonic(phrase)).toBe(true);
  });

  it('round-trips entropy ↔ mnemonic', async () => {
    const phrase = await generateMnemonic();
    const entropy = await mnemonicToEntropy(phrase);
    expect(entropy).toHaveLength(16);

    const regenerated = await entropyToMnemonic(entropy);
    expect(regenerated).toBe(phrase);
  });

  it('rejects clearly invalid phrases', async () => {
    expect(await validateMnemonic('not a valid mnemonic phrase at all foo bar')).toBe(false);
    expect(await validateMnemonic('abandon abandon abandon')).toBe(false); // too short
    expect(await validateMnemonic('zzz zzz zzz zzz zzz zzz zzz zzz zzz zzz zzz zzz')).toBe(false); // invalid words
    // Our own generated phrase should validate
    const phrase = await generateMnemonic();
    expect(await validateMnemonic(phrase)).toBe(true);
  });

  it('different phrases produce different entropy', async () => {
    const phrase1 = await generateMnemonic();
    const phrase2 = await generateMnemonic();
    expect(phrase1).not.toBe(phrase2);

    const e1 = await mnemonicToEntropy(phrase1);
    const e2 = await mnemonicToEntropy(phrase2);
    expect(toBase64(e1)).not.toBe(toBase64(e2));
  });

  it('phrase → Argon2id → recovery key can encrypt/decrypt', async () => {
    const phrase = await generateMnemonic();

    // Derive a recovery key from the phrase (same as Onboarding would)
    const salt = await generateSalt();
    const kdfParams = createKdfParams(salt);
    const { encryptionKey: recoveryKey } = await deriveVaultKey(phrase, kdfParams);
    expect(recoveryKey).toHaveLength(32);

    // Encrypt some data with the recovery key
    const secretData = new TextEncoder().encode('identity-key-material');
    const envelope = await encrypt(secretData, recoveryKey);

    // Re-derive the same recovery key from the phrase
    const { encryptionKey: recoveryKey2 } = await deriveVaultKey(phrase, kdfParams);
    const decrypted = await decrypt(envelope, recoveryKey2);
    expect(new TextDecoder().decode(decrypted)).toBe('identity-key-material');
  });
});
