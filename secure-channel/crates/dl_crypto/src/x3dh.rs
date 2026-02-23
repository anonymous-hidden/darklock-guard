//! X3DH-like asynchronous key agreement.
//!
//! References:
//!   - Signal X3DH spec: <https://signal.org/docs/specifications/x3dh/>
//!   - RFC 7748 (X25519): <https://datatracker.ietf.org/doc/html/rfc7748>
//!   - RFC 5869 (HKDF):  <https://datatracker.ietf.org/doc/html/rfc5869>
//!
//! Protocol:
//!   Alice (initiator) fetches Bob's published key bundle from IDS:
//!     IK_B  (identity, Ed25519 public → converted to X25519)
//!     SPK_B (signed prekey, X25519) + IK_B signature over SPK_B
//!     OPK_B (optional one-time prekey, X25519)
//!
//!   Alice generates ONE ephemeral keypair EK_A (X25519).
//!
//!   DH calculations (using a single EK_A throughout):
//!     DH1 = DH(IK_A_x25519, SPK_B)     — mutual authentication
//!     DH2 = DH(EK_A,         IK_B_x25519) — forward secrecy
//!     DH3 = DH(EK_A,         SPK_B)     — replay protection
//!     DH4 = DH(EK_A,         OPK_B)     — one-time forward secrecy [optional]
//!
//!   SK = HKDF(salt=0, ikm = 0xFF*32 || DH1 || DH2 || DH3 [|| DH4], info="dl-x3dh-v1")
//!
//! Non-negotiable:
//!   - Alice MUST verify SPK_B signature before computing any DH.
//!   - Alice sends (IK_A_pub, EK_A_pub, opk_id?) as the init header.
//!   - Bob reconstructs the same DH set and derives SK.
//!   - The SK feeds into the Double Ratchet as the initial root key.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use x25519_dalek::{PublicKey as X25519Public, StaticSecret};
use zeroize::Zeroize;

use crate::{
    error::CryptoError,
    identity::IdentityKeyPair,
    kdf,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

fn b64d(s: &str) -> Result<Vec<u8>, CryptoError> {
    URL_SAFE_NO_PAD
        .decode(s)
        .map_err(CryptoError::Base64Decode)
}

fn to_32(bytes: &[u8]) -> Result<[u8; 32], CryptoError> {
    bytes
        .try_into()
        .map_err(|_| CryptoError::InvalidKey("expected 32-byte key".into()))
}

/// Convert an Ed25519 signing key (32 bytes) to an X25519 static secret.
/// This uses the clamped SHA-512 expansion that ed25519-dalek uses internally,
/// mirroring libsignal's approach to IK → X25519 conversion.
pub fn ed25519_secret_to_x25519(ed_secret: &[u8; 32]) -> StaticSecret {
    use sha2::{Digest, Sha512};
    let mut h = Sha512::digest(ed_secret);
    // Clamp as per RFC 7748 §5
    h[0] &= 248;
    h[31] &= 127;
    h[31] |= 64;
    let mut key = [0u8; 32];
    key.copy_from_slice(&h[..32]);
    h.as_mut_slice().zeroize();
    StaticSecret::from(key)
}

/// Convert an Ed25519 verifying key (public, 32 bytes) to an X25519 public key.
/// Uses the birational map from the Ed25519 curve to Curve25519.
pub fn ed25519_pub_to_x25519(ed_pub: &[u8; 32]) -> Result<X25519Public, CryptoError> {
    use curve25519_dalek::edwards::CompressedEdwardsY;
    let compressed = CompressedEdwardsY::from_slice(ed_pub)
        .map_err(|_| CryptoError::InvalidKey("invalid Ed25519 public key".into()))?;
    let point = compressed.decompress().ok_or_else(|| {
        CryptoError::InvalidKey("Ed25519 public key decompression failed".into())
    })?;
    let montgomery = point.to_montgomery();
    Ok(X25519Public::from(montgomery.to_bytes()))
}

// ── Prekey bundle ────────────────────────────────────────────────────────────

/// Published by each user/device via IDS, consumed by session initiators.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrekeyBundle {
    pub user_id: String,
    /// Ed25519 identity public key (base64)
    pub ik_pub: String,
    /// X25519 signed prekey (base64)
    pub spk_pub: String,
    /// Ed25519 signature over raw SPK_pub bytes (base64)
    pub spk_sig: String,
    /// X25519 one-time prekey (consumed once; base64)
    pub opk_pub: Option<String>,
    /// Opaque OPK identifier so server can delete the used one
    pub opk_id: Option<String>,
}

