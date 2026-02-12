use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use predicates::prelude::*;
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::Path;
use tempfile::tempdir;

fn make_package(dir: &Path) -> (String, String) {
    let pkg_path = dir.join("pkg.tar.gz");
    let file_path = dir.join("file.txt");
    fs::write(&file_path, b"hello-world").unwrap();
    let tar_gz = fs::File::create(&pkg_path).unwrap();
    let enc = flate2::write::GzEncoder::new(tar_gz, flate2::Compression::default());
    let mut tar = tar::Builder::new(enc);
    tar.append_path_with_name(&file_path, "file.txt").unwrap();
    tar.finish().unwrap();
    (
        pkg_path.display().to_string(),
        file_path.display().to_string(),
    )
}

fn sha256_hex(path: &str) -> String {
    let mut file = fs::File::open(path).unwrap();
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = file.read(&mut buf).unwrap();
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    hex::encode(hasher.finalize())
}

fn sign_file(path: &str, signing: &SigningKey) -> String {
    let data = fs::read(path).unwrap();
    let sig = signing.sign(&data);
    general_purpose::STANDARD.encode(sig.to_bytes())
}

fn write_manifest(path: &Path, url: &str, sha: &str, sig: &str, revoked: bool) {
    let manifest = serde_json::json!({
        "version": "2.0.0-test",
        "download_url": url,
        "sha256": sha,
        "signature": sig,
        "revoked": revoked
    });
    fs::write(path, serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();
}

fn set_release_pubkey_env(signing: &SigningKey) {
    let verify = signing.verifying_key();
    std::env::set_var(
        "DARKLOCK_RELEASE_PUBKEY_B64",
        general_purpose::STANDARD.encode(verify.to_bytes()),
    );
}

#[test]
fn stage_rejects_hash_mismatch() {
    let dir = tempdir().unwrap();
    let (pkg_path, _) = make_package(dir.path());
    let manifest_path = dir.path().join("manifest.json");
    let signing = SigningKey::generate(&mut OsRng);
    set_release_pubkey_env(&signing);
    write_manifest(
        &manifest_path,
        &format!("file://{}", pkg_path),
        "deadbeef",
        "badsig",
        false,
    );
    let mut cmd = assert_cmd::Command::cargo_bin("updater-helper").unwrap();
    cmd.arg("stage").arg("--manifest").arg(manifest_path);
    cmd.assert()
        .failure()
        .stderr(predicate::str::contains("hash mismatch"));
}

#[test]
fn stage_rejects_bad_signature() {
    let dir = tempdir().unwrap();
    let (pkg_path, _) = make_package(dir.path());
    let manifest_path = dir.path().join("manifest.json");
    let signing = SigningKey::generate(&mut OsRng);
    set_release_pubkey_env(&signing);
    let sha = sha256_hex(&pkg_path);
    write_manifest(
        &manifest_path,
        &format!("file://{}", pkg_path),
        &sha,
        "badsig",
        false,
    );
    let mut cmd = assert_cmd::Command::cargo_bin("updater-helper").unwrap();
    cmd.arg("stage").arg("--manifest").arg(manifest_path);
    cmd.assert()
        .failure()
        .stderr(predicate::str::contains("signature"));
}

#[test]
fn stage_rejects_revoked() {
    let dir = tempdir().unwrap();
    let (pkg_path, _) = make_package(dir.path());
    let manifest_path = dir.path().join("manifest.json");
    let signing = SigningKey::generate(&mut OsRng);
    set_release_pubkey_env(&signing);
    let sha = sha256_hex(&pkg_path);
    let sig = sign_file(&pkg_path, &signing);
    write_manifest(
        &manifest_path,
        &format!("file://{}", pkg_path),
        &sha,
        &sig,
        true,
    );
    let mut cmd = assert_cmd::Command::cargo_bin("updater-helper").unwrap();
    cmd.arg("stage").arg("--manifest").arg(manifest_path);
    cmd.assert()
        .failure()
        .stderr(predicate::str::contains("revoked"));
}

#[test]
fn post_update_failure_triggers_rollback() {
    let dir = tempdir().unwrap();
    let install_dir = dir.path().join("install");
    let backup_dir = dir.path().join("backup");
    fs::create_dir_all(&install_dir).unwrap();
    fs::create_dir_all(&backup_dir).unwrap();
    let (pkg_path, _file_path) = make_package(dir.path());
    // create manifest and stage
    let manifest_path = dir.path().join("manifest.json");
    let signing = SigningKey::generate(&mut OsRng);
    set_release_pubkey_env(&signing);
    let sha = sha256_hex(&pkg_path);
    let sig = sign_file(&pkg_path, &signing);
    write_manifest(
        &manifest_path,
        &format!("file://{}", pkg_path),
        &sha,
        &sig,
        false,
    );
    // backup before install
    let backup_path = {
        let mut cmd = assert_cmd::Command::cargo_bin("updater-helper").unwrap();
        cmd.arg("backup")
            .arg("--install-dir")
            .arg(&install_dir)
            .arg("--backup-dir")
            .arg(&backup_dir);
        let output = cmd.assert().success().get_output().stdout.clone();
        let path_str = String::from_utf8_lossy(&output).trim().to_string();
        path_str
    };
    // install
    let mut install_cmd = assert_cmd::Command::cargo_bin("updater-helper").unwrap();
    let version_file = dir.path().join("version.json");
    // Hash the actual updater-helper binary being tested
    let updater_bin = assert_cmd::cargo::cargo_bin("updater-helper");
    let self_hash = sha256_hex(updater_bin.to_str().unwrap());
    fs::write(
        &version_file,
        serde_json::json!({"version":"test","updater_sha256": self_hash, "release_pubkey": null})
            .to_string(),
    )
    .unwrap();
    install_cmd
        .arg("install")
        .arg("--package")
        .arg(&pkg_path)
        .arg("--install-dir")
        .arg(&install_dir)
        .arg("--backup-dir")
        .arg(&backup_dir)
        .arg("--version-file")
        .arg(&version_file);
    install_cmd.assert().success();
    // create failing post check
    let mut post = assert_cmd::Command::cargo_bin("updater-helper").unwrap();
    post.arg("post-check")
        .arg("--test-cmd")
        .arg("/bin/false")
        .arg("--backup-manifest")
        .arg(&backup_path)
        .arg("--install-dir")
        .arg(&install_dir);
    post.assert()
        .failure()
        .stderr(predicate::str::contains("self-test failed"));
}

#[test]
fn self_check_refuses_tamper() {
    let dir = tempdir().unwrap();
    let version_file = dir.path().join("version.json");
    fs::write(
        &version_file,
        serde_json::json!({"version":"test","updater_sha256":"deadbeef","release_pubkey": null})
            .to_string(),
    )
    .unwrap();
    let mut cmd = assert_cmd::Command::cargo_bin("updater-helper").unwrap();
    cmd.arg("self-check")
        .arg("--version-file")
        .arg(&version_file);
    cmd.assert()
        .failure()
        .stderr(predicate::str::contains("self-hash mismatch"));
}
