# Darklock Guard v2 - Update Packaging Guide

## Overview

This document describes the format for packaging and distributing Darklock Guard updates, including release artifacts, manifests, and cryptographic verification.

## Package Structure

### Release Archive Format

Updates are distributed as `.tar.gz` archives containing the new version's binaries and assets:

```
package.tar.gz
├── guard-service          # Main daemon binary
├── updater-helper         # Update orchestrator binary
├── version.json           # Version metadata (see below)
└── ...other files...      # Additional assets as needed
```

**Important:** All files must be at the root of the tar archive (no parent directory nesting).

### version.json Structure

The `version.json` file is **critical for fail-closed security**. It must be included in every release package:

```json
{
  "version": "2.1.0",
  "updater_sha256": "a1b2c3d4...",
  "release_pubkey": "HGpW+VZdkHokHEBYJt1S03+ReHFaxY+Rb7gPix7KeDY="
}
```

**Fields:**
- `version` (string): Semantic version number (e.g., "2.1.0")
- `updater_sha256` (string): SHA-256 hash of the `updater-helper` binary (hex-encoded)
- `release_pubkey` (string|null): Base64-encoded Ed25519 public key for signature verification, or null to use default

**Security Note:** The `updater_sha256` field enables **updater self-integrity checking**. Before performing any update operations, the updater verifies its own binary hash against this value. If tampered, all operations fail immediately (fail-closed design).

### Release Manifest (manifest.json)

The manifest is **separate** from the package and distributed via a secure channel (e.g., HTTPS API):

```json
{
  "version": "2.1.0",
  "download_url": "https://releases.darklock.dev/v2.1.0/guard-v2.1.0.tar.gz",
  "sha256": "e5f6a7b8c9d0...",
  "signature": "base64-encoded-ed25519-signature",
  "revoked": false
}
```

**Fields:**
- `version` (string): Must match `version.json` inside package
- `download_url` (string): URL to download the `.tar.gz` (supports `https://` and `file://`)
- `sha256` (string): SHA-256 hash of the entire `.tar.gz` archive (hex-encoded)
- `signature` (string): Base64-encoded Ed25519 signature of the archive
- `revoked` (boolean): If `true`, this release is blocked from installation

## Cryptographic Security

### Ed25519 Signing

All release packages must be signed with an Ed25519 private key. The corresponding public key is embedded in the updater binary (default) or specified in `version.json`.

**Signing Process:**
1. Create the `.tar.gz` archive
2. Compute SHA-256 hash: `sha256sum package.tar.gz`
3. Sign the archive file (not the hash):
   ```bash
   # Using OpenSSL or similar tool
   openssl dgst -sha256 -sign release_key.pem package.tar.gz | base64
   ```
4. Encode signature as Base64 for manifest

**Public Key Distribution:**
- Default key is **hardcoded** in `updater-helper` binary during build
- Override via `DARKLOCK_RELEASE_PUBKEY_B64` environment variable at runtime
- Specify per-release via `version.json` `release_pubkey` field (for key rotation)

### Verification Flow

The updater performs these checks **before** installing:

1. **Manifest Revocation Check:** `manifest.revoked == false`
2. **Download Integrity:** Compute SHA-256 of downloaded `.tar.gz` and compare to `manifest.sha256`
3. **Signature Verification:** Verify Ed25519 signature against archive contents
4. **Updater Self-Integrity:** Extract `version.json`, compute updater binary hash, compare to `updater_sha256`

**Fail-Closed:** If ANY check fails, the update is rejected immediately. No partial installs.

## Backup and Rollback

### Backup Structure

Before installing, the updater creates a timestamped backup:

```
backup_root/
└── backup_20260129T143052/
    ├── install/                   # Copy of previous install directory
    │   ├── guard-service
    │   ├── updater-helper
    │   └── version.json
    └── backup_manifest.json       # Metadata for rollback
```

**backup_manifest.json:**
```json
{
  "created_at": "20260129T143052",
  "source": "/path/to/install",
  "files": ["guard-service", "updater-helper", "version.json"]
}
```

### Rollback Process

If post-update self-tests fail, the updater automatically rolls back:

1. Read `backup_manifest.json` to locate backup
2. Wipe current install directory
3. Copy all files from `backup_20260129T143052/install/` back to install directory
4. Restart service with previous version

**Retention:** Only the last 2 backups are kept. Older backups are deleted automatically during cleanup.

## Update Lifecycle Commands

### 1. Self-Check
Verify updater integrity before operations:
```bash
updater-helper self-check --version-file /path/to/version.json
```

### 2. Stage
Download and verify release package:
```bash
updater-helper stage --manifest /path/to/manifest.json
```
Outputs: Path to staged package (or fails if verification fails)

