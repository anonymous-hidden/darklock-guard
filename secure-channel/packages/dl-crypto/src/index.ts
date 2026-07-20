/* ──────────────────────────────────────────────────────────
 *  @darklock/channel-crypto — Public API
 * ────────────────────────────────────────────────────────── */

// Initialization
export { initCrypto, getSodium } from './sodium.js';

// AEAD symmetric encryption
export { encrypt, decrypt, encryptString, decryptString, generateKey } from './aead.js';

// Key derivation
export { deriveVaultKey, generateSalt, createKdfParams, zeroize, hashAuthKey } from './kdf.js';

// Identity & signing
export {
  generateIdentityKey, generateX25519KeyPair,
  ed25519PubToX25519, ed25519SecToX25519,
  sign, verify,
  createSignedPreKey, generateOneTimePreKeys,
  buildPreKeyBundle, computeSafetyNumber,
} from './identity.js';

// X3DH key agreement
export { x3dhSender, x3dhReceiver } from './x3dh.js';
export type { X3DHSenderResult, X3DHReceiverResult } from './x3dh.js';

// Mnemonic recovery phrases
export { generateMnemonic, validateMnemonic, mnemonicToEntropy, entropyToMnemonic } from './mnemonic.js';

// Double Ratchet
export {
  initSenderRatchet, initReceiverRatchet,
  ratchetEncrypt, ratchetDecrypt,
  serializeRatchetState, deserializeRatchetState,
} from './ratchet.js';

// Experimental Sender Keys primitives. Not active in Ridgeline messaging.
export {
  createSenderKeyState, buildSenderKeyDistribution,
  processSenderKeyDistribution,
  senderKeyEncrypt, senderKeyDecrypt,
  serializeSenderKeyState, deserializeSenderKeyState,
} from './senderkeys.js';

// Padding (traffic analysis defence)
export { pad, unpad } from './padding.js';

// Secure memory wipe
export { wipe, wipeAll } from './wipe.js';

// Utilities
export { toBase64, fromBase64, toHex, fromHex, randomBytes, randomId, hash, keyedHash, constantTimeEqual } from './utils.js';

// Types
export type {
  Bytes, Base64, Hex,
  KdfParams, Envelope,
  IdentityKeyPair, X25519KeyPair,
  SignedPreKey, OneTimePreKey, PreKeyBundle,
  X3DHHeader, RatchetState, MessageHeader, EncryptedMessage,
  SenderKeyState, SenderKeyDistribution, GroupMessage,
  VaultData, WireMessage,
  TrustLevel, Contact, Conversation, Message, Attachment,
  GroupRole, GroupMember, GroupModerationSettings, GroupInfo,
  GroupChannelType, GroupChannel, GroupCategory,
  GroupPermissions, GroupRoleInfo, AuditAction, AuditLogEntry,
} from './types.js';

export { DEFAULT_KDF_PARAMS, DEFAULT_PERMISSIONS } from './types.js';
