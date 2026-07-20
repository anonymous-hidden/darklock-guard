/* ──────────────────────────────────────────────────────────
 *  Experimental Sender Keys primitives (not active in Ridgeline messaging)
 *  One encrypt per message, N decrypts. Key rotated on
 *  member changes for forward secrecy.
 * ────────────────────────────────────────────────────────── */

import { getSodium } from './sodium.js';
import { encrypt, decrypt, generateKey } from './aead.js';
import { sign, verify, generateIdentityKey } from './identity.js';
import { toBase64, fromBase64 } from './utils.js';
import type {
  Bytes, SenderKeyState, SenderKeyDistribution,
  GroupMessage, IdentityKeyPair, Envelope,
} from './types.js';

const INFO_SENDER = new TextEncoder().encode('DL-SenderKey-v1');

/** Advance the sender key chain by one step (BLAKE2b KDF). */
async function advanceChain(chainKey: Bytes): Promise<{ nextChainKey: Bytes; messageKey: Bytes }> {
  const sodium = await getSodium();
  const derived = sodium.crypto_generichash(64, new Uint8Array([0x01]), chainKey);
  return {
    nextChainKey: derived.slice(0, 32),
    messageKey: derived.slice(32, 64),
  };
}

/** Create a new sender key state for a group. */
export async function createSenderKeyState(): Promise<SenderKeyState> {
  const chainKey = await generateKey();
  const signingKey = await generateIdentityKey();
  return {
    chainKey,
    iteration: 0,
    signingKey,
  };
}

/** Build distribution message to send to group members. */
export function buildSenderKeyDistribution(
  senderId: string,
  state: SenderKeyState,
): SenderKeyDistribution {
  return {
    senderId,
    chainKey: toBase64(state.chainKey),
    iteration: state.iteration,
    signingPub: toBase64(state.signingKey.publicKey),
  };
}

/** Process a received sender key distribution (store for decryption). */
export function processSenderKeyDistribution(
  dist: SenderKeyDistribution,
): SenderKeyState {
  return {
    chainKey: fromBase64(dist.chainKey),
    iteration: dist.iteration,
    signingKey: {
      publicKey: fromBase64(dist.signingPub),
      secretKey: new Uint8Array(0), // We only have the public key
    },
  };
}

/** Experimental primitive; not wired to any production group-message route. */
export async function senderKeyEncrypt(
  state: SenderKeyState,
  senderId: string,
  plaintext: Bytes,
): Promise<GroupMessage> {
  const { nextChainKey, messageKey } = await advanceChain(state.chainKey);
  const sodium = await getSodium();

  const envelope = await encrypt(plaintext, messageKey.slice(0, 32));
  const sig = await sign(
    fromBase64(envelope.ct),
    state.signingKey.secretKey,
  );

  sodium.memzero(state.chainKey);
  state.chainKey = nextChainKey;
  state.iteration++;
  sodium.memzero(messageKey);

  return {
    senderId,
    iteration: state.iteration - 1,
    envelope,
    signature: toBase64(sig),
  };
}

/** Decrypt a group message using the sender's stored key state. */
export async function senderKeyDecrypt(
  state: SenderKeyState,
  msg: GroupMessage,
): Promise<Bytes> {
  const sodium = await getSodium();

  // Verify signature
  const sigValid = await verify(
    fromBase64(msg.signature),
    fromBase64(msg.envelope.ct),
    state.signingKey.publicKey,
  );
  if (!sigValid) throw new Error('Invalid group message signature');

  // Advance chain to the correct iteration
  let currentKey = state.chainKey;
  let currentIter = state.iteration;
  while (currentIter < msg.iteration) {
    const { nextChainKey } = await advanceChain(currentKey);
    if (currentKey !== state.chainKey) sodium.memzero(currentKey);
    currentKey = nextChainKey;
    currentIter++;
  }

  const { nextChainKey, messageKey } = await advanceChain(currentKey);
  if (currentKey !== state.chainKey) sodium.memzero(currentKey);

  const plaintext = await decrypt(msg.envelope, messageKey.slice(0, 32));

  sodium.memzero(state.chainKey);
  state.chainKey = nextChainKey;
  state.iteration = currentIter + 1;
  sodium.memzero(messageKey);

  return plaintext;
}

/** Serialize sender key state for encrypted vault storage. */
export function serializeSenderKeyState(state: SenderKeyState): Bytes {
  const obj = {
    chainKey: toBase64(state.chainKey),
    iteration: state.iteration,
    signingPub: toBase64(state.signingKey.publicKey),
    signingSec: state.signingKey.secretKey.length > 0
      ? toBase64(state.signingKey.secretKey)
      : null,
  };
  return new TextEncoder().encode(JSON.stringify(obj));
}

/** Deserialize sender key state. */
export function deserializeSenderKeyState(data: Bytes): SenderKeyState {
  const obj = JSON.parse(new TextDecoder().decode(data));
  return {
    chainKey: fromBase64(obj.chainKey),
    iteration: obj.iteration,
    signingKey: {
      publicKey: fromBase64(obj.signingPub),
      secretKey: obj.signingSec ? fromBase64(obj.signingSec) : new Uint8Array(0),
    },
  };
}
