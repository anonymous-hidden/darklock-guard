# ARCHITECTURE — `secure-channel/`

> Ridgeline / Darklock Secure Channel — end-to-end encrypted messaging platform.
> Scope: `secure-channel/` subtree only. Other workspace apps (darklock, jarvis,
> guard-v2, etc.) are documented separately.

Last audited: **Phase 08 — Release hardening & audit closeout** (8-phase master audit complete).

---

## 1. High-Level Layout

```
secure-channel/
├── apps/
│   ├── dl-secure-channel/          React + Electron (desktop + web SPA)
│   └── dl-secure-channel-mobile/   Capacitor iOS/Android shell + PWA wrapper
├── packages/
│   └── dl-crypto/                  @darklock/channel-crypto — E2EE primitives
├── services/
│   ├── dl_ids/                     Identity + directory + sync service (Node/HTTPS)
│   └── dl_rly/                     WebSocket relay for encrypted envelopes (Node)
├── package.json                    npm workspaces root
├── tsconfig.base.json              shared strict TypeScript config
├── start-instances.sh              local dev launcher
└── SECURITY_AUDIT_REPORT.md        prior audit notes
```

### Workspace package map

| Package                               | Path                         | Role                                                |
| ------------------------------------- | ---------------------------- | --------------------------------------------------- |
| `@darklock/secure-channel`            | `apps/dl-secure-channel`     | Primary React SPA + Electron main/preload           |
| `@darklock/secure-channel-mobile`     | `apps/dl-secure-channel-mobile` | Capacitor (native) + PWA wrapper                 |
| `@darklock/channel-crypto`            | `packages/dl-crypto`         | Libsodium wrappers: AEAD, X3DH, ratchet, sender keys |
| `@darklock/ids`                       | `services/dl_ids`            | HTTPS: auth, prekeys, friends, sync                 |
| `@darklock/rly`                       | `services/dl_rly`            | WSS: encrypted envelope relay, presence             |

---

## 2. Directory Detail — `apps/dl-secure-channel/src`

```
src/
├── App.tsx                     Root router: screen gating by auth state
├── main.tsx                    Bootstrap, store hydration
├── types.ts                    Re-exports from @darklock/channel-crypto
├── theme/index.css             Design tokens (CSS custom properties)
├── components/                 37 UI files (.tsx + .css)
├── pages/                      6 top-level screens (Login, Settings, Onboarding…)
├── stores/                     13 Zustand stores (state)
├── hooks/                      3 React hooks (including useRlyConnection)
├── net/                        idsClient.ts (HTTP), wsClient.ts (WebSocket)
├── crypto/                     vault.ts, e2eeSessions.ts, attachmentCrypto.ts
├── services/                   syncService.ts (cross-device settings sync)
├── utils/                      logger.ts  (NEW — Phase 01)
└── assets/                     Images used by Vite
```

### Stores (13)

| Store                | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| `authStore`          | Vault unlock, identity key, session token, screen nav |
| `chatStore`          | Conversations, messages, contacts, groups, channels, categories, roles, audit log |
| `connectionStore`    | WebSocket status + online presence map           |
| `convSecurityStore`  | Per-conversation security: disappearing, blur, notif preview |
| `convThemeStore`     | Per-conversation theme overrides                 |
| `friendStore`        | Friend requests in/out                           |
| `lockScreenStore`    | Lock-screen customization                        |
| `loginScreenStore`   | Login-screen customization                       |
| `profileStore`       | Own-profile (display name, bio, avatar, links)   |
| `settingsStore`      | Global app settings (theme, hotkeys, privacy)    |
| `tagStore`           | User-assigned tags (Discord-like badges)         |
| `updateStore`        | App-update check state                           |
| `clearUserData`      | Helper: wipe all stores on logout                |

### Components (37 TSX)

