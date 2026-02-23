//! Double Ratchet with DH ratchet steps.
//!
//! References:
//!   - Signal Double Ratchet spec: <https://signal.org/docs/specifications/doubleratchet/>
//!
//! State separation (non-negotiable):
//!   RK  — root key (updated on every DH ratchet step)
//!   CKs — sending chain key (updated per message)
//!   CKr — receiving chain key (updated per message)
//!   MK  — message key (derived from CK, used once, then DELETED)
//!
//! DH Ratchet:
//!   Each party generates a new X25519 ratchet keypair per "turn" (when they
//!   receive a message with a new ratchet public key). The DH output is mixed
//!   into the root key via HKDF, producing a new root key and a new chain key.
//!
//! Forward secrecy: old chain keys and message keys are deleted.
//! Post-compromise security: a new DH ratchet step restores secrecy.

use std::collections::HashMap;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use x25519_dalek::{PublicKey as X25519Public, StaticSecret};
use zeroize::Zeroize;

use crate::error::CryptoError;

/// Maximum number of skipped message keys we store per session.
/// This limits memory usage and prevents DoS via huge counter jumps.
const MAX_SKIP: u64 = 256;

// ── Ratchet header (included in every message, unencrypted) ──────────────────

/// Sent alongside every ciphertext so the recipient can advance their ratchet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RatchetHeader {
    /// Sender's current DH ratchet public key (base64)
    pub dh_pub: String,
    /// Message number in the current sending chain
    pub n: u64,
    /// Number of messages in the previous sending chain (for skip handling)
    pub pn: u64,
}

// ── Session state ────────────────────────────────────────────────────────────

/// Complete Double Ratchet session state.
/// Stored encrypted in the local vault.
#[derive(Serialize, Deserialize)]
pub struct RatchetSession {
    pub session_id: String,
    pub peer_user_id: String,

    // ── Root key ─────────────────────────────────────────────────────────
    root_key: [u8; 32],

    // ── Sending chain ────────────────────────────────────────────────────
    /// Our current DH ratchet secret (X25519). Regenerated on each DH step.
    dh_send_secret: [u8; 32],
    /// Our current DH ratchet public key
    #[serde(with = "pub_key_serde")]
    dh_send_pub: X25519Public,
    /// Sending chain key
    send_ck: [u8; 32],
    /// Send message counter (resets to 0 on DH ratchet)
    pub send_n: u64,

    // ── Receiving chain ──────────────────────────────────────────────────
    /// Peer's last known DH ratchet public key
    #[serde(with = "option_pub_key_serde")]
    dh_recv_pub: Option<X25519Public>,
    /// Receiving chain key
    recv_ck: [u8; 32],
    /// Recv message counter within current chain
    pub recv_n: u64,
    /// Previous send chain length (for skip counting)
    pub prev_send_n: u64,

    // ── Skipped message keys ─────────────────────────────────────────────
    /// (base64 dh_pub, message_n) → message_key
    /// These are kept for out-of-order messages but MUST be bounded and
    /// eventually deleted.
    skipped_keys: HashMap<(String, u64), [u8; 32]>,

    // ── Hash chain ───────────────────────────────────────────────────────
    /// Last chain link hash for tamper evidence
    pub chain_head: [u8; 32],
}

impl Drop for RatchetSession {
    fn drop(&mut self) {
        self.root_key.zeroize();
        self.dh_send_secret.zeroize();
        self.send_ck.zeroize();
        self.recv_ck.zeroize();
        for (_, mk) in self.skipped_keys.iter_mut() {
            mk.zeroize();
        }
    }
}

// ── Construction ─────────────────────────────────────────────────────────────

impl RatchetSession {
    /// Create a new session as the INITIATOR (Alice).
    ///
    /// Alice has the shared key from X3DH and Bob's SPK (which becomes the
    /// first "received" DH ratchet key). She immediately performs a DH ratchet.
    pub fn init_alice(
        session_id: String,
        peer_user_id: String,
        shared_key: [u8; 32],
        bob_spk_pub: &X25519Public,
    ) -> Result<Self, CryptoError> {
        // Generate our first ratchet keypair
        let dh_send_secret = StaticSecret::random_from_rng(OsRng);
        let dh_send_pub = X25519Public::from(&dh_send_secret);

        // First DH ratchet step: mix DH(our new key, bob's SPK) into root key
        let dh_output = dh_send_secret.diffie_hellman(bob_spk_pub);
        let (new_rk, new_ck) = kdf_rk(&shared_key, dh_output.as_bytes())?;

        Ok(Self {
            session_id,
            peer_user_id,
            root_key: new_rk,
            dh_send_secret: dh_send_secret.to_bytes(),
            dh_send_pub,
            send_ck: new_ck,
            send_n: 0,
            dh_recv_pub: Some(*bob_spk_pub),
            recv_ck: [0u8; 32], // Not yet established — first message from Bob will set this
            recv_n: 0,
            prev_send_n: 0,
            skipped_keys: HashMap::new(),
            chain_head: [0u8; 32],
        })
    }

