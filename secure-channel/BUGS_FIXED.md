# Phase 04 — Bug Hunt: Fixes

> End-to-end audit of user flows. Every bug found was fixed in place; nothing was left for later.

## Scope
- Shared source: `apps/dl-secure-channel/src/` (used by both Electron desktop and the Capacitor / PWA mobile builds).
- Flows audited: auth, DM send, DM receive, reactions, reply, edit, delete, attachments, group create, group invite, friend request/accept, settings persistence, WS reconnect, offline send.

---

## Bug 1 — Reactions broken for everyone (all users share one phantom slot)

**File:** `apps/dl-secure-channel/src/stores/chatStore.ts` → `addReaction`

**Symptom:** Tapping any emoji reaction toggled a single entry keyed to an empty string (`""`). Every user's reaction went into the same slot, so reactions never showed the real user's ID and the count was nonsense.

**Root cause:** The action had a hardcoded `const userId = ''` with a stale comment `// will be injected`. Nothing ever injected it.

**Fix:** Read the current user from `useAuthStore.getState().userId` inside the action. Early-return if there's no signed-in user.

**Verification:** `tsc --noEmit` passes; reactions now toggle per-user as the `emoji → userIds[]` shape in `Message.reactions` was always expecting.

---

## Bug 2 — No upper bound on message length

**File:** `apps/dl-secure-channel/src/components/ChatView.tsx` → `handleSend`

**Symptom:** Pasting a multi-megabyte blob into the composer would freeze the UI, then send a message the relay would try to forward, then reject or crash. No feedback to the user.

**Fix:** Guard at the top of `handleSend` — `if (text.length > 10_000) { setSendError(...); return; }` with a user-visible banner showing current / max character count.

---

## Bug 3 — CRITICAL: silent plaintext fallback when E2EE fails

**File:** `apps/dl-secure-channel/src/components/ChatView.tsx` → `handleSend`

**Symptom:** If `encryptPayload(recipient, wsPayload)` returned `null` (i.e. no Double Ratchet session could be established — pre-keys missing, recipient offline the whole time, bundle fetch failed), the code silently fell through and sent the message **in plaintext** via the relay. The UI still showed a lock icon.

**Why this is critical:** The entire product promise is E2EE. A silent downgrade to plaintext is exactly the class of bug that makes a "secure messenger" indistinguishable from a normal one, while misleading the user into believing otherwise. This defeats every threat model the app is built around.

**Fix:** The plaintext fallback branch is gone. If `encryptPayload` fails:
1. Show an inline error: *"Secure session unavailable — message not sent. Ask the recipient to come online so we can exchange keys."*
2. Mark the local message as `status: 'failed'` via `updateMessageStatus`.
3. Return early. Nothing goes over the wire.

**Verification:** The `'failed'` status already exists in `Message['status']` (in `packages/dl-crypto/src/types.ts`), so no type widening was needed. `tsc --noEmit` passes.

---

## Bug 4 — Native `alert()` for attachment-too-large

**File:** `apps/dl-secure-channel/src/components/ChatView.tsx` → `handleSend`

**Symptom:** Attaching > 8 MB of files popped a native browser `alert()` dialog — jarring, unthemed, blocks the whole window on Electron.

**Fix:** Replaced with inline `setSendError('Attachments too large — maximum 8 MB total')`. Same banner UI used by the other error paths, dismissable with ×.

---

## Bug 5 — Silent message loss when relay is offline

**File:** `apps/dl-secure-channel/src/components/ChatView.tsx` → `handleSend`
**File:** `apps/dl-secure-channel/src/net/wsClient.ts` → `send`

**Symptom:** `ws.send(...)` returns `false` when the WebSocket isn't in `OPEN` state, but every caller in `handleSend` ignored the return value. Offline sends looked successful in the UI (status `'sent'`) but never actually left the device — and never retried.

**Fix:** Both the DM and group branches now check the `ws.send` return value. If it's `false`:
1. Show *"You appear to be offline — message not sent."* in the input error banner.
2. Mark the message `'failed'` in the local store.
3. Return early.

The user now knows to wait for reconnect before re-sending, instead of staring at a message that looks delivered.

---

## Supporting UI — `.chat-input-error` banner

**File:** `apps/dl-secure-channel/src/components/ChatView.css`

Added a new themed error banner above the reply/edit context row, using the design-token palette from Phase 02:
- `--dl-danger` foreground / `--dl-danger-muted` background
- Standard `--dl-radius-md`, `--dl-space-*` spacing
- Slide-up animation and hover-dismiss button

Used by bugs 2, 3, 4 and 5 for a consistent, dismissable error surface.

---

## Audited & clean

These flows were walked top-to-bottom and found correct — no fixes applied:

| Flow | File(s) | Notes |
|---|---|---|
| Friend request | `friendStore.ts`, `FriendsHome.tsx` | Self-DM prevented via `u.userId !== userId` in search. Error handling present on both the store and the caller. |
| Group create | `chatStore.ts → createGroup`, `GroupManagement.tsx` | Empty name blocked at UI (`!name.trim()`), length capped at 64. Default category/channel/role created atomically. |
| Settings persistence | `settingsStore.ts` | Zustand `persist` middleware with name `dl-settings`; all toggles pure `set` calls. Electron-only toggles guarded by `electron()?.` optional-chain so they no-op in the PWA. |
| WebSocket reconnect | `wsClient.ts` | Exponential backoff capped at 30 s, timer cleared on reconnect, status transitions go through `useConnectionStore`. |
| `Message.status` type | `packages/dl-crypto/src/types.ts` | Already includes `'failed'` — no widening needed for bug 3 / 5 fixes. |

---

## Verification

```bash
cd apps/dl-secure-channel
npx tsc --noEmit   # EXIT=0 — clean
```

Build + deploy performed at end of phase (see deploy log below).
