use crate::connected::commands::ServerCommand;
use anyhow::{anyhow, Result};
use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub struct Verifier {
    server_public_key: Option<VerifyingKey>,
}

impl Verifier {
    pub fn new(server_public_key: Option<String>) -> Self {
        let parsed = server_public_key.and_then(|k| decode_key(&k).ok());
        Self {
            server_public_key: parsed,
        }
    }

    pub fn verify_command(&self, cmd: &ServerCommand) -> Result<()> {
        let key = self
            .server_public_key
            .as_ref()
            .ok_or_else(|| anyhow!("missing server key"))?;
        let message = canonical_command_message(cmd);
        let signature = decode_signature(&cmd.signature)?;
        key.verify_strict(&message, &signature)
            .map_err(|e| anyhow!("verify failed: {e}"))
    }
}

fn decode_key(b64: &str) -> Result<VerifyingKey> {
    let bytes = general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| anyhow!("decode key: {e}"))?;
    let arr: [u8; 32] = bytes.try_into().map_err(|_| anyhow!("public key length"))?;
    VerifyingKey::from_bytes(&arr).map_err(|e| anyhow!("key parse: {e}"))
}

fn decode_signature(b64: &str) -> Result<Signature> {
    let bytes = general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| anyhow!("decode signature: {e}"))?;
    let arr: [u8; 64] = bytes.try_into().map_err(|_| anyhow!("signature length"))?;
    Ok(Signature::from_bytes(&arr))
}

pub fn canonical_command_message(cmd: &ServerCommand) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(cmd.command.as_bytes());
    hasher.update(cmd.nonce.as_bytes());
    hasher.update(cmd.expires_at.to_rfc3339().as_bytes());
    hasher.update(serde_json::to_vec(&cmd.payload).unwrap_or_default());
    hasher.finalize().to_vec()
}

pub fn canonical_result_message(
    command_id: &str,
    nonce: &str,
    status: &str,
    payload: &Value,
) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(command_id.as_bytes());
    hasher.update(nonce.as_bytes());
    hasher.update(status.as_bytes());
    hasher.update(serde_json::to_vec(payload).unwrap_or_default());
    hasher.finalize().to_vec()
}

#[allow(dead_code)]
pub fn sign_payload(
    signing_key: &SigningKey,
    command_id: &str,
    nonce: &str,
    status: &str,
    payload: &Value,
) -> String {
    let message = canonical_result_message(command_id, nonce, status, payload);
    let sig = signing_key.sign(&message);
    general_purpose::STANDARD.encode(sig.to_bytes())
}
