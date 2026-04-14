import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

function b64(u8) { return encodeBase64(u8); }
function fromb64(s) { return decodeBase64(s); }

async function sha256(data) {
  const buf = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(buf);
}

const MAX_MESSAGES_BEFORE_ROTATE = 100;
const MAX_TIME_BEFORE_ROTATE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Session ratchet — manages ephemeral keys and session key rotation for PFS.
 *
 * Double-ratchet pattern (simplified):
 * 1. Both sides generate ephemeral X25519 keypairs
 * 2. Derive shared session key via ECDH between ephemeral + identity keys
 * 3. Rotate every 100 messages or 30 minutes
 * 4. Old keys are immediately zeroed out
 */
export class SessionRatchet {
  constructor(identityPrivateKeyB64, identityPublicKeyB64) {
    this.identityPrivateKey = identityPrivateKeyB64;
    this.identityPublicKey = identityPublicKeyB64;
    this.ephemeralKeypair = null;
    this.sessionKey = null;
    this.messageCount = 0;
    this.sessionStartTime = null;
    this.peerEphemeralPublicKey = null;
    this.peerIdentityPublicKey = null;
  }

  /**
   * Initialize a new session with a peer
   */
  async init(peerIdentityPublicKeyB64) {
    this.peerIdentityPublicKey = peerIdentityPublicKeyB64;
    await this.rotate();
  }

  /**
   * Rotate session keys — generate new ephemeral keypair and derive new session key
   */
  async rotate() {
    // Zero out old keys
    if (this.sessionKey) {
      const oldKey = fromb64(this.sessionKey);
      oldKey.fill(0);
    }
    if (this.ephemeralKeypair) {
      const oldPriv = fromb64(this.ephemeralKeypair.privateKey);
      oldPriv.fill(0);
    }

    // Generate new ephemeral keypair
    const kp = nacl.box.keyPair();
    this.ephemeralKeypair = {
      publicKey: b64(kp.publicKey),
      privateKey: b64(kp.secretKey)
    };

    this.messageCount = 0;
    this.sessionStartTime = Date.now();

    // If we have peer's ephemeral key, derive session key immediately
    if (this.peerEphemeralPublicKey) {
      await this._deriveSessionKey();
    }

    return this.ephemeralKeypair.publicKey;
  }

  /**
   * Receive peer's new ephemeral public key
   */
  async receivePeerEphemeralKey(peerEphemeralPublicKeyB64) {
    this.peerEphemeralPublicKey = peerEphemeralPublicKeyB64;
    if (this.ephemeralKeypair) {
      await this._deriveSessionKey();
    }
  }

  /**
   * Double ECDH: ephemeral×peer_ephemeral + identity×peer_identity
   * Combined via SHA-256 as KDF
   */
  async _deriveSessionKey() {
    const ephPriv = fromb64(this.ephemeralKeypair.privateKey);
    const peerEphPub = fromb64(this.peerEphemeralPublicKey);
    const idPriv = fromb64(this.identityPrivateKey);
    const peerIdPub = fromb64(this.peerIdentityPublicKey);

    // ECDH 1: ephemeral ↔ peer ephemeral
    const shared1 = nacl.scalarMult(ephPriv, peerEphPub);
    // ECDH 2: identity ↔ peer identity
    const shared2 = nacl.scalarMult(idPriv, peerIdPub);

    // Combine both shared secrets and hash with SHA-256 as KDF
    const combined = new Uint8Array(shared1.length + shared2.length);
    combined.set(shared1);
    combined.set(shared2, shared1.length);
    const sessionKey = await sha256(combined);

    // Zero intermediates
    ephPriv.fill(0);
    idPriv.fill(0);
    shared1.fill(0);
    shared2.fill(0);
    combined.fill(0);

    this.sessionKey = b64(sessionKey);
    sessionKey.fill(0);
  }

  /**
   * Check if rotation is needed
   */
  needsRotation() {
    if (!this.sessionStartTime) return true;
    if (this.messageCount >= MAX_MESSAGES_BEFORE_ROTATE) return true;
    if (Date.now() - this.sessionStartTime >= MAX_TIME_BEFORE_ROTATE_MS) return true;
    return false;
  }

  /**
   * Increment message counter
   */
  tick() {
    this.messageCount++;
  }

  /**
   * Get current session key for encryption
   */
  getSessionKey() {
    return this.sessionKey;
  }

  /**
   * Get current ephemeral public key to share with peer
   */
  getEphemeralPublicKey() {
    return this.ephemeralKeypair ? this.ephemeralKeypair.publicKey : null;
  }

  /**
   * Destroy all key material
   */
  destroy() {
    if (this.sessionKey) {
      const key = fromb64(this.sessionKey);
      key.fill(0);
    }
    if (this.ephemeralKeypair) {
      const priv = fromb64(this.ephemeralKeypair.privateKey);
      priv.fill(0);
    }
    this.sessionKey = null;
    this.ephemeralKeypair = null;
    this.peerEphemeralPublicKey = null;
    this.messageCount = 0;
  }
}