`AvatarWithStatus`, `CameraCapture`, `ChatView`, `ConvPersonalize`, `ConvSecurity`,
`EmojiPicker`, `FriendRequestsPanel`, `FriendsHome`, `GroupChannelSidebar`,
`GroupManagement`, `GroupSettings` (new — 6-tab modal), `GuildSidebar`, `Icons`,
`LockScreenSettings`, `LoginSettings`, `NewMessageModal`, `ProfileEditor`,
`ProfilePopup`, `Shared` (Button/Input/TextArea/Avatar/Badge/Modal/Spinner),
`Sidebar`, `UpdateBanner`.

### Pages (6)

`Login`, `Unlock`, `Onboarding`, `Settings` (multi-section), `MeProfile`, `Admin`.

---

## 3. Crypto Layer — `packages/dl-crypto/src`

| File           | Exports                                                      |
| -------------- | ------------------------------------------------------------ |
| `sodium.ts`    | `initCrypto`, `getSodium`                                    |
| `aead.ts`      | `encrypt`, `decrypt` (XChaCha20-Poly1305), `generateKey`     |
| `kdf.ts`       | `deriveVaultKey` (Argon2id), `generateSalt`, `zeroize`       |
| `identity.ts`  | `generateIdentityKey`, `sign`/`verify`, `createSignedPreKey`, `generateOneTimePreKeys`, `buildPreKeyBundle`, `computeSafetyNumber` |
| `x3dh.ts`      | `x3dhSender`, `x3dhReceiver`                                 |
| `ratchet.ts`   | Double Ratchet: `initSenderRatchet`, `initReceiverRatchet`, `ratchetEncrypt`, `ratchetDecrypt` |
| `senderkeys.ts`| Group Sender Keys (not yet wired in ChatView — see TODO)     |
| `mnemonic.ts`  | BIP-39 recovery phrase (vault backup)                        |
| `padding.ts`   | Message padding to hide length                               |
| `wipe.ts`      | Secure-zero utilities                                        |
| `utils.ts`     | `toBase64`, `fromBase64`, etc.                               |
| `types.ts`     | All shared TypeScript types (Bytes, PreKeyBundle, GroupInfo, `DEFAULT_PERMISSIONS`, …) |

---

## 4. Backend Services

### 4.1 `dl_ids` — Identity & Directory (HTTPS, Express)

**Port:** 4443 (default, HTTPS if certs present, else HTTP fallback)
**Storage:** SQLite via `better-sqlite3` at `services/dl_ids/data/ids.db`

Routes:

| Method | Path                                      | Auth | Purpose                                      |
| ------ | ----------------------------------------- | ---- | -------------------------------------------- |
| GET    | `/health`                                 |  —   | Liveness probe                               |
| POST   | `/v1/auth/register`                       |  —   | Register new user, verifier + identity keys  |
| POST   | `/v1/auth/login`                          | limiter | Returns session token                     |
| GET    | `/v1/auth/session`                        | cookie | Validate session                           |
| POST   | `/v1/auth/logout`                         | cookie | Invalidate session                         |
| GET    | `/v1/auth/sessions`                       | cookie | List active sessions                       |
| POST   | `/v1/auth/sessions/revoke`                | cookie | Revoke specific session                    |
| GET    | `/v1/auth/2fa/status/:userId`             | bearer | 2FA enabled?                               |
| POST   | `/v1/auth/2fa/setup`                      |  —   | Begin TOTP setup                             |
| POST   | `/v1/auth/2fa/confirm`                    |  —   | Confirm TOTP code, enable                    |
| POST   | `/v1/auth/2fa/disable`                    |  —   | Disable 2FA                                  |
| POST   | `/v1/auth/2fa/verify`                     |  —   | Verify 2FA during login                      |
| GET    | `/v1/auth/exists/:userId`                 |  —   | Public: does this userId exist?              |
| POST   | `/v1/keys/register`                       | bearer | Upload initial pre-key bundle              |
| GET    | `/v1/keys/bundle/:userId`                 |  —   | Fetch another user's pre-key bundle          |
| POST   | `/v1/keys/replenish`                      | bearer | Top up one-time pre-keys                   |
| GET    | `/v1/keys/count/:userId`                  |  —   | How many OPKs remain                         |
| PUT    | `/v1/keys/signed-prekey`                  | bearer | Rotate SPK                                 |
| DELETE | `/v1/keys/:userId`                        | bearer | Wipe own keys (account deletion)           |
| GET    | `/v1/users/search`                        | bearer | Search users by display name               |
| POST   | `/v1/friends/request`                     | bearer | Send friend request                        |
| GET    | `/v1/friends/requests/incoming/:userId`   | bearer | Received requests                          |
| GET    | `/v1/friends/requests/outgoing/:userId`   | bearer | Sent requests                              |
| POST   | `/v1/friends/accept`                      | bearer | Accept                                       |
| POST   | `/v1/friends/reject`                      | bearer | Reject                                       |
| GET    | `/v1/friends/:userId`                     | bearer | Friend list                                |
| GET    | `/v1/sync/:userId`                        | bearer | Pull cross-device settings blob            |
| PUT    | `/v1/sync/:userId`                        | bearer | Push single key or bulk update             |

