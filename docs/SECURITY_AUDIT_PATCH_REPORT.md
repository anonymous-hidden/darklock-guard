# Security Audit Patch Report

## Patch Plan Checklist

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | CRITICAL | Unauthenticated `/api/logs/:guildId` | ✅ PATCHED |
| 2 | CRITICAL | No guild access check on destructive operations (11 routes) | ✅ PATCHED |
| 3 | CRITICAL | SQL injection via `pro_codes.duration_days` (2 patterns) | ✅ PATCHED |
| 4 | CRITICAL | SQL injection via `createOrUpdateUserRecord` column names | ✅ PATCHED |
| 5 | CRITICAL | AntiRaid lockdown destroys channel permissions | ✅ PATCHED |
| 6 | HIGH | Auth skip list too broad (`/admin/`, `/rfid/` prefixes) | ✅ PATCHED |
| 7 | HIGH | JWT token leaked in login JSON response body | ✅ PATCHED |
| 8 | HIGH | Public `/platform/api/metrics` (no auth) | ✅ PATCHED |
| 9 | HIGH | Inconsistent backends (profile JSON vs SQLite) | ⚠️ DEFERRED |
| 10 | HIGH | Duplicate table definitions across files | ⚠️ DOCUMENTED |
| 11 | HIGH | No WAL mode / busy_timeout / foreign_keys on SQLite | ✅ PATCHED |
| 12 | MEDIUM | Broken CSRF (token generated but never validated) | ✅ PATCHED |
| 13 | MEDIUM | Setup pages served without authentication (7 pages) | ✅ PATCHED |
| 14 | MEDIUM | Unbounded in-memory caches (3 Maps) | ✅ PATCHED |
| 15 | MEDIUM | Plaintext password fallback in production | ✅ PATCHED |
| 16 | MEDIUM | Error messages leak stack traces / internals | ✅ PATCHED |
| 17 | MEDIUM | CSP `unsafe-inline` in darklock/server.js | ⚠️ DEFERRED (requires frontend script refactor) |
| 18 | MEDIUM | Coin transfer race condition (TOCTOU) | ✅ PATCHED |
| 19 | MEDIUM | Inconsistent level formula (3 different formulas) | ✅ PATCHED |
| 20 | MEDIUM | `Math.random()` used for JWT secret generation | ✅ PATCHED |
| 21 | MEDIUM | Foreign keys not enforced (PRAGMA added) | ✅ PATCHED |
| 22 | LOW | Dead code `handleXPGain` in messageCreate.js | ✅ DOCUMENTED |
| 23 | LOW | Auto-kick timer persistence | ⚠️ DEFERRED |
| 24 | LOW | `writeFileSync` blocks event loop in RankSystem | ✅ PATCHED |
| 25 | LOW | Leaderboard: open CORS, no rate limiting, no caching | ✅ PATCHED |
| 26 | LOW | Migration consolidation | ⚠️ DEFERRED |
| 27 | LOW | Log table retention/cleanup | ⚠️ DEFERRED |

**Patched: 21/27 | Deferred: 6 (require larger refactors)**

---

## Files Modified

| File | Changes |
|------|---------|
| `src/dashboard/dashboard.js` | Auth on logs, guild guards (11 routes), SQL injection (2), auth skip list, JWT leak, setup pages auth, plaintext password, error sanitization, BoundedMap (3 caches), CSRF validation middleware, self-test endpoint, imports |
| `src/dashboard/middleware/guildGuard.js` | **NEW** — Centralized guild access guard, `isValidSnowflake`, `BoundedMap` class |
| `src/database/database.js` | WAL mode + busy_timeout + foreign_keys, column allowlist, getActionStats parameterization, atomic coin transfers, lockdown_snapshots table |
| `src/security/antiraid.js` | Permission snapshots (constructor, lockdown, unlock), DB persistence for crash recovery |
| `darklock/routes/platform/index.js` | `requireAuth` on `/api/metrics` |
| `src/web/server.js` | Restricted CORS, rate limiting, response cache, guildId validation |
| `src/utils/levelFormula.js` | **NEW** — Canonical level formula module |
| `src/utils/RankSystem.js` | Async `writeFile` (replaces `writeFileSync`), debounced saves |
| `src/utils/RankCardGenerator.js` | Uses canonical level formula |
| `src/systems/rankSystem.js` | Uses canonical level formula |
| `src/events/messageCreate.js` | Dead code documented, formula corrected |
| `setup.js` | `crypto.randomBytes` replaces `Math.random` |
| `tests/security-regression.test.js` | **NEW** — 31 regression tests |

