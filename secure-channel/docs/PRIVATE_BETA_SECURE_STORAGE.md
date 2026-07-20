# Ridgeline Private Beta Secure Storage

## Security boundary

This mode protects sensitive IDS records and backups from readable storage at rest. Direct-message bodies and attachment keys remain end-to-end encrypted by the existing DM protocol. Group messaging remains disabled.

Plaintext exists briefly in process memory while Ridgeline uses it. This design does not protect an unlocked service from a fully compromised root account. Public profile content can be viewed by authenticated users the existing profile authorization policy permits. Public profile media is not end-to-end encrypted.

Do not describe this mode as zero-knowledge, unbreakable, or military-grade.

## Host setup

Run from a reviewed Ridgeline checkout on Linux:

```bash
sudo bash services/dl_ids/scripts/install-private-beta-storage.sh
```

The script creates the non-login `ridgeline-ids` account when needed, mode `0700` state directories, and one mode `0600` 32-byte master key. It refuses to overwrite an existing key and never prints key material.

Set `/etc/ridgeline/ids.env` to mode `0600`, owned by `root`, with at least:

```dotenv
NODE_ENV=production
RIDGELINE_SECURE_STORAGE_MODE=private-beta
RIDGELINE_ENVIRONMENT=production
RIDGELINE_MASTER_KEY_FILE=/etc/ridgeline/keys/server-master-key
RIDGELINE_MASTER_KEY_OWNER_UID=<numeric ridgeline-ids UID>
IDS_DB_PATH=/var/lib/ridgeline/ids/ids.db
RIDGELINE_BACKUP_DIR=/var/lib/ridgeline/backups
IDS_ALLOWED_ORIGINS=https://app.example.invalid
IDS_JWT_SECRET=<separate random secret>
```

The relay service must run as a different account. It must not receive the master key, IDS database permissions, media permissions, or membership in the `ridgeline-ids` group.

## Safe migration

Never run migration while IDS is accepting traffic. Run commands as `ridgeline-ids`, not root.

```bash
sudo systemctl stop ridgeline-ids
sudo -u ridgeline-ids --preserve-env=NODE_ENV,RIDGELINE_SECURE_STORAGE_MODE,RIDGELINE_ENVIRONMENT,RIDGELINE_MASTER_KEY_FILE,RIDGELINE_MASTER_KEY_OWNER_UID \
  npm run secure-storage:backup --workspace=services/dl_ids -- create \
  --database /var/lib/ridgeline/ids/ids.db \
  --output /var/lib/ridgeline/backups \
  --retain 7

sudo -u ridgeline-ids --preserve-env=NODE_ENV,RIDGELINE_SECURE_STORAGE_MODE,RIDGELINE_ENVIRONMENT,RIDGELINE_MASTER_KEY_FILE,RIDGELINE_MASTER_KEY_OWNER_UID \
  npm run secure-storage:migrate --workspace=services/dl_ids -- \
  --database /var/lib/ridgeline/ids/ids.db \
  --verified-backup /var/lib/ridgeline/backups/<opaque>.rlbackup \
  --confirm-private-beta-migration
```

The migration is transactional, resumable by its migration marker, enables SQLite secure deletion, truncates WAL, vacuums free pages, and then refuses success if a protected row is still plaintext. It does not automatically run on production startup.

Create and verify a new encrypted backup after migration. Restore it to an isolated destination before starting IDS:

```bash
npm run secure-storage:backup --workspace=services/dl_ids -- verify \
  --archive /var/lib/ridgeline/backups/<opaque>.rlbackup

npm run secure-storage:backup --workspace=services/dl_ids -- restore \
  --archive /var/lib/ridgeline/backups/<opaque>.rlbackup \
  --destination /var/lib/ridgeline/restore-test/ids.db \
  --confirm-restore
```

## Plaintext operational metadata allowlist

| Value | Reason | Reader | Retention and access |
| --- | --- | --- | --- |
| Opaque user, device, conversation, envelope, record, and session IDs | Routing, authorization, joins, and AAD binding | IDS or RLY as required | Service database lifetime; service account only |
| Usernames | Account routing and existing exact lookup | IDS and authenticated clients | Account lifetime; IDS database permissions |
| Public identity keys, signed prekeys, one-time prekeys, key versions | E2EE session establishment | IDS and authorized clients | Protocol lifetime; IDS database permissions |
| Creation, update, expiry, delivery, and last-seen timestamps | Expiration, ordering, abuse controls, and delivery | Owning service | Existing retention; service account only |
| Password and verification-token hashes | One-way verification | IDS | Credential or token lifetime; IDS only |
| Blind indexes and device fingerprint HMACs | Exact lookup without plaintext values | IDS | Parent record lifetime; IDS only |
| Authorization roles, relationship edges, and delivery state | Authorization and routing | IDS/RLY as required | Parent record lifetime; service account only |
| Schema names, migration IDs, protocol versions, ciphertext sizes, app version | Database and protocol operation | Owning service | Operational lifetime; service account only |

No other plaintext exception is approved. Logs must remain content-free.

## Current stop conditions

- Desktop SQLCipher is not verified. Electron 43 native rebuilding is blocked on the current Windows workstation because the Visual C++ build toolchain is absent. Sensitive renderer `localStorage` migration is therefore not complete.
- Profile media values are encrypted in IDS records, but opaque encrypted media files and streaming delivery are not implemented yet.
- Server backup tooling is implemented and synthetic restore-tested, but a live-host backup and restore has not run.
- The live host has not been changed. Use approved key-based SSH access; do not reuse temporary passwords.