    /// Create a new session as the RESPONDER (Bob).
    ///
    /// Bob has the shared key from X3DH. His SPK secret is used as the initial
    /// DH ratchet key. He has NOT performed a DH ratchet yet — that happens
    /// when he receives Alice's first message (with her ratchet public key).
    pub fn init_bob(
        session_id: String,
        peer_user_id: String,
        shared_key: [u8; 32],
        my_spk_secret: &StaticSecret,
        my_spk_pub: &X25519Public,
    ) -> Result<Self, CryptoError> {
        Ok(Self {
            session_id,
            peer_user_id,
            root_key: shared_key,
            dh_send_secret: my_spk_secret.to_bytes(),
            dh_send_pub: *my_spk_pub,
            send_ck: [0u8; 32], // Set on first DH ratchet when sending
            send_n: 0,
            dh_recv_pub: None, // Set when Alice's first message arrives
            recv_ck: [0u8; 32],
            recv_n: 0,
            prev_send_n: 0,
            skipped_keys: HashMap::new(),
            chain_head: [0u8; 32],
        })
    }

    // ── Encrypt ──────────────────────────────────────────────────────────

    /// Encrypt a message. Returns (RatchetHeader, message_key).
    ///
    /// The caller uses the message_key with AEAD (XChaCha20-Poly1305) to
    /// encrypt the plaintext. The header is sent unencrypted alongside it.
    pub fn encrypt_step(&mut self) -> Result<(RatchetHeader, [u8; 32]), CryptoError> {
        let (new_ck, mk) = kdf_ck(&self.send_ck)?;
        self.send_ck = new_ck;
        let header = RatchetHeader {
            dh_pub: URL_SAFE_NO_PAD.encode(self.dh_send_pub.as_bytes()),
            n: self.send_n,
            pn: self.prev_send_n,
        };
        self.send_n += 1;
        Ok((header, mk))
    }

    // ── Decrypt ──────────────────────────────────────────────────────────

    /// Derive the message key for a received message.
    ///
    /// Handles three cases:
    ///   1. Message from the current receiving chain (normal)
    ///   2. Skipped message in the current or previous chain
    ///   3. New DH ratchet (peer's dh_pub changed)
    pub fn decrypt_step(&mut self, header: &RatchetHeader) -> Result<[u8; 32], CryptoError> {
        let peer_dh_pub_bytes = URL_SAFE_NO_PAD
            .decode(&header.dh_pub)
            .map_err(CryptoError::Base64Decode)?;
        let peer_dh = X25519Public::from(
            <[u8; 32]>::try_from(peer_dh_pub_bytes.as_slice())
                .map_err(|_| CryptoError::InvalidKey("bad ratchet DH pub".into()))?,
        );

        // Case 2: Check skipped keys first
        let key = (header.dh_pub.clone(), header.n);
        if let Some(mk) = self.skipped_keys.remove(&key) {
            return Ok(mk);
        }

        // Case 3: DH ratchet needed?
        let need_dh_ratchet = match self.dh_recv_pub {
            Some(ref current) => current.as_bytes() != peer_dh.as_bytes(),
            None => true, // Bob receiving Alice's first message
        };

        if need_dh_ratchet {
            // Skip any remaining messages in the current receiving chain
            if self.dh_recv_pub.is_some() {
                self.skip_message_keys(header.pn)?;
            }

            // Perform DH ratchet
            self.dh_recv_pub = Some(peer_dh);

            // Receiving DH ratchet step
            let dh_recv_output = StaticSecret::from(self.dh_send_secret)
                .diffie_hellman(&peer_dh);
            let (new_rk, new_recv_ck) = kdf_rk(&self.root_key, dh_recv_output.as_bytes())?;
            self.root_key = new_rk;
            self.recv_ck = new_recv_ck;
            self.recv_n = 0;

            // Sending DH ratchet step (generate new ratchet keypair)
            self.prev_send_n = self.send_n;
            self.send_n = 0;
            let new_dh = StaticSecret::random_from_rng(OsRng);
            self.dh_send_pub = X25519Public::from(&new_dh);
            let dh_send_output = new_dh.diffie_hellman(&peer_dh);
            let (new_rk2, new_send_ck) = kdf_rk(&self.root_key, dh_send_output.as_bytes())?;
            self.root_key = new_rk2;
            self.send_ck = new_send_ck;
            self.dh_send_secret = new_dh.to_bytes();
        }

        // Skip messages in the current chain up to header.n
        self.skip_message_keys(header.n)?;

        // Case 1: Derive the message key
        let (new_ck, mk) = kdf_ck(&self.recv_ck)?;
        self.recv_ck = new_ck;
        self.recv_n += 1;

        Ok(mk)
    }

