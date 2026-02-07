# Discord Security Bot - Architecture Assessment & Cleanup Plan

**Date:** December 23, 2025  
**Status:** ASSESSMENT & PLANNING PHASE  
**Scope:** Structure stabilization, safety hardening, clarity improvement

---

## EXECUTIVE SUMMARY

This bot is a **security-first moderation platform** with good foundational systems but suffering from:
- **Monolithic dashboard** (12,792 lines in single file)
- **Fragmented logging** (3+ independent systems)
- **Untracked database migrations** (silent failures possible)
- **Duplicate event handlers** (multiple registrations per Discord event)
- **Scattered configuration** (env checks throughout codebase)

**Risk Level:** MEDIUM - Core functionality works but lacks maintainability and reliability.

---

## CURRENT STATE ANALYSIS

### 1. CODEBASE STRUCTURE

```
src/
├── bot.js (1,791 lines) - Main entry point, event orchestration
├── core/
│   ├── eventLoader.js - Unified event registration
│   ├── events/ - 14 Discord event handlers (clean extraction)
│   └── interactions/ - Interaction handlers
├── dashboard/ (MONOLITHIC)
│   ├── dashboard.js (12,792 lines) ⚠️ TOO LARGE
│   └── security-utils.js - CSRF, brute force protection
├── database/
│   ├── database.js (2,990 lines) - SQLite ORM + migrations
├── security/ (11+ modules)
│   ├── antispam.js, antiraid.js, antinuke.js, etc.
├── utils/ (35+ utility classes)
│   ├── logger.js - Core logging (627 lines)
│   ├── AuditLogger.js - Audit trail (329 lines)
│   ├── ForensicsManager.js - Forensics logging (148 lines)
│   ├── DashboardLogger.js - Dashboard event logging
│   ├── TicketSystem.js, etc.
└── config.json - Security configuration
```

### 2. IDENTIFIED PROBLEMS

#### **CRITICAL - HIGH PRIORITY**

| Issue | Location | Severity | Impact |
|-------|----------|----------|--------|
| **Monolithic Dashboard** | `src/dashboard/dashboard.js` | CRITICAL | 12,792 lines, mixed concerns (auth, billing, logs, settings) |
| **Logging Fragmentation** | `utils/` | HIGH | 3 separate systems: Logger, AuditLogger, ForensicsManager |
| **Ad-Hoc Migrations** | `src/database/database.js` (lines 60+) | HIGH | No schema versioning, silent failures, no ordering |
| **Duplicate Event Handlers** | `bot.js` + `security/*.js` | MEDIUM | ChannelDelete: registered in AntiNukeEngine, AntiNukeManager, auditWatcher |

#### **MEDIUM PRIORITY**

| Issue | Location | Severity | Impact |
|-------|----------|----------|--------|
| **Missing Security Headers** | `dashboard.js` | MEDIUM | CSP configured but other headers incomplete |
| **WebSocket No Rate Limiting** | `dashboard.js` | MEDIUM | No per-IP or per-connection rate limits |
| **Scattered Env Checks** | Throughout codebase | MEDIUM | No centralized config validation at startup |

#### **LOW PRIORITY**

| Issue | Location | Severity | Impact |
|-------|----------|----------|--------|
| **API Response Format** | Multiple endpoints | LOW | Inconsistent response structure |
| **Scope Creep (XP/Economy)** | `src/systems/` | LOW | Unclear if active or deprecated |

---

## DETAILED PROBLEM BREAKDOWN

### 1. DASHBOARD MONOLITH (12,792 lines)

**Current Structure:**
```javascript
src/dashboard/dashboard.js
├── Middleware setup (helmet, CORS, CSP, cache control)
├── OAuth/Auth routes (Discord login flow)
├── Billing/Payment routes (Stripe integration)
├── Guild management routes
├── Logging/incidents routes
├── Settings routes
├── Analytics routes
├── Ticket management routes
├── WebSocket setup
└── 100+ route handlers inline
```

**Problems:**
1. Single-responsibility principle violated
2. Difficult to test individual route groups
3. Hard to find specific routes
4. Auth logic mixed with business logic
5. Billing tightly coupled with core routes

**Routes That Exist** (partial list):
- `POST /api/stripe/create-checkout-session`
- `GET /api/stripe/session/:sessionId`
- `POST /webhooks/stripe`
- `GET /api/logs/:guildId`
- `POST /api/logs/:guildId/clear`
- `GET /dashboard/*` routes
- `GET /admin/*` routes
- `GET /api/guilds/:guildId/*` routes
- WebSocket upgrade routes