/// Generate a signed prekey: an X25519 keypair with the public half signed
/// by the user's Ed25519 identity key.
pub fn generate_signed_prekey(
    identity: &IdentityKeyPair,
) -> Result<(StaticSecret, X25519Public, Vec<u8>), CryptoError> {
    let secret = StaticSecret::random_from_rng(OsRng);
    let public = X25519Public::from(&secret);
    let sig = identity.sign(public.as_bytes());
    Ok((secret, public, sig))
}

/// Generate a batch of one-time prekeys (X25519).
/// Returns Vec<(secret, public)>.
pub fn generate_one_time_prekeys(count: usize) -> Vec<(StaticSecret, X25519Public)> {
    (0..count)
        .map(|_| {
            let s = StaticSecret::random_from_rng(OsRng);
            let p = X25519Public::from(&s);
            (s, p)
        })
        .collect()
}

// ── Init message header ──────────────────────────────────────────────────────

/// Sent alongside the first ciphertext so the responder can derive SK.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct X3DHHeader {
    pub session_id: String,
    pub sender_user_id: String,
    /// Alice's Ed25519 identity public key (base64) — responder looks this up
    pub ik_pub: String,
    /// Alice's ephemeral X25519 public key (base64)
    pub ek_pub: String,
    /// Which OPK was consumed (opaque id; `None` if bundle had none)
    pub opk_id: Option<String>,
}

// ── Output ───────────────────────────────────────────────────────────────────

/// Result of the X3DH handshake: a shared secret plus the init header.
pub struct X3DHResult {
    /// 32-byte shared key → feeds into Double Ratchet as initial root key
    pub shared_key: [u8; 32],
    pub header: X3DHHeader,
}

// ── Initiator (Alice) ────────────────────────────────────────────────────────