    // ── Internal ─────────────────────────────────────────────────────────

    /// Store skipped message keys from recv_n up to (but not including) `until`.
    fn skip_message_keys(&mut self, until: u64) -> Result<(), CryptoError> {
        if until < self.recv_n {
            return Ok(()); // Already past this point
        }
        let skip_count = until - self.recv_n;
        if skip_count > MAX_SKIP {
            return Err(CryptoError::RatchetStep(format!(
                "Too many skipped messages ({skip_count} > {MAX_SKIP})"
            )));
        }

        let dh_pub_b64 = self
            .dh_recv_pub
            .map(|k| URL_SAFE_NO_PAD.encode(k.as_bytes()))
            .unwrap_or_default();

        while self.recv_n < until {
            let (new_ck, mk) = kdf_ck(&self.recv_ck)?;
            self.recv_ck = new_ck;
            self.skipped_keys
                .insert((dh_pub_b64.clone(), self.recv_n), mk);
            self.recv_n += 1;
        }

        // Evict oldest skipped keys if too many
        while self.skipped_keys.len() > MAX_SKIP as usize {
            // Remove the smallest (oldest) message number
            if let Some(key) = self.skipped_keys.keys().next().cloned() {
                if let Some(mut mk) = self.skipped_keys.remove(&key) {
                    mk.zeroize();
                }
            }
        }

        Ok(())
    }

    /// Delete a used message key. Call after successful AEAD decryption.
    pub fn delete_message_key(&mut self, dh_pub: &str, n: u64) {
        if let Some(mut mk) = self.skipped_keys.remove(&(dh_pub.to_string(), n)) {
            mk.zeroize();
        }
    }

    /// Get our current DH ratchet public key.
    pub fn our_ratchet_pub(&self) -> X25519Public {
        self.dh_send_pub
    }
}

// ── KDF helpers (per Signal spec) ────────────────────────────────────────────

/// KDF_RK: root key derivation from DH output.
/// Returns (new_root_key, new_chain_key).
fn kdf_rk(rk: &[u8; 32], dh_output: &[u8]) -> Result<([u8; 32], [u8; 32]), CryptoError> {
    let hk = hkdf::Hkdf::<sha2::Sha256>::new(Some(rk), dh_output);
    let mut new_rk = [0u8; 32];
    let mut ck = [0u8; 32];
    hk.expand(b"dl-ratchet-rk", &mut new_rk)
        .map_err(|e| CryptoError::KeyDerivation(e.to_string()))?;
    hk.expand(b"dl-ratchet-ck", &mut ck)
        .map_err(|e| CryptoError::KeyDerivation(e.to_string()))?;
    Ok((new_rk, ck))
}

/// KDF_CK: chain key → (next_chain_key, message_key).
/// Uses HMAC-based derivation per the Signal spec.
fn kdf_ck(ck: &[u8; 32]) -> Result<([u8; 32], [u8; 32]), CryptoError> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    type HmacSha256 = Hmac<Sha256>;

    let mut mac_ck = HmacSha256::new_from_slice(ck)
        .map_err(|e| CryptoError::KeyDerivation(e.to_string()))?;
    mac_ck.update(&[0x01]); // chain key derivation constant
    let new_ck: [u8; 32] = mac_ck.finalize().into_bytes().into();

    let mut mac_mk = HmacSha256::new_from_slice(ck)
        .map_err(|e| CryptoError::KeyDerivation(e.to_string()))?;
    mac_mk.update(&[0x02]); // message key derivation constant
    let mk: [u8; 32] = mac_mk.finalize().into_bytes().into();

    Ok((new_ck, mk))
}