---

### 2. LOGGING FRAGMENTATION

Three independent logging systems with overlapping scope:

**Logger** (`src/utils/logger.js` - 627 lines)
- Tables: `bot_logs`, `dashboard_audit`
- Methods: `logCommand()`, `logAPI()`, `logDashboardAction()`
- Purpose: General bot + dashboard logging

**AuditLogger** (`src/utils/AuditLogger.js` - 329 lines)
- Tables: `audit_logs` (encrypted)
- Methods: `logEvent()`, `logRoleChange()`, `logChannelChange()`
- Purpose: Detailed guild change tracking with encryption

**ForensicsManager** (`src/utils/ForensicsManager.js` - 148 lines)
- Tables: `audit_logs` (shared with AuditLogger)
- Methods: `logAuditEvent()`, `logRoleChange()`, similar to AuditLogger
- Purpose: Replay-capable audit logging with optional encryption

**DashboardLogger** (`src/utils/DashboardLogger.js`)
- Writes to dashboard's WebSocket subscribers
- Overlaps with Logger and AuditLogger

**Problem:** 
- 4 writers, 1 table is sufficient
- Different schemas and approaches
- No clear owner
- Hard to query all events consistently

---

### 3. DATABASE MIGRATIONS (No Schema Versioning)

**Current State** (`src/database/database.js`):
```javascript
async runMigrations() {
    try {
        // Try to add column, catch silently
        try {
            await this.run(`ALTER TABLE tickets ADD COLUMN subject TEXT`);
            console.log('✅ Added subject column');
        } catch (e) {
            // Column already exists
        }
        // ... 50+ more try/catch blocks
    }
}
```

**Problems:**
1. No `schema_version` table to track what's been run
2. Silent failures - column exists check is implicit
3. No ordering guarantee if code changes
4. Can't replay migrations
5. Can't rollback
6. No idempotency guarantee in complex scenarios
7. Missing migrations might not execute on fresh DB

**Database Structure:**
```
Tables: 60+
├── Guild configs: guild_configs, guild_settings, guild_subscriptions
├── Logging: bot_logs, dashboard_audit, audit_logs, incidents
├── Tickets: tickets, active_tickets, ticket_messages, ticket_users
├── Security: user_verifications, verification_logs, phishing_attempts
├── Moderation: mute_logs, ban_logs, warnings
├── Systems: ranks, xp_stats, inventory (likely deprecated)
```

---

### 4. DUPLICATE EVENT HANDLERS

**Issue:** Same Discord.js event handled in multiple places

**Example - `channelDelete`:**
```
File 1: src/security/AntiNukeEngine.js
    guild.client.on('channelDelete', async (channel) => { ... })

File 2: src/security/AntiNukeManager.js
    client.on('channelDelete', async (channel) => { ... })

File 3: src/security/auditWatcher.js
    client.on('channelDelete', async (channel) => { ... })
```

**Result:** 
- Event fires 3 times
- Potential double-processing
- Hard to debug which handler is doing what
- Race conditions possible

**Event Handlers Also Registered:**
- `guildMemberUpdate`: permissionMonitor.js + core/events
- `roleUpdate`: permissionMonitor.js + core/events
- Custom handlers scattered in bot.js (line 770+)

---

### 5. SECURITY HEADERS (Partially Implemented)

**What's Implemented:**
- ✅ Content-Security-Policy (dynamic for WebSocket)
- ✅ HSTS (HTTP Strict-Transport-Security)
- ✅ Permissions-Policy (camera, microphone, geolocation disabled)

**What's Missing:**
- ❌ X-Frame-Options (clickjacking protection)
- ❌ X-Content-Type-Options (MIME-sniffing protection)
- ❌ Referrer-Policy
- ❌ Expect-CT (certificate transparency)

---

### 6. WEBSOCKET SAFETY

**Current State:**
```javascript
const wss = new WebSocket.Server({ server: this.server });
wss.on('connection', (ws) => {
    ws.on('message', async (data) => {
        // No rate limiting
        // No IP tracking
        // No connection limit
    });
});
```

**Missing:**
- No per-IP rate limiting
- No per-connection message rate limiting
- No automatic cleanup of stale subscriptions
- No heartbeat/ping-pong mechanism
- No memory leak prevention

---

### 7. CONFIGURATION SCATTERING

