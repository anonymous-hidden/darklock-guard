# Dashboard Routes - Decomposition Map

This document maps all routes currently in `src/dashboard/dashboard.js` to their target router files during the decomposition phase.

**Total Routes:** 120+  
**Current File Size:** 12,792 lines  
**Target Structure:** 6 routers, each < 500 lines

---

## ROUTER 1: AUTH ROUTES → `src/dashboard/routes/auth.js`

**Purpose:** Discord OAuth, login/logout, token management

| Method | Route | Handler | Priority |
|--------|-------|---------|----------|
| POST | `/auth/login` | `handleLogin()` | HIGH |
| GET | `/auth/discord` | `handleDiscordAuth()` | HIGH |
| GET | `/auth/discord/callback` | `handleDiscordCallback()` | HIGH |
| POST | `/auth/logout` | `handleLogout()` | HIGH |
| GET | `/auth/logout` | `handleLogout()` | HIGH |
| GET | `/logout` | `handleLogout()` | HIGH |
| GET | `/api/csrf-token` | Return CSRF token | MEDIUM |
| GET | `/api/auth/check` | `authenticateToken` middleware test | MEDIUM |
| GET | `/api/auth/me` | Return current user info | MEDIUM |
| GET | `/auth/debug` | `debugOAuth()` | LOW |
| GET | `/login` | Serve login page | MEDIUM |

**Dependencies:**
- `authenticateToken()` middleware
- `validateCSRF()` middleware
- Discord OAuth config
- JWT handling
- Session management

**Methods to Extract:**
- `handleLogin()`
- `handleDiscordAuth()`
- `handleDiscordCallback()`
- `handleLogout()`
- `authenticateToken()` (move to middleware)
- `authenticateTokenHTML()` (move to middleware)
- `debugOAuth()`

---

## ROUTER 2: BILLING ROUTES → `src/dashboard/routes/billing.js`

**Purpose:** Stripe integration, payment processing, billing status

| Method | Route | Handler | Priority |
|--------|-------|---------|----------|
| POST | `/webhooks/stripe` | `handleStripeWebhook()` | HIGH |
| POST | `/api/stripe/create-checkout-session` | Stripe session creation | HIGH |
| GET | `/api/stripe/session/:sessionId` | Get session status | HIGH |
| POST | `/billing/portal` | `handleBillingPortal()` | MEDIUM |
| GET | `/billing/status/:guildId` | `getBillingStatus()` | MEDIUM |
| GET | `/billing/success` | `renderBillingSuccess()` | MEDIUM |
| GET | `/billing/cancel` | `renderBillingCancel()` | MEDIUM |
| GET | `/payment` | Serve payment page | MEDIUM |
| GET | `/payment-success.html` | Serve success page | LOW |
| GET | `/payment-failed.html` | Serve failure page | LOW |
| GET | `/api/paypal/client-id` | PayPal config | MEDIUM |
| POST | `/api/paypal/create-order` | Create PayPal order | MEDIUM |
| POST | `/api/paypal/capture/:orderID` | Capture PayPal payment | MEDIUM |
| GET | `/api/subscription` | Get subscription info | MEDIUM |

**Dependencies:**
- Stripe integration
- PayPal integration
- `authenticateToken()` middleware
- `validateCSRF()` middleware

**Methods to Extract:**
- `handleStripeWebhook()`
- `handleBillingPortal()`
- `getBillingStatus()`
- `renderBillingSuccess()`
- `renderBillingCancel()`
- Stripe-related methods
- PayPal-related methods

---

## ROUTER 3: LOGS/INCIDENTS ROUTES → `src/dashboard/routes/logs.js`

**Purpose:** Event logging, incident tracking, forensics, security logs

