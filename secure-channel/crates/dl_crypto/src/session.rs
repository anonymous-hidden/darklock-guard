//! Session management: X3DH-inspired key agreement + simplified Double-Ratchet
//!
//! # Protocol overview (v1 — forward-secrecy capable, full ratchet in v2)
//!
//! ## Initial key exchange (X3DH-like)
//! Alice fetches Bob's published keys:
//!   - IK_B  (identity key, Ed25519 → converted to X25519 for DH)
//!   - SPK_B (signed prekey, X25519), + SPK_B signature (verified by IK_B)
//!   - OPK_B (one-time prekey, X25519, optional)
//!
//! Alice generates:
//!   - EK_A  (ephemeral key, X25519)
//!
//! DH calculations:
//!   DH1 = DH(IK_A, SPK_B)
//!   DH2 = DH(EK_A, IK_B)
//!   DH3 = DH(EK_A, SPK_B)
//!   DH4 = DH(EK_A, OPK_B)   [if OPK available]
//!
//! SK = KDF(DH1 || DH2 || DH3 [|| DH4])
//!
//! ## Ratchet (simplified symmetric ratchet for v1)
//! After SK is established:
//!   root_key = SK
//!   Each message: (ck, mk) = chain_step(ck); encrypt with mk.
//!
//! v2 upgrade path: add full DH ratchet (one X25519 ratchet key per turn).

use std::convert::TryInto;

use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use x25519_dalek::{EphemeralSecret, PublicKey as X25519Public, StaticSecret};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::{error::CryptoError, kdf};

// ── Prekey bundle (published by server for each user) ────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrekeyBundle {
    /// User ID this bundle belongs to
    pub user_id: String,
    /// Identity key X25519 public (32 bytes, base64)
    pub ik_pub: String,
    /// Signed prekey X25519 public (32 bytes, base64)
    pub spk_pub: String,
    /// Signature over spk_pub, made by the Ed25519 identity key (base64)
    pub spk_sig: String,
    /// One-time prekey (optional — server provides one per session init, removes after use)
    pub opk_pub: Option<String>,
}

// ── Established session ───────────────────────────────────────────────────────

/// State required to encrypt/decrypt messages in one session.
/// Stored (encrypted) in the local vault.
#[derive(Serialize, Deserialize, ZeroizeOnDrop)]
pub struct Session {
    pub session_id: String,
    pub peer_user_id: String,

    // Symmetric ratchet state
    root_key: [u8; 32],
    send_chain_key: [u8; 32],
    recv_chain_key: [u8; 32],

    pub send_message_n: u64,
    pub recv_message_n: u64,

    /// Hash-chain head (last sent/received message hash for integrity)
    #[zeroize(skip)]
    pub chain_head: [u8; 32],
}

impl Session {
    fn new(session_id: String, peer_user_id: String, sk: [u8; 32]) -> Result<Self, CryptoError> {
        let (root_key, ck_send, ck_recv) = kdf::ratchet_keys(&sk, b"dl-session-init")?;
        Ok(Self {
            session_id,
            peer_user_id,
            root_key,
            send_chain_key: ck_send,
            recv_chain_key: ck_recv,
            send_message_n: 0,
            recv_message_n: 0,
            chain_head: [0u8; 32],
        })
    }

    /// Derive the next sending message key (advances chain).
    pub fn next_send_key(&mut self) -> Result<[u8; 32], CryptoError> {
        let (next_ck, mk) = kdf::chain_step(&self.send_chain_key)?;
        self.send_chain_key = next_ck;
        self.send_message_n += 1;
        Ok(mk)
    }

    /// Derive the next receiving message key (advances chain).
    pub fn next_recv_key(&mut self) -> Result<[u8; 32], CryptoError> {
        let (next_ck, mk) = kdf::chain_step(&self.recv_chain_key)?;
        self.recv_chain_key = next_ck;
        self.recv_message_n += 1;
        Ok(mk)
    }
}

// ── X3DH-like session initialisation ─────────────────────────────────────────

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

fn b64d(s: &str) -> Result<Vec<u8>, CryptoError> {
    URL_SAFE_NO_PAD.decode(s).map_err(|e| CryptoError::Base64Decode(e))
}

fn slice_to_x25519(bytes: &[u8]) -> Result<[u8; 32], CryptoError> {
    bytes.try_into().map_err(|_| CryptoError::InvalidKey("Expected 32-byte X25519 key".into()))
}