**Env var checks scattered throughout:**
```javascript
// src/bot.js
const SKIP_VALIDATION = process.env.SKIP_ENV_VALIDATION === '1' || hostAutoSkip;

// src/dashboard/dashboard.js
const domain = process.env.DOMAIN || process.env.RENDER_EXTERNAL_URL || ...;

// src/security/userVerification.js
const captchaRequired = process.env.REQUIRE_CAPTCHA === 'true';

// Multiple files check for same vars with different fallbacks
```

**Missing:**
- Centralized config normalization at startup
- No schema for required vs optional env vars
- No validation of values (e.g., port number)
- Fallbacks scattered everywhere

---

## CLEANUP PLAN (STEP-BY-STEP)

### PHASE 1: PREPARATION & PLANNING (No Code Changes)
**Duration:** 1-2 hours  
**Outcome:** Clear roadmap, no risk

- [ ] Create this assessment document (DONE)
- [ ] Create migration strategy document
- [ ] List all routes currently in dashboard.js
- [ ] Map logging calls to their sources
- [ ] Identify all event handler conflicts
- [ ] Document all env var dependencies

---

### PHASE 2: LOGGING CONSOLIDATION (HIGH PRIORITY)
**Duration:** 4-6 hours  
**Risk:** MEDIUM (database structure change)

**Step 1: Create unified event log schema**
```sql
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,        -- COMMAND, API_CALL, GUILD_CHANGE, SECURITY_EVENT, etc.
    event_category TEXT,              -- moderation, auth, billing, settings, etc.
    guild_id TEXT,
    user_id TEXT,
    executor_id TEXT,
    before_state TEXT,               -- JSON (encrypted if sensitive)
    after_state TEXT,                -- JSON (encrypted if sensitive)
    metadata TEXT,                   -- Additional context
    ip_address TEXT,                 -- Hashed if present
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**Step 2: Refactor Logger as single writer**
- [ ] Merge `logCommand()`, `logAPI()`, `logDashboardAction()` into single `log(type, category, data)` method
- [ ] Merge `AuditLogger.logEvent()` calls to use Logger
- [ ] Merge `ForensicsManager.logAuditEvent()` calls to use Logger
- [ ] Keep encryption logic, but centralize in Logger
- [ ] Remove old tables: `bot_logs`, `dashboard_audit`, separate `audit_logs`

**Step 3: Keep readers as-is**
- [ ] DashboardLogger reads from Logger via subscription
- [ ] ForensicsManager provides decryption/replay interface
- [ ] All queries go through Logger methods

**Migration:** Create migration that backfills `events` table from old tables.

---

### PHASE 3: DATABASE MIGRATIONS (HIGH PRIORITY)
**Duration:** 3-4 hours  
**Risk:** MEDIUM (requires careful migration)

**Step 1: Create schema versioning system**
```javascript
// Create schema_version table
await db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        executed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        execution_time_ms INTEGER,
        status TEXT DEFAULT 'success'  -- 'success' or 'failed'
    )
`);
```

**Step 2: Convert all inline migrations to ordered files**
```
src/database/migrations/
├── 001_initial_schema.js
├── 002_add_ticket_columns.js
├── 003_add_antinuke_columns.js
├── 004_create_events_table.js (from logging consolidation)
├── ...
└── index.js (migration runner)
```

**Step 3: Implement migration runner**
```javascript
async runMigrations() {
    const currentVersion = await this.getCurrentSchemaVersion();
    const migrationFiles = this.getMigrationFiles();
    
    for (const migration of migrationFiles.filter(m => m.version > currentVersion)) {
        try {
            await migration.up(this);
            await this.recordMigration(migration.version, 'success');
        } catch (err) {
            await this.recordMigration(migration.version, 'failed', err.message);
            throw err;  // Fail hard on migration error
        }
    }
}
```

**No Rollbacks:** Add comment that rollbacks require manual DBA intervention (SQLite limitation).

---

### PHASE 4: DUPLICATE EVENT HANDLERS (HIGH PRIORITY)
**Duration:** 2-3 hours  
**Risk:** MEDIUM (must test all event behavior)

**Step 1: Audit all event registrations**
- [ ] List all `client.on()` and `client.once()` calls
- [ ] Group by event name
- [ ] Identify conflicts

**Step 2: Consolidate into single handler per event**
- [ ] Create [consolidated event handler] for each conflicting event
- [ ] Move logic from multiple files into one
- [ ] Keep registration in `src/core/events/` ONLY
- [ ] Load via EventLoader

