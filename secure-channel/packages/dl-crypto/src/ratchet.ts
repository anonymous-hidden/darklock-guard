/* ──────────────────────────────────────────────────────────
 *  Double Ratchet — per-message forward secrecy
 *  Combines DH ratchet + symmetric chain ratchet.
 *  Each message gets a unique key; compromising one key
 *  does not compromise past or future messages.
 * ────────────────────────────────────────────────────────── */

import { getSodium } from './sodium.js';
import { generateX25519KeyPair } from './identity.js';
import { encrypt, decrypt } from './aead.js';
import { toBase64, fromBase64, toHex } from './utils.js';
import type {
  Bytes, RatchetState, MessageHeader,
  EncryptedMessage, X25519KeyPair, Envelope,
} from './types.js';

const MAX_SKIP = 256;
const INFO_ROOT = new TextEncoder().encode('DL-Ratchet-Root');
const INFO_CHAIN = new TextEncoder().encode('DL-Ratchet-Chain');
/** BLAKE2b keyed hash for KDF chains. */
async function kdf(key: Bytes, input: Bytes, info: Bytes, outLen = 64): Promise<Bytes> {
  const sodium = await getSodium();
  const combined = new Uint8Array(input.length + info.length);
  combined.set(input, 0);
  combined.set(info, input.length);
  return sodium.crypto_generichash(outLen, combined, key);
}

/** DH ratchet step: update root key + derive new chain key. */
async function dhRatchetStep(
  rootKey: Bytes,
  dhSecret: Bytes,
  dhPublic: Bytes,
): Promise<{ newRootKey: Bytes; newChainKey: Bytes }> {
  const sodium = await getSodium();
  const dhOut = sodium.crypto_scalarmult(dhSecret, dhPublic);
  const derived = await kdf(rootKey, dhOut, INFO_ROOT, 64);
  sodium.memzero(dhOut);
  const result = {
    newRootKey: derived.slice(0, 32),
    newChainKey: derived.slice(32, 64),
  };
  sodium.memzero(derived);
  return result;
}

/** Symmetric ratchet step: advance chain key → next chain key + message key. */
async function chainStep(chainKey: Bytes): Promise<{ nextChainKey: Bytes; messageKey: Bytes }> {
  const sodium = await getSodium();
  const derived = await kdf(chainKey, new Uint8Array([0x01]), INFO_CHAIN, 64);
  const result = {
    nextChainKey: derived.slice(0, 32),
    messageKey: derived.slice(32, 64),
  };
  sodium.memzero(derived);
  return result;
}

/** Initialize ratchet state for the sender (Alice, who initiated X3DH). */
export async function initSenderRatchet(
  rootKey: Bytes,
  remoteRatchetPub: Bytes, // Bob's SPK (used as initial ratchet key)
): Promise<RatchetState> {
  const sendKP = await generateX25519KeyPair();
  const { newRootKey, newChainKey } = await dhRatchetStep(rootKey, sendKP.secretKey, remoteRatchetPub);

  return {
    rootKey: newRootKey,
    sendChainKey: newChainKey,
    recvChainKey: null,
    sendRatchetKey: sendKP,
    recvRatchetPub: remoteRatchetPub,
    sendMessageNum: 0,
    recvMessageNum: 0,
    prevSendCount: 0,
    skippedKeys: new Map(),
  };
}

/** Initialize ratchet state for the receiver (Bob). */
export async function initReceiverRatchet(
  rootKey: Bytes,
  localRatchetKeyPair: X25519KeyPair, // Bob's SPK key pair
): Promise<RatchetState> {
  return {
    rootKey,
    sendChainKey: null,
    recvChainKey: null,
    sendRatchetKey: localRatchetKeyPair,
    recvRatchetPub: null,
    sendMessageNum: 0,
    recvMessageNum: 0,
    prevSendCount: 0,
    skippedKeys: new Map(),
  };
}

/** Encrypt a message using the Double Ratchet. */
export async function ratchetEncrypt(
  state: RatchetState,
  plaintext: Bytes,
): Promise<EncryptedMessage> {
  if (!state.sendChainKey || !state.sendRatchetKey) {
    throw new Error('Ratchet not initialized for sending');
  }

  const { nextChainKey, messageKey } = await chainStep(state.sendChainKey);

  const header: MessageHeader = {
    ratchetPub: toBase64(state.sendRatchetKey.publicKey),
    messageNum: state.sendMessageNum,
    prevChainLen: state.prevSendCount,
  };

  // Encrypt with message key; header as associated data for authentication
  const ad = new TextEncoder().encode(JSON.stringify(header));
  const envelope = await encrypt(plaintext, messageKey.slice(0, 32), ad);

  // Wipe used message key
  const sodium = await getSodium();
  sodium.memzero(messageKey);

  // Update state
  state.sendChainKey = nextChainKey;
  state.sendMessageNum++;

  return { header, envelope };
}

