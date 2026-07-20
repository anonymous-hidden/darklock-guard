# Phase 2A Readiness Gate

Every row must be `PASS`. `BLOCKED` and `NOT RUN` are failures for readiness.

| Requirement | Current result | Required evidence |
| --- | --- | --- |
| Approved staging AWS access | BLOCKED | MFA-backed SSO caller identity and account/region confirmation |
| Approved staging host access | BLOCKED | Named key/certificate login and verified host fingerprint |
| Hosting model confirmed | BLOCKED | Runtime, network, disk, container, DB, media, and backup inventory |
| Five staging KMS keys | NOT APPLIED | Key ARNs/aliases and enabled rotation in staging account |
| Temporary workload credentials | NOT APPLIED | Roles Anywhere or native workload identity session evidence |
| RLY no-decrypt policy | LOCALLY REVIEWED | Live denied KMS request under RLY role |
| Cross-domain role denial | LOCALLY TESTED ONLY | Live denied request under each unauthorized workload pair |
| Runtime admin-operation denial | LOCALLY TESTED ONLY | Live `GetKeyPolicy` denial under runtime roles |
| CloudTrail and alarms | NOT APPLIED | Trail delivery, metric filters, alarm test, and subscribed responder |
| Synthetic staging database | NOT CREATED | Isolated DB containing generated data only |
| Encrypted backup pipeline | NOT APPLIED | Scheduled successful backup with exact key and no plaintext artifact |
| Isolated restore | NOT RUN | Successful DB-level restore runbook evidence |
| Production definitions | VALIDATED LOCALLY | Independent security review and production cloud plan after staging passes |
| Explicit owner approval | MISSING | Written approval tied to reviewed plan/change ID |

## KMS harness commands

For an allowed staging workload/domain pair:

```powershell
$env:RIDGELINE_ENVIRONMENT = 'staging'
$env:RIDGELINE_SERVICE = 'ids'
$env:RIDGELINE_DOMAIN = 'auth'
$env:RIDGELINE_KMS_KEY_ARN = '<key-arn>'
$env:RIDGELINE_VALIDATION_MODE = 'allowed'
$env:AWS_REGION = '<staging-region>'
$env:AWS_PROFILE = '<short-lived-workload-profile>'
npm.cmd run validate:kms:staging
```

Run again under RLY and each cross-domain role with `RIDGELINE_VALIDATION_MODE = 'denied-only'`. The allowed mode verifies data-key round trip, wrong-context denial, and runtime key-policy denial. The scripts print event codes only.

## Current decision

`PHASE_2A_READY = false`

Do not begin backend data encryption, schema migration, dual-read logic, media migration, or production deployment while any row is not `PASS`.