**Step 3: Disable duplicate registrations**
- [ ] Comment out/remove duplicate handlers in `bot.js` line 770+
- [ ] Comment out duplicate handlers in `security/*.js` files
- [ ] Add comment: "This is handled by src/core/events/[eventName].js"

**Step 4: Test each event**
- [ ] Verify each handler fires once per event
- [ ] Check that all logic is still executing
- [ ] Monitor logs for "duplicate handler" warnings

**Events to Check:**
- `channelDelete` (AntiNukeEngine, AntiNukeManager, auditWatcher)
- `roleUpdate` (permissionMonitor, core/events)
- `guildMemberUpdate` (permissionMonitor, core/events, verification)
- Custom internal events (guildConfigUpdate)

---

### PHASE 5: DASHBOARD DECOMPOSITION (HIGH PRIORITY)
**Duration:** 6-8 hours  
**Risk:** HIGH (largest refactor, extensive testing needed)

**Step 1: Create router structure**
```
src/dashboard/
├── dashboard.js (refactored to 200-300 lines) - Express app setup ONLY
├── middleware/
│   ├── authentication.js - authenticateToken, authenticateTokenHTML
│   ├── validation.js - validateCSRF
│   ├── security.js - rate limiting, brute force detection
│   └── errors.js - global error handler
├── routes/
│   ├── auth.js - OAuth login, callback, logout
│   ├── guild.js - Guild settings, config endpoints
│   ├── logs.js - Log retrieval, incident reporting
│   ├── billing.js - Stripe checkout, session status
│   ├── settings.js - Dashboard settings, preferences
│   ├── analytics.js - Analytics endpoints
│   ├── tickets.js - Ticket management endpoints
│   └── static.js - HTML page routes
├── controllers/
│   ├── authController.js
│   ├── guildController.js
│   └── ... (one per router)
└── security-utils.js (unchanged)
```

**Step 2: Extract each route group**
**Order matters - do in this sequence:**

1. **Auth Routes** (OAuth, login, logout, callback)
   - Extract to `routes/auth.js`
   - Keep: Discord OAuth flow, token validation, logout
   
2. **Guild Routes** (guild settings, config)
   - Extract to `routes/guild.js`
   - Move: `/api/guilds/:guildId/*`, `/api/settings/*`

3. **Logging Routes** (logs, incidents, forensics)
   - Extract to `routes/logs.js`
   - Move: `/api/logs/:guildId`, incident endpoints

4. **Billing Routes** (Stripe)
   - Extract to `routes/billing.js`
   - Move: `/api/stripe/*`, `/webhooks/stripe`

5. **Settings Routes** (user preferences, dashboard settings)
   - Extract to `routes/settings.js`
   - Move: `/api/settings/*`, `/api/preferences/*`

6. **Static/Page Routes** (HTML pages)
   - Extract to `routes/static.js`
   - Move: `/`, `/dashboard`, `/payment`, `/tickets`, etc.

**Step 3: Refactor dashboard.js**
```javascript
class SecurityDashboard {
    constructor(bot) {
        this.bot = bot;
        this.app = express();
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        // Helmet, CORS, CSP, cache control, etc.
        // Move to middleware/ folder if complex
    }

    setupRoutes() {
        this.app.use('/auth', require('./routes/auth')(this.bot));
        this.app.use('/api/guilds', require('./routes/guild')(this.bot));
        this.app.use('/api/logs', require('./routes/logs')(this.bot));
        this.app.use('/api/stripe', require('./routes/billing')(this.bot));
        this.app.use('/api/settings', require('./routes/settings')(this.bot));
        this.app.use('/', require('./routes/static')(this.bot));
    }

    async start(port) { /* ... */ }
    async stop() { /* ... */ }
}
```

**Step 4: No logic changes**
- Each extracted route file is 1-1 copy from monolith
- Only the organization changes, not the code behavior

---

### PHASE 6: SECURITY HEADERS (MEDIUM PRIORITY)
**Duration:** 30 minutes  
**Risk:** LOW

**Add to dashboard.js middleware:**
```javascript
app.use((req, res, next) => {
    // Already have: Content-Security-Policy, HSTS, Permissions-Policy
    
    // Add missing headers:
    res.setHeader('X-Frame-Options', 'DENY');                           // Clickjacking
    res.setHeader('X-Content-Type-Options', 'nosniff');                 // MIME-sniffing
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); // Referrer leaks
    res.setHeader('Expect-CT', 'max-age=86400, enforce');               // Certificate transparency
    
    // Optional but recommended:
    // res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    // res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    
    next();
});
```

---