/** Skip ahead in the receive chain to handle out-of-order messages. */
async function skipKeys(state: RatchetState, until: number): Promise<void> {
  if (!state.recvChainKey) return;
  if (until - state.recvMessageNum > MAX_SKIP) {
    throw new Error('Too many skipped messages');
  }
  const sodium = await getSodium();
  const pubHex = state.recvRatchetPub ? toHex(state.recvRatchetPub) : '';

  while (state.recvMessageNum < until) {
    const { nextChainKey, messageKey } = await chainStep(state.recvChainKey);
    const key = `${pubHex}:${state.recvMessageNum}`;
    state.skippedKeys.set(key, messageKey);
    sodium.memzero(state.recvChainKey);
    state.recvChainKey = nextChainKey;
    state.recvMessageNum++;
  }
}

/** Decrypt a message using the Double Ratchet. */
function cloneRatchetState(state: RatchetState): RatchetState {
  return {
    rootKey: state.rootKey.slice(),
    sendChainKey: state.sendChainKey?.slice() ?? null,
    recvChainKey: state.recvChainKey?.slice() ?? null,
    sendRatchetKey: state.sendRatchetKey ? {
      publicKey: state.sendRatchetKey.publicKey.slice(),
      secretKey: state.sendRatchetKey.secretKey.slice(),
    } : null,
    recvRatchetPub: state.recvRatchetPub?.slice() ?? null,
    sendMessageNum: state.sendMessageNum,
    recvMessageNum: state.recvMessageNum,
    prevSendCount: state.prevSendCount,
    skippedKeys: new Map(
      Array.from(state.skippedKeys.entries(), ([key, value]) => [key, value.slice()]),
    ),
  };
}

function wipeRatchetState(state: RatchetState, memzero: (value: Bytes) => void): void {
  memzero(state.rootKey);
  if (state.sendChainKey) memzero(state.sendChainKey);
  if (state.recvChainKey) memzero(state.recvChainKey);
  if (state.sendRatchetKey) {
    memzero(state.sendRatchetKey.publicKey);
    memzero(state.sendRatchetKey.secretKey);
  }
  if (state.recvRatchetPub) memzero(state.recvRatchetPub);
  for (const key of state.skippedKeys.values()) memzero(key);
  state.skippedKeys.clear();
}

function validateEncryptedMessage(msg: EncryptedMessage): Bytes {
  if (!msg || !msg.header || !msg.envelope) throw new Error('Invalid ratchet envelope');
  if (msg.envelope.v !== 1 || msg.envelope.alg !== 'xchacha20-poly1305') {
    throw new Error('Unsupported ratchet envelope version');
  }
  if (!Number.isSafeInteger(msg.header.messageNum) || msg.header.messageNum < 0
    || !Number.isSafeInteger(msg.header.prevChainLen) || msg.header.prevChainLen < 0) {
    throw new Error('Invalid ratchet header counters');
  }
  const headerPub = fromBase64(msg.header.ratchetPub);
  if (headerPub.length !== 32) throw new Error('Invalid ratchet public key');
  return headerPub;
}