/// Alice initiates a session with Bob.
///
/// Steps:
///   1. Verify SPK_B signature using IK_B (Ed25519).
///   2. Convert IK_A secret → X25519; convert IK_B pub → X25519.
///   3. Generate ONE ephemeral X25519 keypair EK_A.
///   4. Compute DH1..DH4.
///   5. Derive SK via HKDF.
pub fn initiate(
    my_user_id: &str,
    my_ik: &IdentityKeyPair,
    bundle: &PrekeyBundle,
) -> Result<X3DHResult, CryptoError> {
    // ── 1. Verify SPK signature ──────────────────────────────────────────
    let ik_b_ed_bytes = b64d(&bundle.ik_pub)?;
    let ik_b_ed = to_32(&ik_b_ed_bytes)?;
    let spk_b_bytes = b64d(&bundle.spk_pub)?;
    let spk_b_raw = to_32(&spk_b_bytes)?;
    let spk_sig_bytes = b64d(&bundle.spk_sig)?;

    // Verify with Ed25519
    IdentityKeyPair::verify(&ik_b_ed, &spk_b_raw, &spk_sig_bytes)?;

    // ── 2. Convert identity keys to X25519 ───────────────────────────────
    let ik_a_x = ed25519_secret_to_x25519(my_ik.secret_bytes());
    let ik_b_x = ed25519_pub_to_x25519(&ik_b_ed)?;
    let spk_b = X25519Public::from(spk_b_raw);

    // ── 3. Generate ephemeral key ────────────────────────────────────────
    let ek_a = StaticSecret::random_from_rng(OsRng);
    let ek_a_pub = X25519Public::from(&ek_a);

    // ── 4. DH calculations (single EK for all) ──────────────────────────
    let dh1 = ik_a_x.diffie_hellman(&spk_b);    // IK_A × SPK_B
    let dh2 = ek_a.diffie_hellman(&ik_b_x);     // EK_A × IK_B
    let dh3 = ek_a.diffie_hellman(&spk_b);      // EK_A × SPK_B

    let mut ikm = vec![0xFFu8; 32]; // domain separation pad
    ikm.extend_from_slice(dh1.as_bytes());
    ikm.extend_from_slice(dh2.as_bytes());
    ikm.extend_from_slice(dh3.as_bytes());

    let mut opk_id_out = None;
    if let Some(ref opk_b64) = bundle.opk_pub {
        let opk_raw = to_32(&b64d(opk_b64)?)?;
        let opk_b = X25519Public::from(opk_raw);
        let dh4 = ek_a.diffie_hellman(&opk_b);  // EK_A × OPK_B
        ikm.extend_from_slice(dh4.as_bytes());
        opk_id_out = bundle.opk_id.clone();
    }

    // ── 5. Derive SK ─────────────────────────────────────────────────────
    let mut sk = [0u8; 32];
    kdf::hkdf_expand(&ikm, Some(&[0u8; 32]), b"dl-x3dh-v1", &mut sk)?;
    ikm.zeroize();

    let session_id = uuid::Uuid::new_v4().to_string();

    Ok(X3DHResult {
        shared_key: sk,
        header: X3DHHeader {
            session_id,
            sender_user_id: my_user_id.to_string(),
            ik_pub: URL_SAFE_NO_PAD.encode(&my_ik.public.0),
            ek_pub: URL_SAFE_NO_PAD.encode(ek_a_pub.as_bytes()),
            opk_id: opk_id_out,
        },
    })
}

// ── Responder (Bob) ──────────────────────────────────────────────────────────

