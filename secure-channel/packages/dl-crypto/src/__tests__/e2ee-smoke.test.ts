/* ──────────────────────────────────────────────────────────
 *  Two-client E2EE Smoke Test
 *
 *  Simulates Alice ↔ Bob full flow:
 *    1. Both generate identity keys + pre-key bundles
 *    2. Alice performs X3DH sender with Bob's bundle
 *    3. Bob performs X3DH receiver with Alice's header
 *    4. Both init Double Ratchet
 *    5. Messages encrypted/decrypted in both directions
 *    6. OPK consumed correctly
 * ────────────────────────────────────────────────────────── */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  initCrypto,
  generateIdentityKey,
  createSignedPreKey,
  generateOneTimePreKeys,
  buildPreKeyBundle,
  x3dhSender,
  x3dhReceiver,
  initSenderRatchet,
  initReceiverRatchet,
  ratchetEncrypt,
  ratchetDecrypt,
  serializeRatchetState,
  pad,
  unpad,
  toBase64,
  fromBase64,
  wipe,
  type PreKeyBundle,
  type X25519KeyPair,
} from '../index.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe('Two-client E2EE smoke test', () => {
  beforeAll(async () => {
    await initCrypto();
  });

  it('Alice → Bob: full X3DH + Double Ratchet round trip', async () => {
    // ── 1. Key generation ────────────────────────────────

    // Alice
    const aliceIK = await generateIdentityKey();
    const { spk: aliceSPK, secretKey: aliceSPKSecret } = await createSignedPreKey(aliceIK.secretKey, 1);
    const { keys: aliceOTPKs, secrets: aliceOTPKSecrets } = await generateOneTimePreKeys(1, 5);

    // Bob
    const bobIK = await generateIdentityKey();
    const { spk: bobSPK, secretKey: bobSPKSecret } = await createSignedPreKey(bobIK.secretKey, 1);
    const { keys: bobOTPKs, secrets: bobOTPKSecrets } = await generateOneTimePreKeys(1, 5);

    // ── 2. Build Bob's pre-key bundle (as Alice would fetch) ──
    const bobBundle: PreKeyBundle = buildPreKeyBundle(
      bobIK.publicKey,
      bobSPK,
      bobOTPKs,
    );

    // ── 3. Alice: X3DH sender ────────────────────────────
    const { header, rootKey: aliceRootKey, chainKey: aliceChainKey } = await x3dhSender(
      aliceIK.publicKey,
      aliceIK.secretKey,
      bobBundle,
    );

    expect(header.signedPreKeyId).toBe(1);
    expect(header.usedOneTimeKeyId).toBe(1); // First OPK
    expect(header.identityKey).toBe(toBase64(aliceIK.publicKey));

    // ── 4. Bob: X3DH receiver ────────────────────────────
    const { rootKey: bobRootKey, chainKey: bobChainKey } = await x3dhReceiver(
      bobIK.publicKey,
      bobIK.secretKey,
      bobSPKSecret,
      bobOTPKSecrets,
      header,
    );

    // Root keys should match — this proves X3DH agreement
    expect(toBase64(aliceRootKey)).toBe(toBase64(bobRootKey));
    expect(toBase64(aliceChainKey)).toBe(toBase64(bobChainKey));

    // OPK should have been consumed
    expect(bobOTPKSecrets.has(1)).toBe(false);

    // ── 5. Init Double Ratchet ───────────────────────────

    // Alice (sender): uses Bob's SPK as initial remote ratchet pub
    const aliceState = await initSenderRatchet(aliceRootKey, fromBase64(bobSPK.publicKey));

    // Bob (receiver): uses his SPK key pair as initial local ratchet key
    const bobRatchetKP: X25519KeyPair = {
      publicKey: fromBase64(bobSPK.publicKey),
      secretKey: bobSPKSecret,
    };
    const bobState = await initReceiverRatchet(bobRootKey, bobRatchetKP);

    // ── 6. Alice sends message to Bob ────────────────────
    const msg1 = 'Hello Bob, this is encrypted!';
    const padded1 = await pad(encoder.encode(msg1));
    const encrypted1 = await ratchetEncrypt(aliceState, padded1);

    // Bob decrypts
    const decrypted1 = await ratchetDecrypt(bobState, encrypted1);
    const unpadded1 = unpad(decrypted1);
    expect(decoder.decode(unpadded1)).toBe(msg1);

    // ── 7. Alice sends a second message ──────────────────
    const msg2 = 'Second message — forward secrecy in action';
    const padded2 = await pad(encoder.encode(msg2));
    const encrypted2 = await ratchetEncrypt(aliceState, padded2);

    const decrypted2 = await ratchetDecrypt(bobState, encrypted2);
    expect(decoder.decode(unpad(decrypted2))).toBe(msg2);

    // ── 8. Bob replies to Alice ──────────────────────────
    const reply1 = 'Hey Alice, got your messages!';
    const paddedReply = await pad(encoder.encode(reply1));
    const encryptedReply = await ratchetEncrypt(bobState, paddedReply);

    const decryptedReply = await ratchetDecrypt(aliceState, encryptedReply);
    expect(decoder.decode(unpad(decryptedReply))).toBe(reply1);

    // ── 9. Ping-pong: more messages both ways ────────────
    for (let i = 0; i < 5; i++) {
      const aliceMsg = `Alice msg #${i}`;
      const aEnc = await ratchetEncrypt(aliceState, await pad(encoder.encode(aliceMsg)));
      const aDec = await ratchetDecrypt(bobState, aEnc);
      expect(decoder.decode(unpad(aDec))).toBe(aliceMsg);

      const bobMsg = `Bob msg #${i}`;
      const bEnc = await ratchetEncrypt(bobState, await pad(encoder.encode(bobMsg)));
      const bDec = await ratchetDecrypt(aliceState, bEnc);
      expect(decoder.decode(unpad(bDec))).toBe(bobMsg);
    }

    // Clean up key material
    wipe(aliceRootKey);
    wipe(aliceChainKey);
    wipe(bobRootKey);
    wipe(bobChainKey);
  });

  it('X3DH without one-time pre-key still works', async () => {
    const aliceIK = await generateIdentityKey();
    const bobIK = await generateIdentityKey();
    const { spk: bobSPK, secretKey: bobSPKSecret } = await createSignedPreKey(bobIK.secretKey, 42);

    // Bundle with NO one-time pre-keys
    const bobBundle: PreKeyBundle = buildPreKeyBundle(
      bobIK.publicKey,
      bobSPK,
      [], // empty
    );

    const { header, rootKey: aliceRK } = await x3dhSender(
      aliceIK.publicKey,
      aliceIK.secretKey,
      bobBundle,
    );

    expect(header.usedOneTimeKeyId).toBeUndefined();

    const { rootKey: bobRK } = await x3dhReceiver(
      bobIK.publicKey,
      bobIK.secretKey,
      bobSPKSecret,
      new Map(), // no OPK secrets
      header,
    );

    expect(toBase64(aliceRK)).toBe(toBase64(bobRK));

    // Verify ratchet works
    const aliceState = await initSenderRatchet(aliceRK, fromBase64(bobSPK.publicKey));
    const bobState = await initReceiverRatchet(bobRK, {
      publicKey: fromBase64(bobSPK.publicKey),
      secretKey: bobSPKSecret,
    });

    const msg = 'No OPK, still secure';
    const enc = await ratchetEncrypt(aliceState, await pad(encoder.encode(msg)));
    const dec = await ratchetDecrypt(bobState, enc);
    expect(decoder.decode(unpad(dec))).toBe(msg);
  });

  it('wrong receiver derives different root key', async () => {
    const aliceIK = await generateIdentityKey();
    const bobIK = await generateIdentityKey();
    const eveIK = await generateIdentityKey();

    const { spk: bobSPK, secretKey: bobSPKSecret } = await createSignedPreKey(bobIK.secretKey, 1);

    // Bundle with NO OPKs (to avoid the OPK-not-found error for Eve)
    const bobBundle = buildPreKeyBundle(bobIK.publicKey, bobSPK, []);

    const { header, rootKey: aliceRK } = await x3dhSender(
      aliceIK.publicKey,
      aliceIK.secretKey,
      bobBundle,
    );

    // Bob receives correctly
    const { rootKey: bobRK } = await x3dhReceiver(
      bobIK.publicKey,
      bobIK.secretKey,
      bobSPKSecret,
      new Map(),
      header,
    );
    expect(toBase64(aliceRK)).toBe(toBase64(bobRK));

    // Eve tries with her own identity key — gets a different root key
    const { spk: eveSPK, secretKey: eveSPKSecret } = await createSignedPreKey(eveIK.secretKey, 1);
    const { rootKey: eveRK } = await x3dhReceiver(
      eveIK.publicKey,
      eveIK.secretKey,
      eveSPKSecret,
      new Map(),
      header,
    );

    // Root keys must differ — Eve can't derive the same shared secret
    expect(toBase64(aliceRK)).not.toBe(toBase64(eveRK));
  });

  it('does not mutate ratchet state when ciphertext authentication fails', async () => {
    const aliceIK = await generateIdentityKey();
    const bobIK = await generateIdentityKey();
    const { spk: bobSPK, secretKey: bobSPKSecret } = await createSignedPreKey(bobIK.secretKey, 7);
    const bobBundle = buildPreKeyBundle(bobIK.publicKey, bobSPK, []);
    const { header, rootKey: aliceRootKey } = await x3dhSender(
      aliceIK.publicKey,
      aliceIK.secretKey,
      bobBundle,
    );
    const { rootKey: bobRootKey } = await x3dhReceiver(
      bobIK.publicKey,
      bobIK.secretKey,
      bobSPKSecret,
      new Map(),
      header,
    );
    const aliceState = await initSenderRatchet(aliceRootKey, fromBase64(bobSPK.publicKey));
    const bobState = await initReceiverRatchet(bobRootKey, {
      publicKey: fromBase64(bobSPK.publicKey),
      secretKey: bobSPKSecret,
    });
    const encrypted = await ratchetEncrypt(aliceState, encoder.encode('authenticated payload'));
    const tamperedBytes = fromBase64(encrypted.envelope.ct);
    tamperedBytes[0] ^= 0x01;
    const tampered = {
      ...encrypted,
      envelope: { ...encrypted.envelope, ct: toBase64(tamperedBytes) },
    };
    const before = toBase64(serializeRatchetState(bobState));

    await expect(ratchetDecrypt(bobState, tampered)).rejects.toThrow();
    expect(toBase64(serializeRatchetState(bobState))).toBe(before);
    expect(decoder.decode(await ratchetDecrypt(bobState, encrypted))).toBe('authenticated payload');
  });
});
