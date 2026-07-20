# Manual AWS Bootstrap Prerequisites

These steps are performed by the AWS organization/security owners before the staging Terraform stack is enabled. They are intentionally outside this stack so it cannot bootstrap or weaken its own trust boundary.

## Account and state boundary

1. Create or confirm separate AWS accounts for Ridgeline staging and production under separate environment OUs.
2. Apply organization guardrails that prevent staging principals from assuming production roles and prevent disabling organization audit controls.
3. Select one supported AWS region per environment and record the account/region pair in the change system.
4. In each account, create a private, versioned Terraform state bucket and a dedicated state KMS key. Require TLS, exact SSE-KMS, public-access blocking, and lock-file support.
5. Grant state access only to the environment's infrastructure deployment role. Never share the state key or bucket across environments.

## Human identity boundary

1. Create separate IAM Identity Center permission sets for infrastructure deployment, KMS administration, KMS break-glass, and security read-only review.
2. Enforce MFA and short sessions at the identity provider.
3. Configure the IdP-controlled principal tag `RidgelineMfaAuthenticated=true` only for sessions that passed MFA.
4. Protect break-glass membership with dual approval and alert on every use.
5. Apply the organization-managed permissions boundary referenced by the Terraform environment inputs.

## Workload identity boundary

1. Confirm the workload is outside AWS before choosing IAM Roles Anywhere. If it is on EC2/ECS/EKS, use native workload identity instead and revise the module before apply.
2. Create one approved private CA/trust anchor per environment. Do not share issuing CAs between staging and production.
3. Define revocation, renewal, and emergency certificate replacement procedures.
4. Provide Terraform only the trust-anchor ARN, issuer CN, and approved service subject CNs.
5. Keep CA and workload private keys out of Terraform, Git, container images, environment files, and chat.

## Staging apply sequence

1. Copy the example backend and variable files to their ignored local filenames.
2. Replace every example account, role, trust-anchor, bucket, key, and region value with approved staging identifiers.
3. Leave `deployment_enabled=false` and `migration_enabled=false`; initialize the remote backend and validate.
4. Set `deployment_enabled=true`, generate a saved plan, and have security review all KMS, IAM, S3, CloudTrail, CloudWatch, and Roles Anywhere changes.
5. Apply only the exact reviewed staging plan after explicit approval.
6. Subscribe the owned security response endpoint to the SNS alert topic and confirm delivery.
7. Issue service certificates, configure `aws_signing_helper` credential profiles, and run all allowed and denied KMS tests.
8. Create the isolated synthetic staging database, enable the approved encrypted backup source pipeline, and complete a real isolated restore.
9. Return `migration_enabled=false`, confirm the migration role is denied, and archive content-free evidence in the change record.

## Production boundary

Do not copy the staging plan or variable file to production. Production requires its own discovery, backend initialization, cloud plan, independent security review, explicit `CHG-` approval, and owner authorization after the full staging readiness gate passes.