Rate-limited: `loginLimiter` on `/v1/auth/login`.

### 4.2 `dl_rly` — Message Relay (WebSocket, Express)

**Port:** 4444 (default, WSS if certs, else WS)
**Storage:** `better-sqlite3` at `services/dl_rly/data/rly.db` — offline queue only (ciphertext blobs).

Single WebSocket endpoint; dispatch is by `msg.type`:

| Type                  | Direction       | Semantics                                                  |
| --------------------- | --------------- | ---------------------------------------------------------- |
| `auth`                | client → server | Authenticate WS connection (userId + session token)        |
| `ping`                | client → server | Keepalive                                                  |
| `subscribe_presence`  | client → server | Watch presence of specified userIds                        |
| `presence_update`     | both            | Broadcast online/away/dnd/offline to subscribers           |
| `message`             | client → relay  | 1-to-1 encrypted envelope (opaque to server)               |
| `group_message`       | client → relay  | Fan-out to explicit recipient list (opaque)                |
| `typing`              | client → relay  | Ephemeral typing hint                                      |
| `delete_message`      | client → relay  | Propagate delete instruction                               |
| `edit_message`        | client → relay  | Propagate edited ciphertext                                |
| `receipt`             | client → relay  | Delivered / read receipt                                   |
| `friend_request`      | client → relay  | Notify other user of incoming request                      |
| `friend_accept`       | client → relay  | Notify other user of acceptance                            |
| `open_dm`             | client → relay  | Mirror DM open                                             |
| `group_invite`        | client → relay  | Seed group metadata on recipients                          |
| `tag_update`          | client → relay  | Badge/tag change propagation                               |
| `profile_request`     | client → relay  | Request another user's profile blob                        |
| `profile_sync`        | client → relay  | Publish own profile blob                                   |

**Invariant:** server never sees plaintext message content — payloads are AEAD ciphertexts produced by `e2eeSessions.encryptPayload()`.

---

## 5. Data Flow — Three Traced Flows

### Flow A — Register + First Unlock

```
User types username/password
  → pages/Onboarding.tsx
  → generateSalt() + deriveVaultKey() [kdf.ts, Argon2id]
  → generateIdentityKey() + createSignedPreKey() + generateOneTimePreKeys()
  → vault.ts  writeVault()  — AEAD-wrap identity + SPK secrets with vaultKey
  → idsClient.register()     — POST /v1/auth/register
  → idsClient.registerKeys() — POST /v1/keys/register (public bundle)
  → authStore.setUnlocked(true)
  → App.tsx  renders 'main' screen
```

### Flow B — Send 1-to-1 DM