async function ratchetDecryptProvisional(
  state: RatchetState,
  msg: EncryptedMessage,
  headerPub: Bytes,
): Promise<Bytes> {
  const sodium = await getSodium();
  const pubHex = toHex(headerPub);
  const ad = new TextEncoder().encode(JSON.stringify(msg.header));
  if (!msg.envelope.ad || !sodium.memcmp(fromBase64(msg.envelope.ad), ad)) {
    throw new Error('Ratchet header authentication data mismatch');
  }

  const skipKey = `${pubHex}:${msg.header.messageNum}`;
  const cached = state.skippedKeys.get(skipKey);
  if (cached) {
    state.skippedKeys.delete(skipKey);
    try {
      return await decrypt(msg.envelope, cached.slice(0, 32));
    } finally {
      sodium.memzero(cached);
    }
  }

  const currentRecvHex = state.recvRatchetPub ? toHex(state.recvRatchetPub) : '';
  if (pubHex !== currentRecvHex) {
    if (state.recvChainKey) await skipKeys(state, msg.header.prevChainLen);
    if (!state.sendRatchetKey) throw new Error('No send ratchet key');
    const { newRootKey: rk1, newChainKey: ck1 } = await dhRatchetStep(
      state.rootKey, state.sendRatchetKey.secretKey, headerPub,
    );
    state.recvRatchetPub = headerPub;
    state.recvChainKey = ck1;
    state.recvMessageNum = 0;
    state.prevSendCount = state.sendMessageNum;
    state.sendMessageNum = 0;
    const newKP = await generateX25519KeyPair();
    try {
      const { newRootKey: rk2, newChainKey: ck2 } = await dhRatchetStep(
        rk1, newKP.secretKey, headerPub,
      );
      if (state.sendRatchetKey) sodium.memzero(state.sendRatchetKey.secretKey);
      state.sendRatchetKey = newKP;
      state.rootKey = rk2;
      state.sendChainKey = ck2;
    } finally {
      sodium.memzero(rk1);
    }
  }

  await skipKeys(state, msg.header.messageNum);
  if (!state.recvChainKey) throw new Error('No receive chain key');
  const { nextChainKey, messageKey } = await chainStep(state.recvChainKey);
  sodium.memzero(state.recvChainKey);
  state.recvChainKey = nextChainKey;
  state.recvMessageNum++;
  try {
    return await decrypt(msg.envelope, messageKey.slice(0, 32));
  } finally {
    sodium.memzero(messageKey);
  }
}

/** Decrypt without committing ratchet progress until AEAD authentication succeeds. */
export async function ratchetDecrypt(
  state: RatchetState,
  msg: EncryptedMessage,
): Promise<Bytes> {
  const sodium = await getSodium();
  const headerPub = validateEncryptedMessage(msg);
  const provisional = cloneRatchetState(state);
  try {
    const plaintext = await ratchetDecryptProvisional(provisional, msg, headerPub);
    wipeRatchetState(state, sodium.memzero);
    Object.assign(state, provisional);
    return plaintext;
  } catch (error) {
    wipeRatchetState(provisional, sodium.memzero);
    throw error;
  }
}

/** Serialize ratchet state for encrypted storage. */
export function serializeRatchetState(state: RatchetState): Bytes {
  const obj = {
    rootKey: toBase64(state.rootKey),
    sendChainKey: state.sendChainKey ? toBase64(state.sendChainKey) : null,
    recvChainKey: state.recvChainKey ? toBase64(state.recvChainKey) : null,
    sendRatchetPub: state.sendRatchetKey ? toBase64(state.sendRatchetKey.publicKey) : null,
    sendRatchetSec: state.sendRatchetKey ? toBase64(state.sendRatchetKey.secretKey) : null,
    recvRatchetPub: state.recvRatchetPub ? toBase64(state.recvRatchetPub) : null,
    sendMessageNum: state.sendMessageNum,
    recvMessageNum: state.recvMessageNum,
    prevSendCount: state.prevSendCount,
    skippedKeys: Object.fromEntries(
      Array.from(state.skippedKeys.entries()).map(([k, v]) => [k, toBase64(v)]),
    ),
  };
  return new TextEncoder().encode(JSON.stringify(obj));
}

/** Deserialize ratchet state from decrypted storage. */
export function deserializeRatchetState(data: Bytes): RatchetState {
  const obj = JSON.parse(new TextDecoder().decode(data));
  return {
    rootKey: fromBase64(obj.rootKey),
    sendChainKey: obj.sendChainKey ? fromBase64(obj.sendChainKey) : null,
    recvChainKey: obj.recvChainKey ? fromBase64(obj.recvChainKey) : null,
    sendRatchetKey: obj.sendRatchetPub ? {
      publicKey: fromBase64(obj.sendRatchetPub),
      secretKey: fromBase64(obj.sendRatchetSec),
    } : null,
    recvRatchetPub: obj.recvRatchetPub ? fromBase64(obj.recvRatchetPub) : null,
    sendMessageNum: obj.sendMessageNum,
    recvMessageNum: obj.recvMessageNum,
    prevSendCount: obj.prevSendCount,
    skippedKeys: new Map(
      Object.entries(obj.skippedKeys).map(([k, v]) => [k, fromBase64(v as string)]),
    ),
  };
}
