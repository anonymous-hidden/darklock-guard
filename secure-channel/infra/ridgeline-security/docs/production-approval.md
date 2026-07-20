# Production Infrastructure Approval

Production infrastructure is prepared as code but must remain unapplied.

## Mandatory sequence

1. Pass every staging readiness-gate row.
2. Review the staging CloudTrail event history and access-denied results.
3. Complete a successful synthetic staging database backup and isolated restore.
4. Rotate/remove migration access and prove it is denied.
5. Confirm production uses a separate AWS account, CA/trust anchor, state bucket/key, KMS keys, IAM roles, backup bucket, audit bucket, and alert destination.
6. Generate a production plan using MFA-backed production deployment access.
7. Obtain independent security review of the exact plan and key policies.
8. Obtain explicit owner approval with a `CHG-` identifier.
9. Set `deployment_enabled = true` only in the approved, non-committed production variable file and apply the exact reviewed plan.

## Prohibited actions

- Do not copy staging certificates, role ARNs, state, keys, buckets, or database data into production.
- Do not enable `migration_enabled` during the production foundation apply.
- Do not weaken context, S3, TLS, Object Lock, MFA, or account-boundary controls to resolve deployment errors.
- Do not grant RLY or KMS administrators decrypt access.
- Do not apply production as part of Phase 2A prerequisite work.
