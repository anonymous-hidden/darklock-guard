# Infrastructure Discovery

## Evidence found in the repository

- No Terraform, CloudFormation, CDK, Pulumi, AWS KMS, Vault, or HSM configuration existed before this package.
- `README.md` describes deployment to a Raspberry Pi 5 or another Docker host.
- `start-instances.sh` starts the IDS and RLY Node services directly and uses local configuration/data directories.
- IDS and RLY Dockerfiles are Node 20 Alpine images with local `/data` storage.
- IDS defaults to `services/dl_ids/data/ids.db`; RLY defaults to `./data/rly.db`. Both are SQLite.
- Profile avatars and banners are stored in IDS text fields as data or remote URL values. No S3/object-storage media path was found.
- No backup job, backup repository, restore automation, retention policy, or staging/production environment split was found.
- Existing environment names cover service ports, local database paths, JWT secrets, CORS/domain settings, TURN, and TLS. No AWS account, KMS, temporary-credential, or backup variables exist.

## Local tool and credential state

- AWS CLI and Terraform were not initially installed.
- No AWS profile files or AWS credential environment variables were present.
- Terraform 1.12.2 was downloaded to a temporary directory, verified against HashiCorp's published SHA-256 checksum, and used only for formatting/schema validation.
- The AWS provider was pinned and initialized for local schema validation. No authenticated cloud plan or apply occurred.

## Hosting access result

- TCP port 22 on the previously supplied LAN host was reachable.
- The previously supplied temporary password was rejected by SSH.
- The credential was not retried after rejection. It must be rotated because it was shared in conversation.
- The live host OS, container runtime, disk encryption, deployed database paths, network segmentation, and backup state remain unverified.

## Discovery conclusion

Repository evidence suggests non-AWS, single-host Docker/Node deployment with local SQLite. That is an inference, not a verified live inventory. IAM Roles Anywhere is therefore prepared as the candidate workload identity, but application of that choice is blocked until the live hosting model and CA ownership are confirmed.
