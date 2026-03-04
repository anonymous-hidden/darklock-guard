use crate::util::hash_file;
use anyhow::{anyhow, Result};
use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::{Signature, VerifyingKey};
use std::path::Path;

// Embedded release public key (public, not secret). Replace with production key during release.
const RELEASE_PUBKEY_BASE64: &str = "HGpW+VZdkHokHEBYJt1S03+ReHFaxY+Rb7gPix7KeDY=";

fn release_pubkey() -> Result<VerifyingKey> {
    let b64 = std::env::var("DARKLOCK_RELEASE_PUBKEY_B64")
        .unwrap_or_else(|_| RELEASE_PUBKEY_BASE64.to_string());
    let bytes = general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| anyhow!("decode pubkey: {e}"))?;
    let bytes: [u8; 32] = bytes.try_into().map_err(|_| anyhow!("pubkey length"))?;
    VerifyingKey::from_bytes(&bytes).map_err(|e| anyhow!("pubkey invalid: {e}"))
}

pub fn verify_sha256(path: &Path, expected_hex: &str) -> Result<()> {
    let actual = hash_file(path)?;
    if actual != expected_hex {
        return Err(anyhow!("hash mismatch"));
    }
    Ok(())
}

pub fn verify_release_signature(path: &Path, signature_b64: &str) -> Result<()> {
    let pubkey = release_pubkey()?;
    let sig_bytes = general_purpose::STANDARD
        .decode(signature_b64)
        .map_err(|e| anyhow!("decode signature: {e}"))?;
    let sig_bytes: [u8; 64] = sig_bytes
        .try_into()
        .map_err(|_| anyhow!("signature length"))?;
    let sig = Signature::from_bytes(&sig_bytes);
    let data = std::fs::read(path)?;
    pubkey
        .verify_strict(&data, &sig)
        .map_err(|e| anyhow!("signature verify failed: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use rand::rngs::OsRng;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn hash_mismatch() {
        let mut f = NamedTempFile::new().unwrap();
        writeln!(f, "hello").unwrap();
        let path = f.path();
        assert!(verify_sha256(path, "deadbeef").is_err());
    }

    #[test]
    fn signature_roundtrip_with_override() {
        let signing = SigningKey::generate(&mut OsRng);
        let verify = signing.verifying_key();
        std::env::set_var(
            "DARKLOCK_RELEASE_PUBKEY_B64",
            general_purpose::STANDARD.encode(verify.to_bytes()),
        );
        let mut f = NamedTempFile::new().unwrap();
        writeln!(f, "payload").unwrap();
        let data = std::fs::read(f.path()).unwrap();
        let sig = signing.sign(&data);
        let sig_b64 = general_purpose::STANDARD.encode(sig.to_bytes());
        verify_release_signature(f.path(), &sig_b64).unwrap();
    }
}