/// Bob receives an X3DH init header and reconstructs SK.
///
/// `my_ik` — Bob's Ed25519 identity keypair
/// `my_spk_secret` — Bob's signed prekey X25519 secret
/// `my_opk_secret` — The consumed OPK secret (if the init used one)
/// `sender_ik_ed_pub` — Alice's Ed25519 identity public key (fetched from IDS to verify)
pub fn respond(
    my_ik: &IdentityKeyPair,
    my_spk_secret: &StaticSecret,
    my_opk_secret: Option<&StaticSecret>,
    sender_ik_ed_pub: &[u8; 32],
    header: &X3DHHeader,
) -> Result<[u8; 32], CryptoError> {
    let ek_a_bytes = b64d(&header.ek_pub)?;
    let ek_a = X25519Public::from(to_32(&ek_a_bytes)?);

    let sender_ik_x = ed25519_pub_to_x25519(sender_ik_ed_pub)?;
    let ik_b_x = ed25519_secret_to_x25519(my_ik.secret_bytes());

    // Mirror Alice's DH order exactly:
    //   DH1 = IK_A × SPK_B   →  Bob: SPK_B × IK_A  (commutative)
    //   DH2 = EK_A × IK_B    →  Bob: IK_B × EK_A
    //   DH3 = EK_A × SPK_B   →  Bob: SPK_B × EK_A
    let dh1 = my_spk_secret.diffie_hellman(&sender_ik_x);
    let dh2 = ik_b_x.diffie_hellman(&ek_a);
    let dh3 = my_spk_secret.diffie_hellman(&ek_a);

    let mut ikm = vec![0xFFu8; 32];
    ikm.extend_from_slice(dh1.as_bytes());
    ikm.extend_from_slice(dh2.as_bytes());
    ikm.extend_from_slice(dh3.as_bytes());

    if let Some(opk_sec) = my_opk_secret {
        let dh4 = opk_sec.diffie_hellman(&ek_a);
        ikm.extend_from_slice(dh4.as_bytes());
    }

    let mut sk = [0u8; 32];
    kdf::hkdf_expand(&ikm, Some(&[0u8; 32]), b"dl-x3dh-v1", &mut sk)?;
    ikm.zeroize();

    Ok(sk)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn x3dh_roundtrip_without_opk() {
        let alice_ik = IdentityKeyPair::generate().unwrap();
        let bob_ik = IdentityKeyPair::generate().unwrap();

        // Bob publishes a prekey bundle
        let (bob_spk_secret, bob_spk_pub, bob_spk_sig) =
            generate_signed_prekey(&bob_ik).unwrap();

        let bundle = PrekeyBundle {
            user_id: "bob".into(),
            ik_pub: URL_SAFE_NO_PAD.encode(&bob_ik.public.0),
            spk_pub: URL_SAFE_NO_PAD.encode(bob_spk_pub.as_bytes()),
            spk_sig: URL_SAFE_NO_PAD.encode(&bob_spk_sig),
            opk_pub: None,
            opk_id: None,
        };

        // Alice initiates
        let result = initiate("alice", &alice_ik, &bundle).unwrap();

        // Bob responds
        let alice_ik_ed: [u8; 32] = alice_ik.public.0.clone().try_into().unwrap();
        let bob_sk = respond(
            &bob_ik,
            &bob_spk_secret,
            None,
            &alice_ik_ed,
            &result.header,
        )
        .unwrap();

        assert_eq!(result.shared_key, bob_sk, "Alice and Bob must derive the same SK");
    }

    #[test]
    fn x3dh_roundtrip_with_opk() {
        let alice_ik = IdentityKeyPair::generate().unwrap();
        let bob_ik = IdentityKeyPair::generate().unwrap();

        let (bob_spk_secret, bob_spk_pub, bob_spk_sig) =
            generate_signed_prekey(&bob_ik).unwrap();
        let opks = generate_one_time_prekeys(1);
        let (ref bob_opk_secret, ref bob_opk_pub) = opks[0];

        let bundle = PrekeyBundle {
            user_id: "bob".into(),
            ik_pub: URL_SAFE_NO_PAD.encode(&bob_ik.public.0),
            spk_pub: URL_SAFE_NO_PAD.encode(bob_spk_pub.as_bytes()),
            spk_sig: URL_SAFE_NO_PAD.encode(&bob_spk_sig),
            opk_pub: Some(URL_SAFE_NO_PAD.encode(bob_opk_pub.as_bytes())),
            opk_id: Some("opk-0".into()),
        };

        let result = initiate("alice", &alice_ik, &bundle).unwrap();

        let alice_ik_ed: [u8; 32] = alice_ik.public.0.clone().try_into().unwrap();
        let bob_sk = respond(
            &bob_ik,
            &bob_spk_secret,
            Some(bob_opk_secret),
            &alice_ik_ed,
            &result.header,
        )
        .unwrap();

        assert_eq!(result.shared_key, bob_sk);
        assert_eq!(result.header.opk_id.as_deref(), Some("opk-0"));
    }

    #[test]
    fn rejects_invalid_spk_signature() {
        let alice_ik = IdentityKeyPair::generate().unwrap();
        let bob_ik = IdentityKeyPair::generate().unwrap();
        let evil_ik = IdentityKeyPair::generate().unwrap();

        let (_spk_secret, spk_pub, _good_sig) = generate_signed_prekey(&bob_ik).unwrap();
        // Sign SPK with evil key, but claim it's from bob
        let evil_sig = evil_ik.sign(spk_pub.as_bytes());

        let bundle = PrekeyBundle {
            user_id: "bob".into(),
            ik_pub: URL_SAFE_NO_PAD.encode(&bob_ik.public.0),
            spk_pub: URL_SAFE_NO_PAD.encode(spk_pub.as_bytes()),
            spk_sig: URL_SAFE_NO_PAD.encode(&evil_sig),
            opk_pub: None,
            opk_id: None,
        };

        let err = initiate("alice", &alice_ik, &bundle);
        assert!(err.is_err(), "Must reject SPK signed by wrong identity");
    }
}