### PHASE 7: WEBSOCKET SAFETY (MEDIUM PRIORITY)
**Duration:** 2-3 hours  
**Risk:** MEDIUM

**Step 1: Add per-IP rate limiting**
```javascript
const connectionMap = new Map();  // IP -> { count, resetTime }

wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    const now = Date.now();
    
    if (!connectionMap.has(ip)) {
        connectionMap.set(ip, { count: 0, resetTime: now + 60000 });
    }
    
    const data = connectionMap.get(ip);
    if (data.resetTime <= now) {
        data.count = 0;
        data.resetTime = now + 60000;
    }
    
    data.count++;
    if (data.count > 10) {  // Max 10 connections per IP per minute
        ws.close(1008, 'Too many connections from your IP');
        return;
    }
    
    // Track this connection
    ws.ip = ip;
    ws.messageCount = 0;
    ws.messageResetTime = now + 5000;
});
```

**Step 2: Add per-connection message rate limiting**
```javascript
ws.on('message', (data) => {
    const now = Date.now();
    
    if (ws.messageResetTime <= now) {
        ws.messageCount = 0;
        ws.messageResetTime = now + 5000;
    }
    
    ws.messageCount++;
    if (ws.messageCount > 30) {  // Max 30 messages per 5 seconds
        ws.close(1008, 'Message rate limit exceeded');
        return;
    }
    
    // Process message
});
```

**Step 3: Add heartbeat + cleanup**
```javascript
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            ws.terminate();
            return;
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

ws.isAlive = true;
ws.on('pong', () => { ws.isAlive = true; });

// Cleanup on close
server.on('close', () => clearInterval(heartbeatInterval));
```

---

### PHASE 8: ENVIRONMENT CONFIGURATION (MEDIUM PRIORITY)
**Duration:** 1-2 hours  
**Risk:** LOW

**Step 1: Create EnvConfig class** (extends existing EnvValidator)
```javascript
class EnvConfig {
    constructor() {
        this.schema = {
            required: {
                DISCORD_TOKEN: { type: 'string', description: 'Bot token' },
                DISCORD_CLIENT_ID: { type: 'string' },
                DISCORD_CLIENT_SECRET: { type: 'string' },
                JWT_SECRET: { type: 'string', minLength: 32 },
                DATABASE_PATH: { type: 'string', default: './data/' },
            },
            optional: {
                PRODUCTION_MODE: { type: 'boolean', default: false },
                WEB_PORT: { type: 'number', default: 3001 },
                LOG_LEVEL: { type: 'string', enum: ['debug', 'info', 'warn', 'error'], default: 'info' },
            }
        };
    }

    validate() {
        // Check required, validate types, check constraints
        // Return errors or normalized config
    }

    get(key, defaultValue) {
        // Single source of truth for all env reads
        const value = process.env[key];
        if (!value && defaultValue !== undefined) return defaultValue;
        return this.normalizeValue(key, value);
    }
}
```

**Step 2: Replace all scattered checks**
```javascript
// Before:
const skipValidation = process.env.SKIP_ENV_VALIDATION === '1' || process.env.SKIP_ENV_VALIDATION === 'true';

// After:
const skipValidation = config.get('SKIP_ENV_VALIDATION', false);
```

**Step 3: Attach to bot at startup**
```javascript
const bot = new SecurityBot();
bot.envConfig = new EnvConfig();
bot.envConfig.validate();  // Throws if invalid
// Now all modules use: bot.envConfig.get('KEY')
```

---

### PHASE 9: API RESPONSE CONSISTENCY (LOW PRIORITY)
**Duration:** 2-3 hours  
**Risk:** LOW

**Step 1: Create response wrapper**
```javascript
// middleware/response.js
const responseHandler = {
    success: (res, data, statusCode = 200) => {
        res.status(statusCode).json({
            success: true,
            data,
            timestamp: new Date().toISOString()
        });
    },
    error: (res, message, statusCode = 400, details = null) => {
        res.status(statusCode).json({
            success: false,
            error: message,
            details,
            timestamp: new Date().toISOString()
        });
    }
};
```

**Step 2: Use in all endpoints**
```javascript
// Before: res.json({ ... arbitrary structure ... })
// After: responseHandler.success(res, { ... })
```

---

## CONSTRAINTS & WHAT NOT TO CHANGE

### ✅ SAFE TO CHANGE (STRUCTURAL)
- Dashboard file organization
- Database migrations structure
- Event handler deduplication
- Logging table structure (backward compat migration)
- Env var normalization
- Response wrapper