| Method | Route | Handler | Priority |
|--------|-------|---------|----------|
| GET | `/api/logs/:guildId` | Retrieve guild logs | HIGH |
| POST | `/api/logs/:guildId/clear` | Clear logs | HIGH |
| GET | `/dashboard/logs` | Serve logs page | HIGH |
| GET | `/api/console/messages` | `getConsoleMessages()` | MEDIUM |
| GET | `/api/security/logs` | `getSecurityLogs()` | HIGH |
| GET | `/api/security/actions` | `getModerationActions()` | HIGH |
| GET | `/api/security/recent` | `getRecentSecurityEvents()` | MEDIUM |
| GET | `/api/security/stats` | `getSecurityStats()` | MEDIUM |
| GET | `/api/security-stats` | Alias for above | MEDIUM |
| GET | `/api/actions` | Alias for moderation actions | MEDIUM |
| GET | `/api/security/events` | `getSecurityEvents()` | MEDIUM |
| GET | `/api/lockdown/status` | `getLockdownStatus()` | MEDIUM |
| GET | `/api/lockdown/history` | `getLockdownHistory()` | MEDIUM |
| POST | `/api/ai/scan` | AI security scan | MEDIUM |

**Dependencies:**
- Logger/AuditLogger
- ForensicsManager
- `authenticateToken()` middleware
- `authenticateTokenHTML()` middleware

**Methods to Extract:**
- `getConsoleMessages()`
- `getSecurityLogs()`
- `getModerationActions()`
- `getRecentSecurityEvents()`
- `getSecurityStats()`
- `getSecurityEvents()`
- `getLockdownStatus()`
- `getLockdownHistory()`

---

## ROUTER 4: SETTINGS/CONFIG ROUTES → `src/dashboard/routes/settings.js`

**Purpose:** Guild settings, configuration, customization

| Method | Route | Handler | Priority |
|--------|-------|---------|----------|
| POST | `/api/update-advanced-settings` | `updateAdvancedSettings()` | HIGH |
| POST | `/api/customization/save` | Save guild customization | MEDIUM |
| GET | `/api/customization/load` | Load guild customization | MEDIUM |
| GET | `/api/server/info` | `getServerInfo()` | MEDIUM |
| GET | `/api/server-info` | Alias for above | MEDIUM |
| GET | `/api/tickets/stats` | `getTicketStats()` | MEDIUM |
| POST | `/api/levels/reset` | Reset guild levels | LOW |
| GET | `/api/levels/leaderboard` | Get levels leaderboard | LOW |
| POST | `/api/activate-code` | Activate access code | MEDIUM |
| POST | `/api/snapshots/create` | Create server snapshot | LOW |
| POST | `/api/rollback/execute` | Execute rollback | LOW |
| POST | `/api/verification/approve` | Approve verification | LOW |
| POST | `/api/verification/deny` | Deny verification | LOW |
| POST | `/api/alerts/notify` | Send alerts | LOW |

**Dependencies:**
- SettingsManager
- Database queries
- `authenticateToken()` middleware
- `validateCSRF()` middleware

**Methods to Extract:**
- `updateAdvancedSettings()`
- `getServerInfo()`
- `getTicketStats()`
- Customization save/load logic

---

## ROUTER 5: ANALYTICS ROUTES → `src/dashboard/routes/analytics.js`

**Purpose:** Analytics, reporting, statistics, analytics drilldown

| Method | Route | Handler | Priority |
|--------|-------|---------|----------|
| GET | `/api/status` | `getPublicStatus()` | HIGH |
| GET | `/api/analytics/overview` | `getAnalyticsOverview()` | HIGH |
| GET | `/api/overview-stats` | `getOverviewStats()` | HIGH |
| GET | `/api/analytics/report` | `getAnalyticsReport()` | MEDIUM |
| GET | `/api/analytics/full` | `getFullAnalytics()` | MEDIUM |
| GET | `/api/analytics/live` | `getLiveAnalytics()` | MEDIUM |
| GET | `/api/analytics/drilldown` | Analytics drilldown | LOW |
| GET | `/api/analytics/export` | Export analytics | LOW |
| GET | `/analytics` | Serve analytics page | MEDIUM |

**Dependencies:**
- AnalyticsManager
- Logger/AuditLogger for queries
- `authenticateTokenHTML()` middleware

**Methods to Extract:**
- `getPublicStatus()`
- `getAnalyticsOverview()`
- `getOverviewStats()`
- `getAnalyticsReport()`
- `getFullAnalytics()`
- `getLiveAnalytics()`

---

