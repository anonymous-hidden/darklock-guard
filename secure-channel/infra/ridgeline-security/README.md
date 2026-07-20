# Ridgeline Security Infrastructure Prerequisites

This directory is an infrastructure-only prerequisite package for future Phase 2A backend encryption work. It does not modify Ridgeline application code, schemas, data, messaging, clients, media behavior, Spotify, or the updater.

## Current status

- No AWS resources were created, changed, or deleted.
- Staging and production deployment switches remain `false`.
- Production requires a `CHG-` approval identifier and rejects migration access during the foundation apply.
- Both Terraform stacks pass `terraform validate` with AWS provider `6.53.0`.
- The local synthetic KMS harness tests pass. Live KMS, role-denial, backup, and isolated database restore tests are blocked on approved AWS and host access.

## Layout

- `terraform/modules/kms`: four record-encryption keys and context-bound policies.
- `terraform/modules/backup`: the fifth KMS domain, private immutable S3 backup storage, and split writer/restore permissions.
- `terraform/modules/iam`: runtime and privileged roles.
- `terraform/modules/workload-identity`: IAM Roles Anywhere profiles for the currently inferred non-AWS workload model.
- `terraform/modules/audit`: CloudTrail, CloudWatch security signals, alarms, and SNS topic.
- `terraform/environments/staging`: disabled staging stack.
- `terraform/environments/production`: disabled, approval-gated production stack.
- `scripts`: content-free KMS and backup validation harnesses.
- `docs`: discovery, policy, access, restore, and readiness runbooks.

## Prerequisites

1. Confirm the AWS Organizations account IDs and region for staging and production. Separate accounts are required.
2. Create separate encrypted S3 state buckets and state KMS keys through the organization bootstrap process. Enable versioning and lock-file support.
3. Establish AWS IAM Identity Center roles for infrastructure administration, KMS administration, break-glass, and security operations.
4. Establish an approved private CA and one IAM Roles Anywhere trust anchor per environment. Terraform receives only trust-anchor ARNs and certificate subject metadata, never private keys.
5. Configure an alert destination subscription for the emitted SNS topic.
6. Restore approved SSH access to the staging host using a named public key or short-lived SSH certificate.

## Safe staging workflow

Do not place credentials, certificates, private keys, backend settings, or real account files in Git.

```powershell
cd terraform/environments/staging
Copy-Item terraform.tfvars.example terraform.tfvars
Copy-Item backend.hcl.example backend.hcl
terraform init -backend-config=backend.hcl
terraform fmt -check -recursive
terraform validate
terraform plan -out=staging.tfplan
terraform show -no-color staging.tfplan
```

After security review of the plan, set `deployment_enabled = true`, create a fresh plan, obtain explicit approval, and apply that exact reviewed plan. Never repurpose staging account values for production.

## Workload credentials

The current repository points to a Docker/Pi-style host outside AWS. For that topology, use IAM Roles Anywhere with an approved X.509 workload certificate and `aws_signing_helper` as an AWS `credential_process`. The SDK then receives short-lived credentials through the normal profile provider chain. Do not export long-lived access keys or store certificate private keys in repository files, images, service environment files, or Terraform state.

If discovery later proves the workloads run on EC2, ECS, or EKS, replace Roles Anywhere with the native instance, task, or pod identity before applying. Do not run both methods as a convenience fallback.

## Validation

Local validation:

```powershell
npm.cmd install --ignore-scripts
npm.cmd test
```

Live KMS validation must run once per allowed workload/domain pair and again using RLY and a cross-domain role in `denied-only` mode. Required variable names are documented in `docs/readiness-gate.md`; key ARNs are identifiers, not secrets, but the scripts never print them.

Live backup validation uses separate AWS profiles for the writer and restore roles. It leaves a small Object-Locked synthetic object under `opaque/restore-validation/` for retention and emits only result codes.

## Production

Production is definition-only. Do not initialize its real backend, plan against its account, or apply it until staging has passed the full readiness gate and the owner explicitly approves a production change. See `docs/production-approval.md`.
