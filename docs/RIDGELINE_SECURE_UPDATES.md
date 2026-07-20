# Ridgeline Secure Updates

## Architecture

Ridgeline is Electron 30 packaged by electron-builder. `electron-updater` owns download, staging, OS signature checks, and installation in the main process. The renderer receives sanitized state and can request only check, defer, restart, history, and release-note actions. It cannot supply URLs or file paths.

The product policy is a separate canonical-JSON Ed25519 envelope. It is checked before `electron-updater` can download. It binds app identity, semantic version, channel, classification, urgency, minimum supported version, expiry, rollout, release notes, and every artifact URL, size, SHA-256, and electron-builder SHA-512 value.

## Release Operation

Production releases run only through the protected `Release Ridgeline` GitHub Actions workflow and the `ridgeline-production` environment. The release operator must update `scripts/release/ridgeline-release-notes.json`, update the application version, select an explicit classification and policy, and approve the protected workflow.

Required protected secrets:

- `RIDGELINE_UPDATE_SIGNING_KEY_B64`
- `RIDGELINE_RELEASE_PUBLISH_TOKEN`
- `RIDGELINE_RELEASE_AWS_ROLE`
- `RIDGELINE_RELEASE_AWS_REGION`
- `RIDGELINE_RELEASE_BUCKET`
- `WINDOWS_CODE_SIGNING_CERT_B64`
- `WINDOWS_CODE_SIGNING_CERT_PASSWORD`
- `MACOS_CODE_SIGNING_CERT_B64`
- `MACOS_CODE_SIGNING_CERT_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Configure the server with the same high-entropy `RIDGELINE_RELEASE_PUBLISH_TOKEN`. The signing private key and code-signing credentials must not be available to pull-request workflows.

The workflow uploads immutable artifacts first, then electron-builder manifests, and finally publishes the signed product policy to the audited API. A failed earlier step leaves no discoverable product policy.

## Key Rotation and Revocation

Clients trust key IDs embedded in `electron/updateTrust.ts`. The server independently verifies the same public keys. Private keys remain outside the repository in protected CI or offline recovery storage.

Normal rotation:

1. Generate a new Ed25519 key in protected signing infrastructure.
2. Add only its public key and key ID to a release signed by an already trusted key.
3. Deploy that release broadly and wait until the supported client floor includes it.
4. Move CI signing to the new key ID.
5. Remove an old public key only in a later release after its retirement window.

Emergency revocation:

1. Disable the compromised CI secret and publication token.
2. Use the offline recovery key to issue a higher `metadataSequence` signed record with `revoked: true` or `rollout.paused: true`.
3. Rotate the publication token and audit credentials.
4. Build a recovery release signed by the recovery key and rotate to a fresh normal key.

Unknown keys are never downloaded and trusted dynamically. Rollout, pause, mandatory, and revoke changes require a higher signed metadata sequence; stale or altered records are rejected.

## Legacy Migration

The legacy `/platform/api/secure-channel/version` response remains available only for installed old clients. It must point users to one OS-code-signed bridge installer that upgrades to this updater. Old clients do not receive an unsigned automatic-install exception. After the supported population has crossed the bridge release, retire the old manifest and direct-download publisher.

Windows portable builds cannot use the NSIS updater and are no longer produced by the production configuration. Existing portable users must use the signed bridge installer. Linux automatic updates apply to AppImage builds; Debian packages continue through the package/manual distribution path.

## Recovery Limits

electron-updater preserves normal installer behavior and diagnostic logs, but it does not provide a general automatic rollback after a bad application release. Roll back by publishing a new, higher semantic version containing the last known-good code. Downgrades remain disabled in production.

Update event logs contain event names, versions, and sanitized error codes only. They do not contain messages, contacts, OAuth credentials, or private artifact URLs.
