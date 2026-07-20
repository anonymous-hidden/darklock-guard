# Synthetic Staging Database Setup

No staging database was created because approved host access is unavailable. The following setup is mandatory before Phase 2A.

## Isolation requirements

1. Use a staging-only host or VM and an encrypted data volume. Do not reuse production paths, keys, certificates, accounts, backups, or network routes.
2. Restrict service ingress to the staging test network. Restrict management access to the approved VPN/subnet and named SSH identities.
3. Store runtime configuration outside Git with owner-only permissions. Retrieve service secrets from the approved secret store; do not add reusable AWS access keys.
4. Use dedicated staging paths such as `/srv/ridgeline/staging/ids/ids.db` and `/srv/ridgeline/staging/rly/rly.db`, owned only by their service identities.
5. Confirm encrypted swap or disable swap for the database host according to the platform standard.

## Creation sequence

1. Start the existing IDS and RLY versions against new, empty staging paths so the existing application creates its current schema. Do not copy a development or production database.
2. Create generated test users, profiles, relationships, groups, integration placeholders, and media fixtures only through existing supported APIs or approved seed tooling.
3. Mark every synthetic account and record with a non-user-derived staging fixture identifier where the existing schema supports it.
4. Run SQLite `integrity_check`, service health checks, and expected synthetic record-count checks. Log only result codes and counts.
5. Record service versions, schema versions, host image ID, volume encryption state, and fixture generator revision in the staging change record.
6. Execute the encrypted backup pipeline and isolated restore runbook before any Phase 2A migration work.

## Prohibitions

- No production snapshot, user export, message content, OAuth token, media object, or credential may enter staging.
- No schema migration or backend encryption code may be introduced during this prerequisite setup.
- No raw live SQLite file copy is an approved backup.
- No readiness claim is allowed until a real isolated restore of this synthetic database succeeds.
