# Encryption Context Contract

## Record-encryption domains

The record KMS keys require exactly these stable, content-free fields:

| Key | Value rule |
| --- | --- |
| `application` | Always `ridgeline` |
| `environment` | `staging` or `production`; never shared |
| `domain` | `auth`, `profile-settings`, `integrations`, or `media` |
| `schemaVersion` | Initially `1` |
| `service` | Policy-approved workload name |

Allowed service values are:

| Domain | Runtime service | Temporary service |
| --- | --- | --- |
| `auth` | `ids` | `migration` |
| `profile-settings` | `ids` | `migration` |
| `integrations` | `integrations` | `migration` |
| `media` | `media` | `migration` |

The migration role is absent unless `migration_enabled` is explicitly enabled for an approved staging migration. It must be removed immediately after migration verification.

RLY has no KMS mapping and receives no decrypt or data-key operation. KMS administrators have configuration permissions without `Decrypt` or `GenerateDataKey`.

## Content-free requirement

AWS KMS records encryption context in audit logs. Do not place usernames, emails, profile values, OAuth tokens, record identifiers, database keys, media names, message IDs, or other user-derived content in KMS encryption context.

Record identity and schema-specific binding belong in local AEAD additional authenticated data inside Phase 2A. That later AAD may include a canonical table/column/record identifier because it is not sent to KMS.

## Backup exception

The backup domain uses S3 SSE-KMS. S3 supplies `aws:s3:arn` as the KMS encryption context, so the backup key has a separate policy bound to the exact `opaque/` bucket path and `kms:ViaService` for S3 in the selected region. It must not be used for application-record envelopes.

## Versioning

`schemaVersion` describes the envelope/context contract, not an application database schema. New versions require dual-read migration design, staging denial tests, CloudTrail review, and an approved policy change. Existing context values must remain decryptable until migration verification and rollback windows are complete.