## ROUTER 6: STATIC/PAGE ROUTES → `src/dashboard/routes/static.js`

**Purpose:** HTML pages, setup wizards, health checks, metadata

| Method | Route | Handler | Priority |
|--------|-------|---------|----------|
| GET | `/` | Landing page | MEDIUM |
| GET | `/landing` | Landing page | MEDIUM |
| GET | `/dashboard` | Main dashboard | HIGH |
| GET | `/dashboard/console` | Console page | MEDIUM |
| GET | `/tickets` | Tickets page | MEDIUM |
| GET | `/help` | Help page | MEDIUM |
| GET | `/commands` | Commands reference | MEDIUM |
| GET | `/command-permissions` | Command permissions | MEDIUM |
| GET | `/admin` | Admin panel | MEDIUM |
| GET | `/setup/security` | Security setup wizard | HIGH |
| GET | `/setup/tickets` | Tickets setup wizard | HIGH |
| GET | `/setup/moderation` | Moderation setup wizard | HIGH |
| GET | `/setup/ai` | AI setup wizard | MEDIUM |
| GET | `/setup/antinuke` | Anti-nuke setup wizard | MEDIUM |
| GET | `/setup/welcome` | Welcome setup wizard | MEDIUM |
| GET | `/setup/goodbye` | Goodbye setup wizard | MEDIUM |
| GET | `/setup/anti-raid` | Anti-raid setup wizard | MEDIUM |
| GET | `/setup/anti-spam` | Anti-spam setup wizard | MEDIUM |
| GET | `/setup/anti-phishing` | Anti-phishing setup wizard | MEDIUM |
| GET | `/setup/verification` | Verification setup wizard | MEDIUM |
| GET | `/setup/autorole` | Auto-role setup wizard | MEDIUM |
| GET | `/access-code` | Access code page | MEDIUM |
| GET | `/access` | Access page | MEDIUM |
| GET | `/access-generator` | Access generator page | MEDIUM |
| GET | `/access-share` | Access share page | MEDIUM |
| GET | `/health` | Health check | MEDIUM |
| GET | `/api/health` | API health check | MEDIUM |
| GET | `/api/bot/health` | Bot health check | MEDIUM |
| GET | `/invite` | Invite bot link | LOW |
| GET | `/favicon.ico` | Favicon | LOW |
| GET | `/version.json` | Version info | MEDIUM |
| GET | `/api/me` | Current user info | MEDIUM |
| GET | `/api/ws-token` | WebSocket token | MEDIUM |

**Note:** Many of these routes just serve static HTML files. Consolidate into single handler if possible.

**Methods to Extract:**
- None specific - mostly static file serving and simple redirects
- Consolidate HTML serving into single `serveHTMLPage()` method

---

## ROUTER 7: DEBUG ROUTES (OPTIONAL) → `src/dashboard/routes/debug.js`

**Purpose:** Debugging endpoints (development only)

| Method | Route | Handler | Priority |
|--------|-------|---------|----------|
| GET | `/api/debug/database` | `debugDatabase()` | LOW |
| GET | `/api/debug/guild/:guildId` | `debugGuild()` | LOW |
| GET | `/api/debug/tables` | `debugTables()` | LOW |
| GET | `/debug-config/:guildId` | Debug config | LOW |
| GET | `/api/tickets/transcripts` | Ticket transcripts | LOW |
| POST | `/api/tickets/ratings` | Ticket ratings | LOW |

**Note:** These should only be available in development mode. Could be optional router.

---

## MIDDLEWARE EXTRACTION

Move these to `src/dashboard/middleware/` folder:

### `authentication.js`
```javascript
// authenticateToken(req, res, next)
// authenticateTokenHTML(req, res, next)
// Extracted from dashboard.js
```

### `validation.js`
```javascript
// validateCSRF(req, res, next)
// Extracted from security-utils.js or dashboard.js
```

### `errorHandler.js`
```javascript
// Global error handler middleware
// Wrap all routes with try/catch if needed
```

### `rateLimit.js`
```javascript
// Rate limiting per endpoint
// Already partially implemented
```

---

## REFACTORED DASHBOARD STRUCTURE

