# Approved Access Recovery

## Host access

The prior password failed and must not be retried. Rotate it because it was exposed in conversation. Restore access using one of these approved methods:

1. Add a named engineer public key to the staging account through local console or an already authorized administrator.
2. Prefer a short-lived SSH certificate issued by the organization's SSH CA if one exists.
3. Restrict SSH by management subnet/VPN, disable root login, and disable password authentication after public-key access is verified.
4. Record host-key fingerprints out of band before the first privileged session.

Do not send another reusable password in chat or add private keys to the repository.

## AWS deployment access

Provide an AWS IAM Identity Center permission set in the staging account with enough rights to plan and apply the reviewed stack. The deployment identity must be separate from runtime, KMS administrator, break-glass, migration, and restore roles. Require MFA and short sessions. The identity provider must attach the controlled principal tag `RidgelineMfaAuthenticated=true` only after MFA; privileged target roles require that tag because the IAM `MultiFactorAuthPresent` context is not reliably propagated through federated role chaining.

The minimum discovery inputs are:

- staging and production AWS account IDs;
- selected AWS region per environment;
- organization permissions-boundary ARN;
- existing infrastructure administrator, KMS administrator, break-glass, and operator role ARNs;
- remote-state bucket/key ARNs;
- approved CA owner and Roles Anywhere trust-anchor ARNs;
- security alert destination owner.

## Workload certificates

Issue a distinct certificate per service and environment with the exact subject CN declared in Terraform. Store private keys in an OS keystore, TPM, HSM, or root-owned file with restrictive permissions according to the platform decision. Certificates and keys must never be baked into container images or Terraform state.

Revocation and renewal procedures must be tested before workloads depend on Roles Anywhere. Session credentials should be 15 minutes by default; privileged human assumptions should request 30 minutes even though IAM's role maximum is 60 minutes.
