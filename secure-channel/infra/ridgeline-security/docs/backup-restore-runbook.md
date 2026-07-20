# Encrypted Backup and Isolated Restore Runbook

## Architecture prepared

- Separate KMS backup key and alias per environment.
- Private S3 bucket with public access blocked, TLS required, versioning, exact SSE-KMS key enforcement, and 35-day Object Lock governance retention by default.
- Opaque object prefix only: `opaque/`.
- Backup writer role can upload and manage its multipart uploads but cannot read or decrypt backups.
- Restore role can list/read/decrypt backups but cannot write new backups.
- CloudTrail records backup-object data events and alarms on failed writes.
- No production account or staging bucket was created by this work.

## Source backup mechanism gate

The live topology is unverified and the current repositories use SQLite. Select the source mechanism only after discovery:

- For EC2/EBS: use encrypted EBS volumes and AWS Backup with a dedicated backup vault/KMS policy, then retain the S3 package only for application-level opaque exports if still required.
- For the inferred non-AWS host: first require encrypted host storage and a maintained SQLite-consistent snapshot mechanism. The pipeline must stream directly into a client-encrypted artifact or the exact SSE-KMS destination and must never create an unencrypted archive in temporary storage.

Do not use raw file copy on a live SQLite database. Do not stage a plaintext `.db`, `.tar`, or `.zip` file before upload. Because the current live host and disk encryption are unknown, no source mechanism is approved yet.

## Synthetic object validation

Configure two AWS profiles backed by short-lived credentials, then run:

```powershell
$env:RIDGELINE_ENVIRONMENT = 'staging'
$env:AWS_REGION = '<staging-region>'
$env:RIDGELINE_BACKUP_BUCKET = '<staging-backup-bucket>'
$env:RIDGELINE_BACKUP_KMS_KEY_ARN = '<staging-backup-key-arn>'
$env:RIDGELINE_BACKUP_WRITER_PROFILE = '<writer-profile>'
$env:RIDGELINE_BACKUP_RESTORE_PROFILE = '<restore-profile>'
npm.cmd run validate:backup:staging
```

Expected result codes: backup write succeeds, writer read is denied, exact KMS key is confirmed, restore read matches, and restore write is denied. The Object-Locked synthetic object is intentionally retained.

## Isolated database restore

1. Open an approved staging change and assume the restore role with MFA for 1800 seconds.
2. Provision an isolated restore host with encrypted scratch storage, no production routes, no public ingress, and egress limited to the staging S3/KMS endpoints and approved package sources.
3. Restore the latest synthetic staging backup into a new path. Never overwrite a running or canonical staging database.
4. Start the existing service against the restored path with network listeners restricted to the validation host.
5. Run schema integrity, SQLite integrity, synthetic authentication/profile, and expected-record-count checks. Emit only pass/fail codes and counts, never values.
6. Verify the restore role cannot write backup objects and the backup writer cannot read them.
7. Publish `Ridgeline/Backup RestoreValidationFailure=1` if any required check fails.
8. Stop services, revoke the temporary session, and cryptographically destroy the scratch volume/key according to the platform procedure.
9. Record backup version ID, restore duration, test result, operator identity, and change ID in the security log. Do not record user content.

The Phase 2A gate requires a successful real run of this procedure against synthetic staging data. A documentation-only walkthrough does not pass.