### 3. Backup
Backup current installation:
```bash
updater-helper backup --install-dir /opt/darklock --backup-dir /var/darklock/backups
```
Outputs: Path to `backup_manifest.json`

### 4. Install
Extract and install verified package:
```bash
updater-helper install \
  --package /tmp/staged.tar.gz \
  --install-dir /opt/darklock \
  --backup-dir /var/darklock/backups \
  --version-file /tmp/version.json
```
Outputs: Path to backup manifest (for potential rollback)

### 5. Post-Check
Run self-test and rollback on failure:
```bash
updater-helper post-check \
  --test-cmd "/opt/darklock/guard-service --version" \
  --backup-manifest /var/darklock/backups/backup_20260129T143052/backup_manifest.json \
  --install-dir /opt/darklock
```

### 6. Rollback
Manually rollback to previous version:
```bash
updater-helper rollback \
  --backup-manifest /var/darklock/backups/backup_20260129T143052/backup_manifest.json \
  --install-dir /opt/darklock
```

### 7. Cleanup
Remove temporary files:
```bash
updater-helper cleanup --path /tmp/staged.tar.gz
```

## Building Release Packages

### Step 1: Generate Ed25519 Keypair

```bash
# Using OpenSSL
openssl genpkey -algorithm ED25519 -out release_key.pem
openssl pkey -in release_key.pem -pubout -out release_key.pub

# Extract public key bytes as Base64 (32 bytes)
# ... manual extraction or use dedicated tool ...
```

### Step 2: Build Binaries

```bash
cd guard-v2
cargo build --release --workspace

# Binaries will be in target/release/
ls -lh target/release/{guard-service,updater-helper}
```

### Step 3: Compute Updater Hash

```bash
sha256sum target/release/updater-helper | awk '{print $1}'
# Example output: a1b2c3d4e5f6...
```

### Step 4: Create version.json

```json
{
  "version": "2.1.0",
  "updater_sha256": "a1b2c3d4e5f6...",
  "release_pubkey": null
}
```

### Step 5: Create Archive

```bash
cd target/release
tar -czf guard-v2.1.0.tar.gz guard-service updater-helper version.json
```

### Step 6: Sign Archive

```bash
# Compute SHA-256
sha256sum guard-v2.1.0.tar.gz

# Sign archive
openssl dgst -sha256 -sign ../../release_key.pem guard-v2.1.0.tar.gz | base64 -w0
```

### Step 7: Create Manifest

```json
{
  "version": "2.1.0",
  "download_url": "https://releases.darklock.dev/v2.1.0/guard-v2.1.0.tar.gz",
  "sha256": "e5f6a7b8...",
  "signature": "base64-signature-from-step-6",
  "revoked": false
}
```

### Step 8: Distribute

Upload `guard-v2.1.0.tar.gz` to hosting and publish `manifest.json` via API.

## Environment Variables

- `DARKLOCK_RELEASE_PUBKEY_B64`: Override default Ed25519 public key (Base64-encoded, 32 bytes)

## Security Considerations

1. **Private Key Protection:** The release signing key must be stored in a Hardware Security Module (HSM) or secure key vault. Compromise = full control over updates.

2. **Manifest Distribution:** The manifest should be served over HTTPS with certificate pinning to prevent MITM attacks.

3. **Revocation:** If a release is compromised, immediately set `"revoked": true` in the manifest. All updaters will refuse to install it.

4. **Version Pinning:** The service should reject downgrades unless explicitly authorized (prevents rollback attacks).

5. **Self-Integrity:** The updater checks its own hash before every operation. Never distribute an updater with incorrect `updater_sha256` in `version.json`.

## Testing

Run integration tests to verify the full update flow:

```bash
cd guard-v2
cargo test -p updater-helper --test updater_tests
```

Tests cover:
- Hash mismatch detection
- Invalid signature rejection
- Revoked release blocking
- Tamper detection (wrong updater hash)
- Post-update rollback on failure

## Troubleshooting

### "hash mismatch" error
- Verify `manifest.sha256` matches actual archive hash
- Check for corruption during download (retry)

### "signature verification failed"
- Ensure signature was created from the **archive file**, not the hash string
- Verify public key matches the private key used for signing
- Check Base64 encoding is correct (no line breaks)

### "updater self-hash mismatch"
- Recompute `updater_sha256` for the actual binary in the archive
- Ensure `version.json` is up-to-date
- Check for binary tampering or corruption

### "release is revoked"
- Contact release team to verify revocation reason
- Do not attempt to override or bypass this check

## Changelog

- **v2.0.0**: Initial updater implementation with Ed25519 signing, self-integrity checks, and automatic rollback
