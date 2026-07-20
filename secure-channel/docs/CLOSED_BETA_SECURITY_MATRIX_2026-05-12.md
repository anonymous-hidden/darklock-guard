# Closed Beta Security Verification Matrix (2026-05-12)

## Scope
This matrix tracks the closed-beta blocker set requested in the latest security audit pass.

## Blocker Status

| # | Blocker | Status | Notes |
|---|---|---|---|
| 1 | Hygiene cleanup + secret guardrail | Complete | Secret/artifact cleanup already done; `check:no-secrets` passes. |
| 2 | Endpoint auth + anti-enumeration + rate limits | Complete | `/v1/auth/exists` now auth-only; `/v1/auth/availability` public+limited; tighter v1/friends/keys throttles. |
| 3 | CORS lockdown (IDS + relay) | Complete | `IDS_ALLOWED_ORIGINS`/`RLY_ALLOWED_ORIGINS` enforced; production startup fails on missing or `*`; disallowed origins return 403. |
| 4 | Relay presence/profile authorization | Complete | `subscribe_presence` and `profile_request` now require metadata permits + limits + recipient checks. |
| 5 | IDS mutation abuse limits | Complete | Added fixed-window limits for register, availability, exists, key-bundle, friends mutations, `/users/:id/keys`. |
| 6 | Electron tamper checks (phase 1) | Implemented (runtime validation pending in this environment) | Added `electron/tamper.ts` and startup enforcement in `electron/main.ts`. |
| 7 | Auth unification + legacy disable | Complete | Legacy auth endpoints disabled by default (410) unless `IDS_ENABLE_LEGACY_AUTH=1` and non-production. |
| 8 | SPKI pinning scaffolding | Implemented (runtime validation pending in this environment) | Added `electron/spkiPinning.ts` and `setCertificateVerifyProc` integration. |
| 9 | PII logging reduction | Complete | Production logging reduced in auth middleware/routes; request logging gated behind `DEBUG_SECURITY`. |
| 10 | Verification matrix + test evidence | Complete | This document + command results below. |

## Signing Key Rotation Note
Any release/test keystore previously committed or used for test builds must be treated as compromised and rotated before closed beta. Production signing keys must live outside git and be injected through secure CI secrets or a signing service.

## Test Evidence

### IDS
Command:
`node --test test/*.test.js`

Result:
- Pass: 30
- Fail: 0

### Relay
Command:
`node --test test/ws-auth.security.test.js`

Result:
- Pass: 25
- Fail: 0

### Secret Guard
Command:
`npm run check:no-secrets`

Result:
- `[check-no-secrets] OK`

## Environment Limitation (Desktop Test Runner)
Desktop `vitest`/TS build execution is blocked in this workspace because multiple dependencies in `secure-channel/node_modules` are present without runtime `dist` files (for example `vitest`, `jose`).

Impact:
- Electron runtime tests could not be executed here.
- Static diagnostics for modified Electron files report no errors.

## Files Added for Desktop Security Scaffolding
- `apps/dl-secure-channel/electron/tamper.ts`
- `apps/dl-secure-channel/electron/spkiPinning.ts`
- `apps/dl-secure-channel/electron/tamper.security.test.ts`
- `apps/dl-secure-channel/electron/spkiPinning.security.test.ts`