// ── Serde helpers for X25519Public ───────────────────────────────────────────

mod pub_key_serde {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use serde::{self, Deserialize, Deserializer, Serializer};
    use x25519_dalek::PublicKey as X25519Public;

    pub fn serialize<S>(key: &X25519Public, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&URL_SAFE_NO_PAD.encode(key.as_bytes()))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<X25519Public, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        let bytes = URL_SAFE_NO_PAD
            .decode(&s)
            .map_err(serde::de::Error::custom)?;
        let arr: [u8; 32] = bytes
            .try_into()
            .map_err(|_| serde::de::Error::custom("expected 32 bytes"))?;
        Ok(X25519Public::from(arr))
    }
}

mod option_pub_key_serde {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use serde::{self, Deserialize, Deserializer, Serializer};
    use x25519_dalek::PublicKey as X25519Public;

    pub fn serialize<S>(key: &Option<X25519Public>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match key {
            Some(k) => serializer.serialize_some(&URL_SAFE_NO_PAD.encode(k.as_bytes())),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Option<X25519Public>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let opt: Option<String> = Option::deserialize(deserializer)?;
        match opt {
            None => Ok(None),
            Some(s) => {
                let bytes = URL_SAFE_NO_PAD
                    .decode(&s)
                    .map_err(serde::de::Error::custom)?;
                let arr: [u8; 32] = bytes
                    .try_into()
                    .map_err(|_| serde::de::Error::custom("expected 32 bytes"))?;
                Ok(Some(X25519Public::from(arr)))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_ratchet_roundtrip() {
        // Simulate post-X3DH: both sides have shared_key and Bob's SPK
        let shared_key = [42u8; 32];
        let bob_spk = StaticSecret::random_from_rng(OsRng);
        let bob_spk_pub = X25519Public::from(&bob_spk);

        let mut alice = RatchetSession::init_alice(
            "sess-1".into(),
            "bob".into(),
            shared_key,
            &bob_spk_pub,
        )
        .unwrap();

        let mut bob = RatchetSession::init_bob(
            "sess-1".into(),
            "alice".into(),
            shared_key,
            &bob_spk,
            &bob_spk_pub,
        )
        .unwrap();

        // Alice sends 3 messages
        for i in 0..3 {
            let (header, mk_alice) = alice.encrypt_step().unwrap();
            let mk_bob = bob.decrypt_step(&header).unwrap();
            assert_eq!(mk_alice, mk_bob, "message {i}: keys must match");
        }

        // Bob replies with 2 messages (triggers DH ratchet)
        for i in 0..2 {
            let (header, mk_bob) = bob.encrypt_step().unwrap();
            let mk_alice = alice.decrypt_step(&header).unwrap();
            assert_eq!(mk_bob, mk_alice, "bob message {i}: keys must match");
        }

        // Alice sends again (another DH ratchet)
        let (header, mk_a) = alice.encrypt_step().unwrap();
        let mk_b = bob.decrypt_step(&header).unwrap();
        assert_eq!(mk_a, mk_b);
    }

    #[test]
    fn out_of_order_messages() {
        let shared_key = [99u8; 32];
        let bob_spk = StaticSecret::random_from_rng(OsRng);
        let bob_spk_pub = X25519Public::from(&bob_spk);

        let mut alice = RatchetSession::init_alice(
            "sess-2".into(),
            "bob".into(),
            shared_key,
            &bob_spk_pub,
        )
        .unwrap();

        let mut bob = RatchetSession::init_bob(
            "sess-2".into(),
            "alice".into(),
            shared_key,
            &bob_spk,
            &bob_spk_pub,
        )
        .unwrap();

        // Alice sends 3 messages
        let (h0, mk0) = alice.encrypt_step().unwrap();
        let (h1, mk1) = alice.encrypt_step().unwrap();
        let (h2, mk2) = alice.encrypt_step().unwrap();

        // Bob receives message 2 first (skipping 0 and 1)
        let mk2_bob = bob.decrypt_step(&h2).unwrap();
        assert_eq!(mk2, mk2_bob);

        // Now Bob receives message 0 (from skipped keys)
        let mk0_bob = bob.decrypt_step(&h0).unwrap();
        assert_eq!(mk0, mk0_bob);

        // And message 1
        let mk1_bob = bob.decrypt_step(&h1).unwrap();
        assert_eq!(mk1, mk1_bob);
    }
}
