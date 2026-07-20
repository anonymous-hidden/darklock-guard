# Signing Key Rotation Notice

The Android release keystore was removed from this repository.

Required actions:
- Rotate the Android production signing key immediately if that keystore was ever shared or committed.
- Keep production signing keys outside git at all times.
- Use CI encrypted secrets or a secure signing service (for example, cloud KMS-backed signing) for release builds.
- Do not commit keystores, private keys, certificates, or local env files.

This repository includes ignore rules and a guard script to prevent accidental commits of sensitive files.