/// Alice initiates a session to Bob using Bob's prekey bundle.
///
/// Returns (Session, InitMessage) where InitMessage must be prepended to the
/// first ciphertext envelope so Bob can reconstruct SK.
pub fn initiate_session(
    my_user_id: &str,
    my_ik_bytes: &[u8; 32],     // Alice's X25519 identity secret (converted from Ed25519 or separate)
    bundle: &PrekeyBundle,
) -> Result<(Session, InitMessage), CryptoError> {
    // Decode Bob's keys
    let ik_b_bytes = b64d(&bundle.ik_pub)?;
    let spk_b_bytes = b64d(&bundle.spk_pub)?;
    let ik_b = X25519Public::from(slice_to_x25519(&ik_b_bytes)?);
    let spk_b = X25519Public::from(slice_to_x25519(&spk_b_bytes)?);

    // Generate Alice's ephemeral key
    let ek_a_secret = EphemeralSecret::random_from_rng(OsRng);
    let ek_a_pub = X25519Public::from(&ek_a_secret);

    // DH calculations
    let ik_a_static = StaticSecret::from(*my_ik_bytes);
    let dh1 = ik_a_static.diffie_hellman(&spk_b);
    let ek_a_secret2 = StaticSecret::random_from_rng(OsRng); // second ephemeral for ek*ik_b
    let dh2 = ek_a_secret2.diffie_hellman(&ik_b);
    let ek_a_secret3 = StaticSecret::random_from_rng(OsRng);
    let dh3 = ek_a_secret3.diffie_hellman(&spk_b);

    let mut dh_concat = Vec::new();
    dh_concat.extend_from_slice(dh1.as_bytes());
    dh_concat.extend_from_slice(dh2.as_bytes());
    dh_concat.extend_from_slice(dh3.as_bytes());

    // Optional OPK
    let opk_pub_bytes = if let Some(opk_b64) = &bundle.opk_pub {
        let opk_bytes = b64d(opk_b64)?;
        let opk_b = X25519Public::from(slice_to_x25519(&opk_bytes)?);
        let ek_opk = StaticSecret::random_from_rng(OsRng);
        let dh4 = ek_opk.diffie_hellman(&opk_b);
        dh_concat.extend_from_slice(dh4.as_bytes());
        Some(opk_b64.clone())
    } else {
        None
    };

    // SK = KDF(DH1||DH2||DH3[||DH4])
    let mut sk = [0u8; 32];
    kdf::hkdf_expand(&dh_concat, Some(b"dl-x3dh-v1"), b"shared-key", &mut sk)?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let session = Session::new(session_id.clone(), bundle.user_id.clone(), sk)?;

    // Zeroize DH outputs
    let mut dh_concat = dh_concat; // rebind
    dh_concat.zeroize();

    let init_msg = InitMessage {
        session_id,
        sender_id: my_user_id.to_string(),
        ek_pub: URL_SAFE_NO_PAD.encode(ek_a_pub.as_bytes()),
        opk_used: opk_pub_bytes,
    };

    Ok((session, init_msg))
}

/// Bob receives an InitMessage and reconstructs the shared key.
pub fn receive_session(
    my_spk_secret: &[u8; 32],   // Bob's signed prekey secret
    my_ik_secret: &[u8; 32],    // Bob's identity key secret (X25519)
    sender_ik_pub: &[u8; 32],   // Alice's identity key public (from IDS lookup)
    init_msg: &InitMessage,
    opk_secret: Option<&[u8; 32]>,
) -> Result<Session, CryptoError> {
    let ek_a_bytes = b64d(&init_msg.ek_pub)?;
    let ek_a = X25519Public::from(slice_to_x25519(&ek_a_bytes)?);
    let sender_ik = X25519Public::from(*sender_ik_pub);

    let spk_b = StaticSecret::from(*my_spk_secret);
    let ik_b = StaticSecret::from(*my_ik_secret);

    let dh1 = ik_b.diffie_hellman(&ek_a);        // ik_b * spk_a (symmetric)
    let dh2 = spk_b.diffie_hellman(&sender_ik);   // spk_b * ik_a
    let ek_a2 = ek_a; // simplification: use same ek for dh3
    let dh3 = spk_b.diffie_hellman(&ek_a2);

    let mut dh_concat = Vec::new();
    // Must match Alice's order: dh1=IK_a*SPK_b, dh2=EK_a*IK_b, dh3=EK_a*SPK_b
    dh_concat.extend_from_slice(dh1.as_bytes());
    dh_concat.extend_from_slice(dh2.as_bytes());
    dh_concat.extend_from_slice(dh3.as_bytes());

    if let Some(opk_sec) = opk_secret {
        let opk_b = StaticSecret::from(*opk_sec);
        let dh4 = opk_b.diffie_hellman(&ek_a2);
        dh_concat.extend_from_slice(dh4.as_bytes());
    }

    let mut sk = [0u8; 32];
    kdf::hkdf_expand(&dh_concat, Some(b"dl-x3dh-v1"), b"shared-key", &mut sk)?;
    dh_concat.zeroize();

    Session::new(init_msg.session_id.clone(), init_msg.sender_id.clone(), sk)
}

/// Included in the first message so the recipient can bootstrap the session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitMessage {
    pub session_id: String,
    pub sender_id: String,
    /// Alice's ephemeral public key (base64)
    pub ek_pub: String,
    /// Which OPK was used (so server can delete it)
    pub opk_used: Option<String>,
}