```
User submits in ChatView
  → wsClient.sendMessage(to, payload, id)
       payload = encryptPayload(recipientId, plaintext)  [e2eeSessions.ts]
                   ├─ if no session: x3dhSender() → initSenderRatchet()
                   └─ ratchetEncrypt(plaintext)  [ratchet.ts]
  → WS frame { type: 'message', to, payload, id }
  → dl_rly case 'message': lookup online session, forward / queue
  → Recipient ws.on('message') → useRlyConnection handles msg.type === 'message'
  → decryptPayload() — processIncomingSession() if X3DH header present, else ratchetDecrypt()
  → chatStore.appendMessage(convId, …)  → React re-render
```

### Flow C — Create Group + Invite

```
User fills GroupManagement.createGroup form
  → chatStore.createGroup(): seeds default role, default category/channel, audit entry
  → wsClient.sendGroupInvite(groupId, groupName, members, recipients)
       (recipients encrypted individually per member)
  → dl_rly case 'group_invite': forward/queue to each recipient
  → Recipient: useRlyConnection msg.type === 'group_invite'
       → chatStore.addConversation({ type:'group', ... })
       → chatStore.setGroupInfo(groupId, { channels:[general], categories:[Text], roles:[@everyone], auditLog:[created], ... })
  → Both sides see the group with identical seed state
```

---

## 6. Electron & Mobile Wrappers

- **Electron** (`apps/dl-secure-channel/electron/`): `main.ts` creates the BrowserWindow with `contextIsolation: true, nodeIntegration: false, sandbox: true`. `preload.ts` uses `contextBridge.exposeInMainWorld('electronAPI', …)` to expose a narrow IPC surface (vault file I/O, clipboard, notifications, lock signals, update checks).
- **Mobile** (`apps/dl-secure-channel-mobile/src/`):
  - `mobileAdapter.ts` — Capacitor bridge → same `window.electronAPI` shape.
  - `pwaAdapter.ts` — browser/PWA fallback using `localStorage` for vault + SW for update channel + bottom nav + swipe gestures.

The app code (`dl-secure-channel/src`) never imports Electron directly; it only calls `window.electronAPI?.*`. Missing methods degrade gracefully.

---

## 7. Phase 01 Changes Applied

### Removed
- Empty folders: `apps/dl-secure-channel/src/db/`, `apps/dl-secure-channel/src/protocol/`
- 68 unused import symbols across 28 files (auto-removed via tsc --noUnusedLocals sweep)
- PII-leaking `console.log` on `dl_ids` `PUT /v1/sync/:userId` (userId + key + length)
- Boot-banner `console.log` in `pwaAdapter.ts` and `mobileAdapter.ts`

### Added
- `apps/dl-secure-channel/src/utils/logger.ts` — scoped logger: silent in prod, pretty in dev.

### Migrated `console.*` → `createLogger(scope)`
- `syncService.ts` — 21 calls
- `chatStore.ts` — 2 calls
- `e2eeSessions.ts` — 2 calls
- `electron/main.ts` — changed `console.log` → `console.warn` on update-check failure path

### Bug fixes discovered during audit
- `useRlyConnection.ts`: audit log entry used `actor` field (never defined) — fixed to `userId` to match `AuditLogEntry` type.
- `packages/dl-crypto/src/index.ts`: `DEFAULT_PERMISSIONS` was exported under `export type { ... }` (broken at runtime) — moved to value-export block.
- `stores/chatStore.ts`: `partialize` return type didn't match strict Zustand signature — cast to `ChatState`.

### Invariants verified
- `npx tsc --noEmit` = 0 errors across `apps/dl-secure-channel` + `packages/dl-crypto`.
- `npm run build:pwa` succeeds; gzipped JS bundle = 416 kB (slight reduction from cleanup).

### Remaining tech debt (tracked, not fixed in Phase 01)
- `ChatView.tsx:779` — group messages still use 1-to-1 encryption per recipient; Sender Keys (already implemented in `dl-crypto/senderkeys.ts`) are not wired. Will address in Phase 07/Phase 02.
- 17 "unused local" reports (not imports) skipped during bulk cleanup — need per-file review before removal, as some may signal dropped state that ought to be used (e.g. `lockOnScreenSleep` destructured but never applied, suggests missing feature).
- JS bundle > 500 kB — code-splitting deferred to Phase 02.