### ⚠️ CAREFUL (LIGHT REFACTORING ONLY)
- Security module logic - **DO NOT change detection algorithms**
- Ticket system - **DO NOT change user-facing behavior**
- Auth flow - **Test extensively before deployment**
- WebSocket - **Ensure all dashboards still get updates**

### ❌ DO NOT CHANGE
- **NO logic rewrites** - Keep all current behavior
- **NO TypeScript migration** - Stay with Node.js
- **NO ORM switch** - Keep sqlite3
- **NO new features** - Stabilization only
- **NO removal of deprecated code** - Mark as deprecated instead
- **NO dependency upgrades** - Only if necessary for security

---

## ROLLOUT SEQUENCE (Recommended Order)

**Week 1:**
1. ✅ Phase 1: Preparation (1-2 hrs)
2. ✅ Phase 3: Database Migrations (3-4 hrs)
   - Create migration system
   - Test on staging DB
   - No data changes, just versioning

3. ✅ Phase 2: Logging Consolidation (4-6 hrs)
   - Create unified events table
   - Update Logger class
   - Test logging in all paths
   - Deploy with fallback to old tables

**Week 2:**
4. ✅ Phase 4: Duplicate Event Handlers (2-3 hrs)
   - Consolidate handlers
   - Test each event fires once
   - Verify all logic executes

5. ✅ Phase 5: Dashboard Decomposition (6-8 hrs)
   - Extract routes
   - No logic changes
   - Test all endpoints
   - Deploy incrementally

**Week 3:**
6. ✅ Phase 6: Security Headers (30 min)
   - Add missing headers
   - Test CSP in browser
   - No service impact

7. ✅ Phase 7: WebSocket Safety (2-3 hrs)
   - Add rate limiting
   - Test with multiple clients
   - Monitor for connection drops

8. ✅ Phase 8: Env Config (1-2 hrs)
   - Centralize config
   - Validate at startup
   - Replace scattered checks

9. ✅ Phase 9: API Response (2-3 hrs) - Optional, can defer

**Testing After Each Phase:**
- Unit tests where applicable
- Manual testing on staging
- Check logs for errors
- Verify metrics unchanged

---

## ESTIMATED EFFORT

| Phase | Hours | Risk | Priority |
|-------|-------|------|----------|
| 1. Preparation | 1-2 | LOW | 1 |
| 2. Logging | 4-6 | MEDIUM | 2 |
| 3. Migrations | 3-4 | MEDIUM | 2 |
| 4. Event Handlers | 2-3 | MEDIUM | 2 |
| 5. Dashboard | 6-8 | HIGH | 1 |
| 6. Security Headers | 0.5 | LOW | 3 |
| 7. WebSocket | 2-3 | MEDIUM | 3 |
| 8. Env Config | 1-2 | LOW | 3 |
| 9. API Response | 2-3 | LOW | 4 |
| **Testing & Fixes** | 5-8 | - | - |
| **TOTAL** | **27-41 hours** | - | - |

---

## SUCCESS CRITERIA

After cleanup is complete:

✅ **Dashboard:**
- Split into 5-6 router files
- Each router < 500 lines
- Clear separation of concerns

✅ **Logging:**
- Single `events` table
- One Logger writer class
- All modules call Logger.log()

✅ **Database:**
- `schema_version` table exists
- All migrations in `migrations/` folder
- Migrations execute in order, tracked

✅ **Events:**
- No handler registered twice for same event
- Each Discord event has exactly one entry point
- No race conditions in logs

✅ **Security:**
- All missing headers added
- WebSocket rate limiting active
- Config centralized and validated

✅ **Testing:**
- No feature regressions
- All logs write correctly
- All endpoints respond correctly
- No duplicate event processing

---

## ROLLBACK STRATEGY

Each phase is independent:
- **Phase 1-3:** Backward compatible (old tables still work)
- **Phase 4:** Revert handlers to dual registration if needed
- **Phase 5:** Revert to monolith if routing breaks
- **Phase 6-8:** Can be disabled individually without affecting core

---

## NEXT STEPS

1. **REVIEW THIS DOCUMENT** - Ensure alignment with project vision
2. **PRIORITIZE PHASES** - Confirm sequence with team
3. **CREATE TRACKING** - Add issues/PRs for each phase
4. **TEST PLAN** - Define specific tests for each phase
5. **BEGIN PHASE 1** - Preparation work, no code changes

---

**Document Version:** 1.0  
**Last Updated:** 2025-12-23  
**Status:** Ready for Implementation