```javascript
// src/dashboard/dashboard.js (refactored, ~250 lines)
class SecurityDashboard {
    constructor(bot) {
        this.bot = bot;
        this.app = express();
        this.wss = null;
        this.server = null;
    }

    setupMiddleware() {
        // Helmet, CORS, CSP, cache headers, etc.
        // This stays in main file or moves to middleware/setup.js
    }

    setupRoutes() {
        // Register all routers
        this.app.use('/auth', require('./routes/auth')(this.bot));
        this.app.use('/api/stripe', require('./routes/billing')(this.bot));
        this.app.use('/api/logs', require('./routes/logs')(this.bot));
        this.app.use('/api/settings', require('./routes/settings')(this.bot));
        this.app.use('/api/analytics', require('./routes/analytics')(this.bot));
        this.app.use('/', require('./routes/static')(this.bot));
        
        // Debug router (development only)
        if (process.env.NODE_ENV !== 'production') {
            this.app.use('/debug', require('./routes/debug')(this.bot));
        }
    }

    async start(port) { /* ... */ }
    async stop() { /* ... */ }
}
```

---

## ESTIMATED LINE COUNTS (AFTER DECOMPOSITION)

| File | Current | Target | Reduction |
|------|---------|--------|-----------|
| dashboard.js | 12,792 | ~250 | 98% ↓ |
| routes/auth.js | - | ~400 | - |
| routes/billing.js | - | ~300 | - |
| routes/logs.js | - | ~350 | - |
| routes/settings.js | - | ~300 | - |
| routes/analytics.js | - | ~250 | - |
| routes/static.js | - | ~400 | - |
| routes/debug.js | - | ~100 | - |
| middleware/auth.js | - | ~150 | - |
| **TOTAL** | 12,792 | ~2,500 | 80% ↓ |

---

## EXTRACTION ORDER (RECOMMENDED)

1. **Create middleware structure** first
   - Extract `authenticateToken()`, `authenticateTokenHTML()`
   - Extract `validateCSRF()` to middleware
   - Create error handler middleware

2. **Extract auth router** (simplest)
   - All OAuth login/logout logic
   - Minimal dependencies
   - Self-contained

3. **Extract static router** (straightforward)
   - Page serving mostly static
   - Simple redirects
   - No complex logic

4. **Extract logs router** (moderate complexity)
   - Depends on Logger/AuditLogger
   - Multiple related endpoints
   - Heavy queries

5. **Extract settings router** (moderate complexity)
   - Guild configuration endpoints
   - Depends on database
   - Multiple save/load endpoints

6. **Extract analytics router** (moderate complexity)
   - Statistics and reporting
   - Depends on AnalyticsManager
   - Multiple data sources

7. **Extract billing router** (most complex)
   - Stripe webhook handling
   - PayPal integration
   - Requires raw body parsing

8. **Extract debug router** (optional, lowest priority)
   - Development-only endpoints
   - Can be added last or skipped initially

---

## TESTING CHECKLIST

After extracting each router, verify:

- [ ] All routes in router are accessible
- [ ] All middleware applied correctly
- [ ] Authentication required for protected routes
- [ ] CSRF validation works
- [ ] Error handling works
- [ ] No duplicate route definitions
- [ ] Logs show no router errors
- [ ] Database queries still work
- [ ] WebSocket connections still work
- [ ] External APIs (Stripe, PayPal) still functional

---

## NOTES FOR IMPLEMENTATION

1. **Keep route logic identical** - This is copy-paste extraction, not refactoring
2. **Test each router in isolation** - Start server with partial routers during development
3. **Use Router.get/post/etc** - Export Express Router, not handler functions
4. **Share middleware** - Import shared middleware from middleware/ folder
5. **Preserve error handling** - Each router should handle its own errors
6. **Maintain bot reference** - Pass bot instance to each router for database access
7. **Keep WebSocket setup** - Leave in main dashboard.js, not routers
8. **Backup original** - Keep backup of original dashboard.js during extraction

---

**Document Version:** 1.0  
**Status:** Ready for Extraction Phase  
**Expected Time:** 6-8 hours total

