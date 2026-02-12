use chrono::{Duration, Utc};
use ed25519_dalek::{Signer, SigningKey};
use guard_core::vault::SecurityProfile;
use guard_service::connected::commands::{validate_command, CommandValidationError, ServerCommand};
use guard_service::connected::state::NonceBook;
use guard_service::connected::verifier::{canonical_command_message, Verifier};
use serde_json::json;

fn sign_command(cmd: &ServerCommand, key: &SigningKey) -> String {
    use base64::{engine::general_purpose, Engine as _};
    let msg = canonical_command_message(cmd);
    let sig = key.sign(&msg);
    general_purpose::STANDARD.encode(sig.to_bytes())
}

fn base64_key(key: &SigningKey) -> String {
    use base64::{engine::general_purpose, Engine as _};
    general_purpose::STANDARD.encode(key.verifying_key().to_bytes())
}

fn sample_command() -> (ServerCommand, SigningKey) {
    let signing = SigningKey::generate(&mut rand::rngs::OsRng);
    let cmd = ServerCommand {
        id: "cmd-1".to_string(),
        command: "restart".to_string(),
        payload: json!({"target": "service"}),
        nonce: "abc".to_string(),
        signature: String::new(),
        expires_at: Utc::now() + Duration::minutes(5),
    };
    (cmd, signing)
}

fn enter_safe_mode_command() -> (ServerCommand, SigningKey) {
    let signing = SigningKey::generate(&mut rand::rngs::OsRng);
    let cmd = ServerCommand {
        id: "cmd-safe".to_string(),
        command: "ENTER_SAFE_MODE".to_string(),
        payload: json!({"reason": "REMOTE_COMMAND"}),
        nonce: "safe-nonce".to_string(),
        signature: String::new(),
        expires_at: Utc::now() + Duration::minutes(5),
    };
    (cmd, signing)
}

#[test]
fn zero_trust_rejects_commands() {
    let (mut cmd, key) = sample_command();
    cmd.signature = sign_command(&cmd, &key);
    let mut nonce_book = NonceBook::default();
    let verifier = Verifier::new(Some(base64_key(&key)));
    let res = validate_command(
        &cmd,
        &SecurityProfile::ZeroTrust,
        &mut nonce_book,
        &verifier,
    );
    assert_eq!(res.unwrap_err(), CommandValidationError::ZeroTrust);
}

#[test]
fn replay_nonce_is_rejected() {
    let (mut cmd, key) = sample_command();
    cmd.signature = sign_command(&cmd, &key);
    let mut nonce_book = NonceBook::default();
    let verifier = Verifier::new(Some(base64_key(&key)));
    let profile = SecurityProfile::Normal;

    assert!(validate_command(&cmd, &profile, &mut nonce_book, &verifier).is_ok());
    let err = validate_command(&cmd, &profile, &mut nonce_book, &verifier).unwrap_err();
    assert_eq!(err, CommandValidationError::Replay);
}

#[test]
fn invalid_signature_rejected() {
    let (mut cmd, key) = sample_command();
    // Sign with a different key to force failure
    let other_key = SigningKey::generate(&mut rand::rngs::OsRng);
    cmd.signature = sign_command(&cmd, &other_key);
    let mut nonce_book = NonceBook::default();
    let verifier = Verifier::new(Some(base64_key(&key)));
    let err =
        validate_command(&cmd, &SecurityProfile::Normal, &mut nonce_book, &verifier).unwrap_err();
    assert_eq!(err, CommandValidationError::InvalidSignature);
}

#[test]
fn expired_command_rejected() {
    let (mut cmd, key) = sample_command();
    cmd.expires_at = Utc::now() - Duration::minutes(1);
    cmd.signature = sign_command(&cmd, &key);
    let mut nonce_book = NonceBook::default();
    let verifier = Verifier::new(Some(base64_key(&key)));
    let err =
        validate_command(&cmd, &SecurityProfile::Normal, &mut nonce_book, &verifier).unwrap_err();
    assert_eq!(err, CommandValidationError::Expired);
}

#[test]
fn enter_safe_mode_validates_for_normal_profile() {
    let (mut cmd, key) = enter_safe_mode_command();
    cmd.signature = sign_command(&cmd, &key);
    let mut nonce_book = NonceBook::default();
    let verifier = Verifier::new(Some(base64_key(&key)));
    let res = validate_command(&cmd, &SecurityProfile::Normal, &mut nonce_book, &verifier);
    assert!(res.is_ok());
}

#[test]
fn enter_safe_mode_rejected_for_zero_trust() {
    let (mut cmd, key) = enter_safe_mode_command();
    cmd.signature = sign_command(&cmd, &key);
    let mut nonce_book = NonceBook::default();
    let verifier = Verifier::new(Some(base64_key(&key)));
    let res = validate_command(
        &cmd,
        &SecurityProfile::ZeroTrust,
        &mut nonce_book,
        &verifier,
    );
    assert_eq!(res.unwrap_err(), CommandValidationError::ZeroTrust);
}

#[test]
fn enter_safe_mode_replay_rejected() {
    let (mut cmd, key) = enter_safe_mode_command();
    cmd.signature = sign_command(&cmd, &key);
    let mut nonce_book = NonceBook::default();
    let verifier = Verifier::new(Some(base64_key(&key)));
    assert!(validate_command(&cmd, &SecurityProfile::Normal, &mut nonce_book, &verifier).is_ok());
    let err =
        validate_command(&cmd, &SecurityProfile::Normal, &mut nonce_book, &verifier).unwrap_err();
    assert_eq!(err, CommandValidationError::Replay);
}