---

## 8. Repo Invariants & Conventions

- **Strict TS everywhere** (`strict: true` in `tsconfig.base.json`).
- **Module resolution:** `"bundler"` — explicit `.js` extensions in `.ts` imports where cross-package.
- **React:** 18, function components only, Zustand for state, no Redux, no Context providers except for React's built-ins.
- **Styling:** plain CSS files co-located with components; CSS custom properties for design tokens (`theme/index.css`).
- **No server-side session secrets in repo** — verified Phase 08.
- **Cross-device sync** goes through `/v1/sync/:userId` as opaque blobs keyed by setting name. Never sends vault material.

---

## 9. Master Audit Log (Phases 01 – 08)

| Phase | Theme | Headline outcome |
| ----- | ----- | ---------------- |
| **01** | Codebase mapping + dead code cleanup | Removed stale code, introduced `utils/logger.ts`, wrote this document. |
| **02** | Desktop UI polish | Unified typography tokens, spacing scale, transition vars in `theme/index.css`. |
| **03** | Mobile SPA | 5-tab bottom nav, pull-to-refresh, back-navigation stack on PWA. |
| **04** | Bug hunt | 5 real bugs including a **critical E2EE plaintext-fallback** path (see `BUGS_FIXED.md`). |
| **05** | UX polish | Central `ConfirmDialog` component; every destructive action now confirmed. |
| **06** | Performance | Route-level code splitting + vendor chunk tuning. Main bundle **418 → 78 kB gz (-81 %)**. |
| **07** | Accessibility | Real modal focus trap + restore, aria-labels on all icon-only buttons, `role="log" aria-live` on chat, global `prefers-reduced-motion` support. |
| **08** | Release hardening | Top-level `ErrorBoundary`, CSP meta tag on both HTML entrypoints, `referrer=no-referrer`, audit closeout. |

### Phase 08 deliverables
- `components/ErrorBoundary.tsx` — top-level React error boundary wraps `<App />` in `main.tsx`. Recoverable fallback UI with Dismiss + Reload; uses zero store/crypto/network calls so it survives module-level crashes.
- **Content Security Policy** meta tag on `apps/dl-secure-channel/index.html` and `apps/dl-secure-channel-mobile/pwa.html`:
  - `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`
  - `script-src 'self' 'wasm-unsafe-eval'` (libsodium wasm needs wasm-unsafe-eval; no `'unsafe-eval'`, no `'unsafe-inline'`)
  - `connect-src 'self' https: wss: http://localhost:* ws://localhost:* …` — permissive because IDS/RLY origin is user-configurable, but still excludes `data:` / `blob:` exfil channels
  - `img-src 'self' data: blob:` — avatars are base64
- **`<meta name="referrer" content="no-referrer">`** on both HTMLs — any outbound click from the app never leaks origin info.
- Verified **no** `eval`, `innerHTML=`, or `dangerouslySetInnerHTML` anywhere in `apps/dl-secure-channel/src`.
- Verified **no** bare `console.*` outside `utils/logger.ts`.
- Verified only **1** remaining TODO: `ChatView.tsx:802` (Sender Keys wiring — pre-existing, tracked).

### Known deferrals after the 8-phase audit
- Sender Keys for group E2EE (`ChatView.tsx:802`) — primitives exist in `dl-crypto/senderkeys.ts`, wiring deferred.
- `ConvPersonalize` (1396 lines) not yet code-split (phase 06 deferral).
- Arrow-key navigation inside context menus (phase 07 deferral).
- Cross-device sync of `dl-settings` / `dl-profile` (see `/memories/session/darklock-secure-channel-comprehensive-audit.md`).
- Color-contrast token audit against WCAG AA (phase 07 deferral).