---

## Breaking Changes

### 1. CSRF Token Required on Mutating API Calls
**Impact:** All POST/PUT/DELETE/PATCH requests to `/api/*` now require an `X-CSRF-Token` header.

**Migration:**
```javascript
// Frontend must fetch CSRF token first
const { csrfToken } = await fetch('/api/csrf-token').then(r => r.json());

// Include in all mutating requests
fetch('/api/some-endpoint', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify(data)
});
```

**Exemptions:** Admin login (`/api/login`), v3 API, webhooks, and admin-role sessions are exempt.

### 2. Platform Metrics Endpoint Now Requires Auth
**Impact:** `GET /platform/api/metrics` returns 401 without valid session.

**Migration:** Ensure monitoring scripts authenticate before polling metrics.

### 3. Login Response No Longer Returns JWT in Body
**Impact:** `POST /api/login` no longer returns `{ token: '...' }` in the JSON response.

**Migration:** JWT is delivered via HttpOnly cookie only. Frontend should rely on cookie-based authentication (already the default).

### 4. Level Formula Changed for RankCardGenerator & systems/rankSystem
**Impact:** Previously `level² × 100`, now `(level/0.1)²` (matching the canonical formula).

**Migration:** Users' displayed progress bars and XP requirements will change. Existing levels are unaffected (stored as integers), but progress percentages will differ.

### 5. Leaderboard CORS Restricted
**Impact:** Leaderboard API (`/api/leaderboard/:guildId`) only accepts requests from configured origins.

**Migration:** Set `DASHBOARD_ORIGIN` environment variable to comma-separated allowed origins (defaults to `http://localhost:3001`).

---

## Verification Commands

### Automated Tests
```bash
# Run all security regression tests (31 tests)
npx jest tests/security-regression.test.js --verbose
```

### Manual Verification (curl)

```bash
# Replace with your actual dashboard URL
BASE=http://localhost:3001

# 1. CRITICAL 1: Logs endpoint requires auth (expect 401)
curl -s -o /dev/null -w "%{http_code}" $BASE/api/logs/123456789012345678
# Expected: 401

# 2. CSRF protection (expect 403 on POST without token)
curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/api/settings/update \
  -H "Content-Type: application/json" \
  -b "dashboardToken=YOUR_TOKEN" \
  -d '{"guildId":"123456789012345678"}'
# Expected: 403

# 3. Platform metrics requires auth (expect 401)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3002/platform/api/metrics
# Expected: 401 or 302

# 4. Leaderboard CORS (expect CORS error from wrong origin)
curl -s -o /dev/null -w "%{http_code}" -H "Origin: https://evil.com" \
  $BASE:3005/api/leaderboard/123456789012345678
# Expected: error or no Access-Control-Allow-Origin header

# 5. Invalid guild ID rejected (expect 400)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3005/api/leaderboard/invalid
# Expected: 400

# 6. Security self-test (requires admin auth cookie)
curl -s $BASE/security/self-test -b "dashboardToken=YOUR_ADMIN_TOKEN"
# Expected: JSON with all checks PASS

# 7. Setup page requires auth (expect redirect or 401)
curl -s -o /dev/null -w "%{http_code}" $BASE/setup/security
# Expected: 401 or redirect to login
```

### Database Verification
```bash
# Connect to SQLite and verify PRAGMAs
sqlite3 data/security_bot.db "PRAGMA journal_mode; PRAGMA foreign_keys; PRAGMA busy_timeout;"
# Expected: wal | 1 | 5000
```

---

## Deferred Items (Require Larger Refactors)

| # | Finding | Reason for Deferral |
|---|---------|-------------------|
| 9 | Profile JSON vs SQLite | 14 write endpoints would need full migration to SQLite. Risk of data loss during transition. Should be a dedicated sprint. |
| 10 | Duplicate table definitions | Tables defined in 3 files targeting different databases. Consolidation requires schema migration planning. |
| 17 | CSP unsafe-inline | Frontend uses inline event handlers (`onclick`, etc.) that must be refactored to external scripts before removing `unsafe-inline`. |
| 23 | Auto-kick timer persistence | Requires timer serialization/deserialization layer. Low impact. |
| 26 | Migration consolidation | Current CREATE TABLE IF NOT EXISTS approach is functional; formal migration system is architectural change. |
| 27 | Log retention | Requires scheduler and retention policy design. Low urgency. |
