# DarkLock — Enterprise Discord Security Bot & Platform

> A comprehensive Discord security, moderation, and management platform featuring a multi-service Node.js architecture with a web dashboard, public platform portal, XP leaderboard system, desktop companion app, and hardware-level monitoring.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Service Map](#service-map)
- [1. Discord Bot Core (src/bot.js)](#1-discord-bot-core-srcbotjs)
  - [Initialization Pipeline](#initialization-pipeline)
  - [Security Modules (14)](#security-modules-14)
  - [Utility Modules (12+)](#utility-modules-12)
  - [Event Handlers (15)](#event-handlers-15)
  - [Slash Commands (50+)](#slash-commands-50)
  - [XP & Leveling System](#xp--leveling-system)
  - [Tier / Subscription Gating](#tier--subscription-gating)
- [2. Bot Dashboard (src/dashboard/dashboard.js)](#2-bot-dashboard-srcdashboarddashboardjs)
  - [Authentication Flow](#authentication-flow)
  - [Access Control System](#access-control-system)
  - [API Endpoints](#api-endpoints)
  - [WebSocket System](#websocket-system)
  - [Dashboard Views](#dashboard-views)
- [3. XP Leaderboard Server (src/web/server.js)](#3-xp-leaderboard-server-srcwebserverjs)
- [4. Darklock Platform (darklock/)](#4-darklock-platform-darklock)
  - [Platform Authentication](#platform-authentication)
  - [Admin System](#admin-system)
  - [Platform Routes](#platform-routes)
  - [RBAC & Team Management](#rbac--team-management)
  - [Premium / Stripe Integration](#premium--stripe-integration)
- [5. Desktop Apps](#5-desktop-apps)
  - [DarkLock Guard (guard-v2/)](#darklock-guard-guard-v2)
  - [Secure Channel (secure-channel/)](#secure-channel-secure-channel)
- [6. File Protection System (file-protection/)](#6-file-protection-system-file-protection)
- [7. Hardware Integration](#7-hardware-integration)
- [8. Database Architecture](#8-database-architecture)
  - [Database Files](#database-files)
  - [Table Catalog (90+ tables)](#table-catalog-90-tables)
  - [Migration Systems](#migration-systems)
- [9. Services & Middleware Layer](#9-services--middleware-layer)
- [10. Deployment & Infrastructure](#10-deployment--infrastructure)
  - [Startup Flow](#startup-flow)
  - [Docker](#docker)
  - [Cloudflare Tunnel](#cloudflare-tunnel)
  - [Environment Variables](#environment-variables)
- [11. Security Audit Findings](#11-security-audit-findings)
- [12. File Structure Reference](#12-file-structure-reference)

---

## Architecture Overview

DarkLock is a **multi-service monolith** running inside a single Node.js process. Three HTTP servers bind to different ports, sharing the same Discord client and database connections:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Node.js Process (bot.js)                    │
│                                                                 │
│  ┌─────────────────┐  ┌───────────────┐  ┌──────────────────┐  │
│  │  Bot Dashboard   │  │  XP Leaderboard│  │ Discord Client   │  │
│  │  Express :3001   │  │  Express :3007 │  │ discord.js v14   │  │
│  │  (dashboard.js)  │  │  (server.js)   │  │  Gateway + REST  │  │
│  └────────┬─────────┘  └───────┬────────┘  └────────┬─────────┘  │
│           │                    │                     │           │
│  ┌────────┴────────────────────┴─────────────────────┴────────┐ │
│  │                    Shared SQLite Layer                      │ │
│  │   security_bot.db (main)  │  xp.db (XP)                   │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              Darklock Platform (separate process)                │
│              Express :3002 (darklock/start.js)                  │
│              darklock.db (users, admins, sessions)              │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐    ┌──────────────────┐
│  Cloudflare      │    │  Cloudflare      │
│  Tunnel          │    │  Tunnel          │
│  admin.darklock  │───▶│  :3001           │
│  .net            │    │  Bot Dashboard   │
└──────────────────┘    └──────────────────┘

┌──────────────────┐    ┌──────────────────┐
│  platform.       │    │  :3002           │
│  darklock.net    │───▶│  Darklock        │
│                  │    │  Platform        │
└──────────────────┘    └──────────────────┘
```

---

## Service Map

| Service | Port | Domain | Entry Point | Purpose |
|---------|------|--------|-------------|---------|
| **Discord Bot** | — | — | `src/bot.js` | Discord gateway client, slash commands, event handling |
| **Bot Dashboard** | 3001 | `admin.darklock.net` | `src/dashboard/dashboard.js` | Guild management web UI, API, WebSocket |
| **XP Leaderboard** | 3007 | Proxied via dashboard | `src/web/server.js` | Public leaderboard pages and API |
| **Darklock Platform** | 3002 | `platform.darklock.net` | `darklock/start.js` | User portal, admin panel, downloads, billing |
| **Guard Desktop** | — | — | `guard-v2/desktop/` | Tauri desktop companion app |
| **Secure Channel** | — | — | `secure-channel/` | Encrypted communication desktop app |

---

## 1. Discord Bot Core (src/bot.js)

The **SecurityBot** class (~3,800 lines) is the central orchestrator. It initializes all modules, loads commands, wires event handlers, and manages the bot lifecycle.

### Initialization Pipeline

```
1.  Environment validation (EnvValidator)
2.  Tamper protection (TamperProtectionSystem)
3.  Database initialization → WAL mode, 90+ tables, 3 migration systems
4.  Logger (Winston-based)
5.  ConfigManager / ConfigService
6.  Security modules (14 systems)
7.  Utility modules (12+ managers)
8.  XP / Rank system
9.  Enterprise services (SecurityMiddleware, ModerationQueue, VerificationService)
10. Dashboard HTTP server (:3001)
11. XP Leaderboard HTTP server (:3007)
12. Console interception (broadcast to WebSocket)
13. Event handler registration (15 Discord events)
14. Slash command registration (50+ commands)
15. Discord gateway login
```

### Security Modules (14)

| Module | File | Purpose |
|--------|------|---------|
| **AntiRaid** | `src/security/antiraid.js` | Mass-join detection (10/60s threshold), pattern analysis, auto-lockdown, quarantine |
| **AntiSpam** | `src/security/antispam.js` | 7-type spam detection (flood, duplicate, mention, emoji, link, caps, cross-channel), escalating punishments |
| **AntiNuke** | `src/security/antinuke.js` | Rate-limited channel/role create/delete detection, snapshot restore, auto-ban |
| **AntiNukeManager** | `src/security/AntiNukeManager.js` | Higher-level nuke orchestration with permission monitoring |
| **AntiPhishing** | `src/security/antiphishing.js` | Domain similarity scoring, known-bad domain list |
| **LinkAnalyzer** | `src/security/LinkAnalyzer.js` | URL analysis, redirect following, VirusTotal integration |
| **UserVerification** | `src/security/userverification.js` | Account age checks, emoji/button/web captcha challenges |
| **VerificationSystem** | `src/security/VerificationSystem.js` | 4-type challenge system (button, emoji-reaction, emoji-sequence, web-captcha) |
| **ToxicityFilter** | `src/security/toxicity.js` | AI-powered content toxicity scoring |
| **BehaviorDetection** | `src/security/behavior.js` | User behavior pattern analysis and risk scoring |
| **WordFilterEngine** | `src/security/WordFilterEngine.js` | Custom word/phrase blocking with regex and wildcard support |
| **RoleAuditing** | `src/security/roleaudit.js` | Monitors dangerous role permission changes |
| **ChannelProtection** | `src/security/channelprotection.js` | Channel creation/deletion rate monitoring |
| **AuditWatcher** | `src/security/auditWatcher.js` | Discord audit log monitoring for suspicious actions |

### Utility Modules (12+)

| Module | File | Purpose |
|--------|------|---------|
| **BackupManager** | `src/utils/backup.js` | Auto/manual server structure backups every 24h |
| **SecurityDashboard** | `src/dashboard/dashboard.js` | Web dashboard server |
| **TicketManager** | `src/utils/TicketSystem.js` | Support ticket system with transcripts |
| **EnhancedTicketManager** | `src/utils/EnhancedTicketManager.js` | Advanced tickets with categories, claiming, priorities |
| **DMTicketManager** | `src/utils/DMTicketManager.js` | Ticket creation via DM |
| **HelpTicketSystem** | `src/utils/HelpTicketSystem.js` | Help desk ticket integration |
| **SecurityManager** | `src/utils/SecurityManager.js` | Legacy security layer, phishing detection, whitelist management |
| **AnalyticsManager** | `src/utils/AnalyticsManager.js` | Full analytics: messages, commands, joins, voice, bot metrics |
| **SettingsManager** | `src/utils/SettingsManager.js` | Guild settings management |
| **PermissionManager** | `src/utils/PermissionManager.js` | Custom role-based command permissions |
| **ForensicsManager** | `src/utils/ForensicsManager.js` | Forensic audit trail for all security events |
| **LockdownManager** | `src/utils/LockdownManager.js` | Server lockdown orchestration |
| **AppealSystem** | `src/systems/appealsystem.js` | Ban/mute appeal workflow |
| **RankCardGenerator** | `src/utils/RankCardGenerator.js` | Canvas-based rank card image generation |

### Event Handlers (15)

| Event | File | Key Responsibilities |
|-------|------|---------------------|
| `ready` | `src/events/ready.js` | Module init per guild, cron jobs (cleanup, analytics, presence rotation, backup, temp action expiry) |
| `messageCreate` | `src/events/messageCreate.js` | Pipeline: DM routing → logging → anti-spam → word filter → anti-phishing → automod → link analysis → toxicity → behavior analysis → XP |
| `interactionCreate` | `src/events/interactionHandler.js` | Button/modal/select router for verification, self-roles, channel access |
| `guildMemberAdd` | `src/events/guildMemberAdd.js` | Welcome messages, verification flow, autorole assignment |
| `guildMemberAdd` (verification) | `src/events/guildMemberAdd-verification.js` | Detailed verification: unverified role → DM challenge → staff log → auto-kick timer (5min) |
| `guildMemberRemove` | `src/events/guildMemberRemove.js` | Leave analytics, goodbye messages |
| `messageReactionAdd` | `src/events/messageReactionAdd.js` | Emoji verification + reaction role handling |
| `messageReactionRemove` | `src/events/messageReactionRemove.js` | Reaction role removal |
| `reactionRoleButtons` | `src/events/reactionRoleButtons.js` | Button-based reaction role toggle |
| `guildCreate` | `src/events/guildCreate.js` | Initialize guild config, send owner setup DM |
| `channelAccessHandler` | `src/events/channelAccessHandler.js` | Channel access panel dropdown menus |
| `messageUpdate` | `src/events/messageUpdate.js` | Edit logging, re-scan edited content |

### Slash Commands (50+)

#### Admin Commands (`src/commands/admin/`)

| Command | File | Purpose |
|---------|------|---------|
| `/admin` | `admin.js` | Admin utilities |
| `/autorole` | `autorole.js` | Auto-assign roles on join |
| `/botctl` | `botctl.js` | Bot control panel |
| `/channelaccess` | `channelaccess.js` | Channel access panels |
| `/console` | `console.js` | Bot console in Discord |
| `/language` | `language.js` | Server language setting |
| `/onboarding` | `onboarding.js` | Member onboarding flow |
| `/permissions` | `permissions.js` | Command permission management |
| `/reactionrole` | `reactionrole.js` | Reaction/button role panels |
| `/server` | `server.js` | Server management |
| `/serverbackup` | `serverbackup.js` | Server backup/restore |
| `/serversetup` | `serversetup.js` | Initial server configuration |
| `/settings` | `settings.js` | Bot settings management |
| `/setup` | `setup.js` | Unified setup hub (welcome, goodbye, onboarding, roles, permissions, language) |
| `/voicemonitor` | `voicemonitor.js` | Voice channel monitoring |
| `/wizard` | `wizard.js` | Interactive setup wizard |
| `/xp` | `xp.js` | XP system admin (set/add/remove/reset/levelrole/enable/disable) |

#### Security Commands (`src/commands/security/`)

| Command | File | Purpose |
|---------|------|---------|
| `/altdetect` | `altdetect.js` | Alt account detection |
| `/anti-links` | `anti-links.js` | Link filtering config |
| `/anti-phishing` | `anti-phishing.js` | Phishing detection config |
| `/anti-raid` | `anti-raid.js` | Raid protection config |
| `/anti-spam` | `anti-spam.js` | Spam protection config (7 detection types) |
| `/antinuke` | `antinuke.js` | Anti-nuke protection (enable/disable/quarantine/whitelist/restore/incidents) |
| `/automod` | `automod.js` | AutoMod configuration |
| `/emojispam` | `emojispam.js` | Emoji spam config |
| `/lockdown` | `lockdown.js` | Emergency server lockdown |
| `/rolescan` | `rolescan.js` | Dangerous permission scanner |
| `/security` | `security.js` | Security overview |
| `/status` | `status.js` | Security status report |
| `/unlockdown` | `unlockdown.js` | Remove lockdown |
| `/verification` | `verification.js` | Verification setup (button/captcha/reaction/web/auto) |
| `/webhookprotect` | `webhookprotect.js` | Webhook protection config |
| `/wordfilter` | `wordfilter.js` | Custom word filter rules |

#### Moderation Commands (`src/commands/moderation/`)

| Command | File | Purpose |
|---------|------|---------|
| `/ban` | `ban.js` | Ban with 7-layer logging |
| `/kick` | `kick.js` | Kick member |
| `/warn` | `warn.js` | Warning system |
| `/timeout` | `timeout.js` | Timeout/mute |
| `/purge` | `purge.js` | Bulk message deletion |
| `/quarantine` | `quarantine.js` | Quarantine suspicious users |
| `/strike` | `strike.js` | Strike system |
| `/cases` | `cases.js` | Moderation case history |
| `/modnote` | `modnote.js` | Moderator notes |
| `/appeal` | `appeal.js` | Appeal management |
| `/lock` / `/unlock` | `lock.js` / `unlock.js` | Channel lock/unlock |
| `/slowmode` | `slowmode.js` | Channel slowmode |
| `/redact` | `redact.js` | Message content redaction |

#### Utility Commands (`src/commands/utility/`)

| Command | File | Purpose |
|---------|------|---------|
| `/leaderboard` | `leaderboard.js` | XP leaderboard (daily/weekly/monthly/overall) |
| `/rank` | `rank.js` | Visual rank card (Canvas-generated PNG) |
| `/analytics` | `analytics.js` | Server analytics report |
| `/help` | `help.js` | Help pages |
| `/modmail` | `modmail.js` | Modmail system |
| `/ticket` | `ticket.js` | Ticket management |
| `/poll` | `poll.js` | Poll creation |
| `/invite` | `invites.js` | Invite tracking |
| `/selfrole` | `selfrole.js` | Self-assignable role config |
| `/welcome` / `/goodbye` | `welcome.js` / `goodbye.js` | Welcome/goodbye message config |
| `/announce` | `announce.js` | Announcement creation |
| `/embed` | `embed.js` | Custom embed builder |
| `/schedule` | `schedule.js` | Scheduled actions |
| `/serverinfo` | `serverinfo.js` | Server information |
| `/userinfo` | `userinfo.js` | User information |
| `/trustscore` | `trustscore.js` | User trust score |
| `/auditlog` | `auditlog.js` | Audit log viewer |
| `/ping` | `ping.js` | Bot latency |

### XP & Leveling System

The XP system runs across two subsystems:

| Component | File | Storage | Purpose |
|-----------|------|---------|---------|
| **XPDatabase** | `src/db/xpDatabase.js` | `xp.db` (SQLite, WAL mode) | XP CRUD, leaderboards, guild settings, level roles |
| **RankSystem** | `src/utils/RankSystem.js` | `data/ranks.json` (file) | Legacy XP with streaks, weekly/monthly boards, boost events |
| **WebDashboard** | `src/web/server.js` | Reads from `xp.db` | Public leaderboard HTML/API |
| **RankCardRenderer** | `src/utils/rankCardRenderer.js` | — | Canvas PNG generation for `/rank` command |

**Level Formula:** `level = floor(0.1 × √xp)`

**XP Grant Flow:**
1. Message received → cooldown check (60s per user-guild) → duplicate detection
2. Base XP: 15–25 random → streak multiplier → active boost multiplier → DB event multipliers
3. Level-up check → role reward assignment → leaderboard position update

### Tier / Subscription Gating

Three tiers enforce feature access at both write-time and read-time:

| Tier | Price | Features |
|------|-------|----------|
| **Free** | $0 | Core security, basic moderation, limited analytics |
| **Pro** | $9.99/mo | AI toxicity, advanced analytics, API access, behavior analysis, push notifications |
| **Enterprise** | $29.99/mo | Whitelabel, custom integrations, SLA |

**Enforcement:**
- `TierEnforcement.enforceTierLimits()` — blocks writes of premium features for free tier
- `TierEnforcement.applyTierMask()` — runtime config masking forces premium features off
- `requirePremium()` — Express middleware for dashboard routes
- `bot.getGuildPlan()` / `bot.hasProFeatures()` / `bot.hasEnterpriseFeatures()` — runtime checks
- Stripe webhook handles `checkout.session.completed` and `customer.subscription.deleted`

---

## 2. Bot Dashboard (src/dashboard/dashboard.js)

The main web dashboard at **port 3001** (~14,000 lines). Serves the guild management UI, all administrative APIs, and real-time WebSocket updates.

### Authentication Flow

```
┌────────────┐   GET /auth/discord   ┌──────────────┐
│   Browser   │ ────────────────────▶ │ Generate JWT  │
│             │                      │ signed state   │
│             │   302 → Discord OAuth│ (nonce, IP,    │
│             │ ◀──────────────────── │  UA, 10m exp) │
└──────┬──────┘                      └───────────────┘
       │
       │  User authorizes on Discord
       │
┌──────┴──────┐   GET /auth/discord/callback
│   Browser   │ ────────────────────────────────────▶ ┌─────────────────┐
│             │                                       │ Validate state   │
│             │                                       │ Exchange code    │
│             │                                       │ Fetch user+guilds│
│             │                                       │ Check admin perms│
│             │   Set-Cookie: dashboardToken (24h)    │ Create JWT       │
│             │ ◀──────────────────────────────────── │ (HttpOnly,Secure)│
└─────────────┘                                       └─────────────────┘
```

**Two auth methods:**
1. **Discord OAuth2** — Primary. JWT payload includes `userId`, `username`, `avatar`, `role`, `hasAccess`, `accessGuild`, `plan`, `isPremium`. Discord access token kept server-side in memory cache (not in JWT).
2. **Admin username/password** — Fallback. Validates against `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars. Supports bcrypt hashed or plaintext passwords.

**Token verification** (`authenticateToken`):
- Checks `dashboardToken` cookie → then `Authorization: Bearer` header
- **Skip list:** Routes starting with `/v3/`, `/admin/`, `/rfid/`, `/v4/admin/` bypass JWT auth entirely
- JWT verified against `JWT_SECRET`

### Access Control System

`checkGuildAccess(userId, guildId)` — Four-tier authorization cascade:

| Priority | Check | Source |
|----------|-------|--------|
| 1 | **Server owner** | `guild.ownerId === userId` |
| 2 | **Explicit DB grant** | `dashboard_access` table (user→guild) |
| 3 | **Discord permissions** | `Administrator` or `ManageGuild` on the guild |
| 4 | **Role-based grant** | `dashboard_role_access` table (role→guild, matched against user's current Discord roles) |

**Access sharing** (`/access-share` page):
- Guild owners/admins can grant dashboard access to specific users or Discord roles
- Role-based access is dynamic — checked live against current Discord roles
- Revocation removes both explicit grants and stale role-based entries

### API Endpoints

#### Public (No Auth)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Redirect to `/site/` |
| GET | `/landing` | Landing page |
| GET | `/health` | Health check |
| GET | `/invite` | Bot invite redirect |
| GET | `/login`, `/signin` | Login pages |
| GET | `/verify/:token` | Web verification page |
| GET | `/leaderboard/:guildId` | Public leaderboard (proxied to :3007) |
| GET | `/site/*` | 13 static site pages (features, pricing, documentation, etc.) |
| GET | `/commands` | Command documentation |
| GET | `/version.json` | Version info |
| GET | `/api/current-theme` | Theme colors |
| GET | `/api/csrf-token` | CSRF token |
| POST | `/api/bug-report` | Bug report submission |
| POST | `/api/web-verify/*` | Web verification flow |
| POST | `/webhooks/stripe` | Stripe webhook (signature verified) |

#### Authenticated — Settings

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/settings/security` | Security settings |
| GET/POST | `/api/settings/antiphishing` | Anti-phishing config |
| GET/POST | `/api/settings/antinuke` | Anti-nuke config |
| GET/POST | `/api/settings/notifications` | Notification settings |
| GET/POST | `/api/settings/tickets` | Ticket settings |
| GET/POST | `/api/settings/moderation` | Moderation settings |
| GET/POST | `/api/settings/features` | Feature toggles |
| GET/POST | `/api/settings/ai` | AI settings (premium) |
| GET/POST | `/api/settings/theme` | Theme customization |
| GET/POST | `/api/settings/xp` | XP system settings |
| GET/POST | `/api/settings/welcome` | Welcome message config |
| GET/POST | `/api/settings/goodbye` | Goodbye message config |
| GET/POST | `/api/settings/autorole` | Autorole config |
| GET/POST | `/api/settings/verification` | Verification config |
| POST | `/api/settings/update` | Onboarding settings |
| POST | `/api/settings/reset` | Reset all settings |
| POST | `/api/security-settings` | Direct security settings update |
| POST | `/api/advanced-settings` | Advanced settings |
| POST | `/api/bot-settings` | Bot settings |
| POST | `/api/api-keys` | API key management |

#### Authenticated — Guild Management

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/servers` | List accessible guilds |
| GET | `/api/guilds/:guildId/settings` | Guild settings |
| PATCH | `/api/guilds/:guildId/settings` | Update guild settings |
| GET | `/api/guilds/:guildId/commands` | Command list for guild |
| GET/POST | `/api/guilds/:guildId/permissions` | Command permissions |
| GET | `/api/guild/:guildId/channels` | Channel list |
| GET | `/api/guild/:guildId/roles` | Role list |
| GET | `/api/guilds/:guildId/tickets` | Ticket list |

#### Authenticated — Security Operations

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/dashboard` | Full dashboard data |
| GET | `/api/security-status` | Security status |
| GET | `/api/analytics` | Analytics data |
| GET | `/api/logs/:guildId` | Bot console logs |
| POST | `/api/logs/:guildId/clear` | Clear console logs |
| POST | `/api/lockdown` | Server lockdown toggle |
| POST | `/api/emergency` | Emergency mode toggle |
| DELETE | `/api/raid-flags` | Clear raid detection flags |
| POST | `/api/threats/:id/resolve` | Resolve security threat |

#### Authenticated — Moderation

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/moderation/actions` | Moderation action history |
| GET | `/api/moderation/stats` | Moderation statistics |
| POST | `/api/moderation/actions/:id/undo` | Undo moderation action |

#### Authenticated — Tickets

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/tickets` | List tickets |
| GET | `/api/tickets/:id` | Ticket details |
| POST | `/api/tickets/:id/close` | Close ticket |
| GET | `/api/tickets/:id/transcript` | Download transcript |
| GET | `/api/help-tickets` | Help desk tickets |

#### Authenticated — Access Sharing

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/dashboard/:guildId/shared-access` | List shared access |
| POST | `/api/dashboard/:guildId/shared-access/grant-user` | Grant user access |
| POST | `/api/dashboard/:guildId/shared-access/grant-role` | Grant role access |
| POST | `/api/dashboard/:guildId/shared-access/revoke-user` | Revoke user access |
| POST | `/api/dashboard/:guildId/shared-access/revoke-role` | Revoke role access |
| POST | `/api/access/redeem` | Redeem access code |
| POST | `/api/access/generate` | Generate access code |

#### Authenticated — Billing

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/stripe/create-checkout-session` | Create Stripe session |
| GET | `/api/stripe/session/:sessionId` | Session status |
| POST | `/billing/portal` | Stripe customer portal |
| GET | `/billing/status/:guildId` | Billing status |

#### Admin Debug

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/debug/database` | DB table info (admin only) |
| GET | `/api/debug/guild/:guildId` | Guild debug info |
| GET | `/api/debug/tables` | Table schemas |

### WebSocket System

- **Path:** `/ws`
- **Auth:** JWT or `INTERNAL_API_KEY` required (unauthenticated connections immediately closed with 4401)
- **Guild scoping:** Dashboard clients can only subscribe to their `accessGuild` — cross-guild subscription blocked
- **Server connections:** `INTERNAL_API_KEY` connections can subscribe to any guild
- **Heartbeat:** 30-second ping/pong interval
- **Broadcasts:** Console logs, security events, moderation actions, analytics updates, config changes

### Dashboard Views

| Page | Path | Auth | Premium |
|------|------|------|---------|
| Dashboard Home | `/dashboard` | No (client-side check) | No |
| Console | `/dashboard/console` | Yes | Yes |
| Analytics | `/analytics` | Yes | No |
| Tickets | `/tickets` | Yes | No |
| Logs | `/logs` | Yes | No |
| Access Generator | `/access-generator` | Yes | Yes |
| Access Share | `/access-share` | Yes | Yes |
| Help | `/help` | Yes | No |
| Status | `/status` | Yes | No |
| Updates | `/updates` | Yes | No |

**Setup Pages** (14 configuration panels):
`/setup/security`, `/setup/tickets`, `/setup/features`, `/setup/ai`, `/setup/welcome`, `/setup/anti-raid`, `/setup/anti-spam`, `/setup/moderation`, `/setup/antinuke`, `/setup/anti-phishing`, `/setup/verification`, `/setup/autorole`, `/setup/notifications`

---

## 3. XP Leaderboard Server (src/web/server.js)

A lightweight Express server on **port 3007** serving the public XP leaderboard.

**Routes:**
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check |
| GET | `/leaderboard/:guildId` | Server-rendered HTML leaderboard |
| GET | `/api/leaderboard/:guildId` | JSON API (enriched with Discord user data) |

**Architecture:**
- Runs in the same process as the bot — shares `xpDatabase` and Discord client
- No authentication (public pages intended)
- No rate limiting
- Open CORS

**HTML Generation:**
- Single function `generateLeaderboardHTML()` outputs full page with inline CSS/JS
- **Podium cards** (top 3): Glassmorphism design with glow auras, colored borders per rank, animated entrance
- **Row entries** (rank 4+): Horizontal rows with progress bars, staggered entrance animations
- **Stats summary**: Members ranked, top level, total XP
- **Dark theme**: `#06060e` background, Inter font, gradient mesh
- Responsive breakpoints at 520px and 580px

**Data Flow per Request:**
1. `getLeaderboard(guildId, 1000)` → SQLite query from `xp.db`
2. For each entry: `client.users.fetch(userId)` → Discord API (potentially 1000 parallel calls)
3. Build HTML string → serve response

---

## 4. Darklock Platform (darklock/)

The Darklock Platform is a full-featured web application serving as the **user portal, admin dashboard, and app distribution server**. It runs independently on **port 3002** with its own database (`darklock.db`).

### Platform Authentication

**Two separate auth systems:**

| System | Cookie | JWT Secret | TTL | Purpose |
|--------|--------|------------|-----|---------|
| **User auth** | `darklock_token` | `JWT_SECRET` | 7 days | Regular users |
| **Admin auth** | `admin_token` | `ADMIN_JWT_SECRET` | 1 hour | Admin panel |

**User features:** JTI-based session tracking, individual revocation, 2FA (TOTP via Speakeasy), password complexity validation (8+ chars with uppercase/lowercase/digit/special)

**Admin features:** Separate JWT secret, audit logging for all auth events, RFID card login support, timing-attack resistant bcrypt comparison

### Admin System

**Default accounts** (auto-created on first run):
- Primary admin: `admin@darklock.net`
- Backup admin: `security@darklock.net`

**RBAC hierarchy:**
| Role | Level | Capabilities |
|------|-------|-------------|
| Owner | 100 | Full control |
| Co-Owner | 90 | Most admin functions |
| Admin | 70 | Team management, settings |
| Moderator | 50 | Content management |
| Helper | 30 | Read-only access |

### Platform Routes

#### Public Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/platform` | Homepage with user state |
| GET | `/platform/download/darklock-guard` | Guard download page |
| GET | `/platform/download/secure-channel` | Secure Channel download page |
| GET | `/platform/updates` | Public updates/changelog |
| GET | `/api/public/status` | Service status |
| GET | `/api/public/maintenance-status` | Maintenance state |
| GET | `/api/public/health` | Health check |
| POST | `/api/web-verify/init\|submit\|refresh` | Discord verification |
| POST | `/api/v4/admin/bug-reports/submit` | Bug reports |

#### Authenticated User Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/platform/dashboard` | User dashboard |
| GET/PUT | `/platform/profile/*` | Profile management |
| PUT | `/platform/profile/password` | Password change |
| POST/DELETE | `/platform/profile/2fa/*` | 2FA setup/disable |
| GET | `/platform/premium/status` | Premium status |
| POST | `/platform/premium/create-checkout` | Stripe checkout |
| POST | `/platform/premium/redeem` | License code redemption |

#### Admin Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/signin` | Admin login |
| POST | `/signin/rfid` | RFID authentication |
| GET | `/admin/*` | Admin panel pages |
| GET/POST/PUT/DELETE | `/api/v4/admin/*` | Admin API (CRUD for all entities) |
| POST | `/api/admin/updates` | Publish update with email notification |
| GET/POST/PUT/DELETE | `/api/admin/team/*` | Team management |

### RBAC & Team Management

- Full role-based access control with 5 hierarchical roles
- Per-permission granularity with user-level overrides
- Owner/Co-Owner pages return **404** (not 403) to prevent endpoint discovery
- Audit logging for all access denied events
- Team member CRUD with role hierarchy enforcement

### Premium / Stripe Integration

| Tier | Monthly | Features |
|------|---------|----------|
| Free | $0 | Basic access |
| Pro | $9.99 | Advanced features, API access |
| Enterprise | $29.99 | Custom integrations, SLA |

**Flow:** Checkout → Stripe session → webhook (`checkout.session.completed`) → activate subscription → track in `premium_subscriptions` table

**License codes:** 16-char alphanumeric, redeemable for time-limited premium access

---

## 5. Desktop Apps

### DarkLock Guard (guard-v2/)

A **Rust/Tauri** desktop companion application providing:
- Hardware-level tamper protection
- Vault-based secret management
- IPC communication with the bot
- Real-time security monitoring
- Built for Linux (`.deb`, `.AppImage`) and Windows (`.msi`)

**Auto-update:** Via `/platform/api/updates/:target/:version` Tauri update manifest

### Secure Channel (secure-channel/)

Encrypted communication desktop application built with **Tauri** for secure team messaging.

---

## 6. File Protection System (file-protection/)

Anti-tampering system with multiple layers:

| Component | File | Purpose |
|-----------|------|---------|
| **TamperProtectionSystem** | `index.js` | Main entry — orchestrates baseline verification |
| **Baseline Generator** | `agent/baseline-generator.js` | SHA-256 hash generation for all critical files |
| **Hardware Key** | `hardware-key/` | Optional physical USB key verification |
| **Watchdog** | `hardware-key/watchdog/` | Advanced server watchdog with Pico heartbeat |
| **Config** | `config/` | Baseline storage (`file-hashes.json`) |
| **Backups** | `backups/` | Pre-modification file backups |

**Verification flow:**
1. On startup: `startup.sh` → `baseline-generator.js` → hash all critical files
2. During runtime: `TamperProtectionSystem.verify()` → compare current hashes vs baseline
3. Production mode: **Process exits** on tamper detection
4. NPM script: `npm run tamper:generate` (requires `AUDIT_ENCRYPTION_KEY`)

---

## 7. Hardware Integration

DarkLock supports optional hardware components for physical security:

| Component | File | Purpose |
|-----------|------|---------|
| **Pico Watchdog** | `main.py` | MicroPython on Raspberry Pi Pico — HTTP health polling, GPIO LED status, webhook alerts |
| **Pico Bridge** | `pico-bridge.js` | Serial port bridge between Node.js and Pico |
| **7-Segment Display** | `pico_7segment_display.py` | Physical status code display |
| **RGB LED Status** | `rgb_led_status.py` | Tri-color LED status indicator |
| **Portable Status** | `pico_portable_status.py` | Battery-powered portable status display |
| **RFID Auth** | `darklock/middleware/rfid.js` | RFID card-based admin authentication |

**Watchdog States:**
| State | GPIO | Condition |
|-------|------|-----------|
| OK | Green LED | Health endpoint responds successfully |
| DEGRADED | Yellow LED | Intermittent failures (within threshold) |
| FAIL | Red LED | Sustained failures → trigger shutdown request |

---

## 8. Database Architecture

### Database Files

| File | Path | Engine | Purpose |
|------|------|--------|---------|
| `security_bot.db` | `./data/security_bot.db` | SQLite (default journal) | Main bot database — all guild configs, moderation, security, tickets, analytics |
| `xp.db` | `./data/xp.db` | SQLite (WAL mode) | XP/leveling system |
| `darklock.db` | `./data/darklock.db` | SQLite | Darklock platform (users, admins, sessions, premium) |

### Table Catalog (90+ tables)

#### Core Configuration

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `guild_configs` | `guild_id` PK, ~150+ columns | Primary guild configuration store |
| `guild_settings` | `guild_id` PK, prefix, language, channel IDs, settings_json | Secondary settings (legacy) |
| `guild_security` | `guild_id`, settings (JSON) | Security settings blob |

#### User Management

| Table | Purpose |
|-------|---------|
| `user_records` | User profiles with trust scores, flags, verification status |
| `user_risk_scores` | Risk scoring data |
| `user_behavior` | Behavior analysis data |
| `user_verifications` | Verification records |

#### Moderation

| Table | Purpose |
|-------|---------|
| `mod_actions` | All moderation actions (ban, kick, warn, timeout, etc.) |
| `mod_notes` | Moderator notes on users |
| `moderation_cases` | Case management |
| `action_logs` | Action audit trail with undo support |
| `command_logs` | Command usage logs |
| `warnings` | Warning records |
| `strikes` / `user_strikes` | Strike system |
| `quarantined_users` / `quarantined_messages` | Quarantine system |
| `appeals` | Ban/mute appeal records |

#### Security & Detection

| Table | Purpose |
|-------|---------|
| `security_incidents` | Security incident reports |
| `security_logs` | Detailed security event logs |
| `security_events` | Normalized security events |
| `raid_detection` | Raid detection records |
| `spam_detection` | Spam detection records |
| `malicious_links` / `link_analysis` | Analyzed URLs |
| `behavior_analysis` | Behavior anomaly data |
| `toxicity_scores` | Content toxicity scores |
| `alt_detection` | Alt account detections |
| `global_threats` | Cross-guild threat tracking |
| `antinuke_whitelist` | Anti-nuke whitelist |
| `antinuke_incidents` | Anti-nuke incident history |
| `whitelists` | Security bypass whitelist (user/role with expiry) |

#### Verification

| Table | Purpose |
|-------|---------|
| `verification_queue` | Legacy verification pipeline |
| `verification_records` | Verification attempt records |
| `verification_sessions` | Enterprise verification sessions (hash-based code storage) |
| `captcha_challenges` | CAPTCHA challenge state |

#### Tickets

| Table | Purpose |
|-------|---------|
| `tickets` / `active_tickets` | Ticket records |
| `ticket_messages` | Ticket message history |
| `ticket_transcripts` | Saved transcript data |
| `ticket_config` | Per-guild ticket settings |
| `ticket_categories` | Ticket category definitions |

#### XP & Economy (xp.db)

| Table | Purpose |
|-------|---------|
| `user_xp` | XP, level, messages, daily/weekly/monthly tracking |
| `guild_xp_settings` | Per-guild XP configuration |
| `level_roles` | Level-up role rewards |
| `xp_events` | Time-limited XP boost events |
| `user_levels` | Legacy user level data |
| `coins` / `coin_transactions` | Economy system |
| `shop_items` / `user_inventory` | Virtual shop |

#### Dashboard & Access

| Table | Purpose |
|-------|---------|
| `dashboard_access` | Explicit user→guild access grants |
| `dashboard_role_access` | Role→guild access grants |
| `dashboard_access_codes` | Temporary access codes |
| `dashboard_sessions` | Session tracking |

#### Analytics

| Table | Purpose |
|-------|---------|
| `message_analytics` | Hourly message aggregation per user/channel |
| `command_analytics` | Command usage with response times |
| `join_analytics` / `leave_analytics` | Member flow tracking |
| `reaction_analytics` | Reaction usage |
| `voice_analytics` | Voice activity |
| `bot_metrics` | System health snapshots (memory, CPU, uptime) |
| `analytics` | Legacy guild-level metrics |

#### Audit & Logging

| Table | Purpose |
|-------|---------|
| `audit_logs` | System audit trail |
| `bot_logs` | Bot operational logs |
| `dashboard_audit` / `dashboard_audit_logs` | Dashboard action audit |
| `settings_history` | Setting change history (who, what, when, old→new) |
| `message_logs` | Message content logs |

#### Billing

| Table | Purpose |
|-------|---------|
| `users` | User accounts (Discord ID, email, pro status) |
| `guild_subscriptions` | Guild subscription tracking |
| `pro_codes` / `pro_redemptions` | Promotional codes |
| `activation_codes` | Legacy activation system |

#### Roles & Permissions

| Table | Purpose |
|-------|---------|
| `command_permissions` | Custom command→role mappings |
| `autoroles` | Auto-assign roles on join |
| `reaction_role_panels` / `reaction_role_mappings` | Reaction role panels |
| `channel_access_panels` / `channel_access_roles` | Channel access panels |
| `self_roles` | Self-assignable role config |

#### Darklock Platform (darklock.db)

| Table | Purpose |
|-------|---------|
| `users` | Platform user accounts |
| `sessions` | JTI-based session tracking |
| `admins` / `admin_users` | Admin accounts |
| `roles` / `permissions` / `role_permissions` | RBAC system |
| `team_members` | Team roster |
| `premium_subscriptions` | Premium tier tracking |
| `license_codes` | Redeemable license codes |
| `payment_history` | Stripe payment records |
| `maintenance_state` | Maintenance mode config |
| `service_status` | Service health status |
| `platform_announcements` | Public announcements |
| `bug_reports_v2` | Bug report system |
| `admin_audit_log` / `admin_audit_log_v2` | Admin action audit |

### Migration Systems

**Three independent migration systems run on startup:**

| System | Tracking Table | Files | Notes |
|--------|---------------|-------|-------|
| **File-based** | `schema_version` | `src/database/migrations/001-008_*.js` | 8 migrations |
| **MigrationRunner** | `schema_migrations` | Hardcoded array in `MigrationRunner.js` | 20 migrations with file lock |
| **Legacy ad-hoc** | None (try/catch) | Inline in `database.js runMigrations()` | ~25 ALTER TABLE statements, no tracking |

---

## 9. Services & Middleware Layer

### Enterprise Services

| Service | File | Purpose |
|---------|------|---------|
| **ConfigService** | `src/services/ConfigService.js` | Single source of truth for guild config — cached (5min TTL), versioned (SHA-256), with history and rollback |
| **ConfigSubscriber** | `src/services/config-subscriber.js` | Propagates config changes to runtime modules in real-time (event-driven) |
| **SecurityMiddleware** | `src/services/SecurityMiddleware.js` | Pre-execution middleware for all interactions — blocked users, rate limits (30/min), permissions, hierarchy, input validation |
| **ModerationQueue** | `src/services/ModerationQueue.js` | Rate-limited, idempotent moderation executor with automatic escalation (warn→timeout→kick→ban) |
| **VerificationService** | `src/services/VerificationService.js` | Enterprise verification — risk scoring, code hashing (SHA-256), brute-force lockout (15 attempts), staff approval for ultra profile |
| **TierEnforcement** | `src/services/tier-enforcement.js` | Feature gating — fail-closed to free tier, write-time and read-time enforcement |

### Dashboard Middleware

| Middleware | File | Purpose |
|-----------|------|---------|
| **Auth** | `src/dashboard/middleware/auth.js` | JWT validation, session management |
| **Rate Limit** | `src/dashboard/middleware/rateLimit.js` | API rate limiting (1000/15min) |
| **Security** | `src/dashboard/middleware/security.js` | Security headers, CSP |
| **Validation** | `src/dashboard/middleware/validation.js` | Input validation |
| **API Response** | `src/dashboard/middleware/apiResponse.js` | Standardized response formatting |
| **WS Rate Limit** | `src/dashboard/middleware/wsRateLimit.js` | WebSocket message rate limiting |

### Dashboard Services

| Service | File | Purpose |
|---------|------|---------|
| **AnalyticsService** | `src/dashboard/services/AnalyticsService.js` | Dashboard analytics aggregation |
| **AuditLogService** | `src/dashboard/services/AuditLogService.js` | Dashboard audit log queries |

---

## 10. Deployment & Infrastructure

### Startup Flow

```
Docker:
  Dockerfile → startup.sh → validate-env.sh → check-downloads.js → baseline-generator.js → node src/bot.js

Local Development:
  start-all.sh → npm start (bot :3001) + darklock/start.js (:3002) + guard-service + guard-ui

Hardware Watchdog:
  start-bot.js → [check Pico serial] → src/bot.js (with/without watchdog auto-restart)
```

### Docker

```yaml
# docker-compose.yml
services:
  darklock:
    build: .
    ports: ["3001:3001", "3002:3002"]
    volumes: [data, file-protection/config, logs, uploads, backups]
    deploy:
      resources:
        limits: { cpus: '2', memory: 1G }
    security_opt: ["no-new-privileges:true"]
    healthcheck:
      test: ["CMD", "node", "healthcheck.js"]
      interval: 30s
```

**Dockerfile:** `node:18-bullseye-slim` with native build deps (cairo, pango, sqlite3). Non-root `node` user. `CMD ["sh", "startup.sh"]`.

### Cloudflare Tunnel

The production deployment uses **Cloudflare Tunnel** running on the Raspberry Pi 5 as a systemd service:

| Hostname | Backend | Purpose |
|----------|---------|---------|
| `admin.darklock.net` | `http://localhost:3001` | Bot Dashboard |
| `platform.darklock.net` | `http://localhost:3002` | Darklock Platform |

### Environment Variables

63 environment variables grouped by category:

| Category | Variables | Required |
|----------|-----------|----------|
| **Discord** | `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI` | Yes |
| **Auth/Security** | `JWT_SECRET`, `ADMIN_JWT_SECRET`, `SESSION_SECRET`, `OAUTH_STATE_SECRET`, `ADMIN_PASSWORD`, `ADMIN_USERNAME`, `INTERNAL_API_KEY`, `AUDIT_ENCRYPTION_KEY` | Yes |
| **Web** | `DASHBOARD_ORIGIN`, `BASE_URL`, `XP_DASHBOARD_URL`, `XP_DASHBOARD_PORT`, `CORS_ORIGINS` | Yes |
| **Database** | `DB_NAME`, `DB_PATH` | Optional (defaults exist) |
| **Email** | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Optional |
| **Stripe** | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID` | For billing |
| **AI** | `OPENAI_API_KEY`, `VIRUSTOTAL_API_KEY`, `SAFE_BROWSING_API_KEY` | Optional |
| **Hardware** | `RFID_HOST`, `RFID_PORT`, `PORTABLE` | Optional |
| **Runtime** | `NODE_ENV`, `PRODUCTION_MODE`, `ENABLE_AI_TOXICITY`, `ENABLE_VPN_DETECTION`, `ENABLE_WEB_DASHBOARD` | Optional |

---

## 11. Security Audit Findings

### CRITICAL

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| 1 | **Unauthenticated console log access** — `/api/logs/:guildId` registered before auth middleware | `dashboard.js` | Anyone with a guild ID can read/clear all bot console logs |
| 2 | **No guild access check on destructive operations** — `handleLockdown`, `handleEmergency`, `updateSecuritySettings`, `resetSettings`, `updateApiKeys` accept `guildId` from query param without `checkGuildAccess()` | `dashboard.js` | Authenticated user can lock/modify/reset ANY server the bot is in |
| 3 | **SQL injection via template literal** — `pro_codes.duration_days` interpolated directly into SQL string | `dashboard.js` | If the DB value is tampered, arbitrary SQL execution |
| 4 | **SQL injection in `createOrUpdateUserRecord()`** — object keys used as column names without allowlist | `database.js` | If userData comes from untrusted input, arbitrary column injection |
| 5 | **AntiRaid `removeLockdown` destroys channel permissions** — deletes `@everyone` overwrites instead of restoring originals | `antiraid.js` | Lockdown/unlock cycle permanently loses all custom channel permissions |

### HIGH

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| 6 | **Auth skip list too broad** — `/v3/`, `/admin/`, `/rfid/`, `/v4/admin/` prefixes bypass JWT auth entirely | `dashboard.js` | Any future routes under these prefixes are unprotected |
| 7 | **JWT token returned in JSON response** — `handleLogin` returns token in body alongside HttpOnly cookie | `dashboard.js` | Defeats HttpOnly by exposing token to JavaScript |
| 8 | **Public metrics endpoint** — `/platform/api/metrics` exposes server memory, CPU, DB latency with no auth | `darklock/routes/platform/index.js` | Information disclosure |
| 9 | **Inconsistent data backends** — profile updates write to JSON files while auth reads from SQLite | `darklock/routes/profile.js` | Data desynchronization, potential auth bypass |
| 10 | **Duplicate table definitions** — 6+ tables defined with different schemas in different locations | Multiple | Schema depends on whether DB was fresh or migrated |
| 11 | **No WAL mode on main database** — reads block writes, concurrent API requests may fail with SQLITE_BUSY | `database.js` | Dashboard API reliability issues under load |

### MEDIUM

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| 12 | Broken CSRF token system — no `express-session`, token never persisted | `dashboard.js` | CSRF protection is non-functional |
| 13 | Setup pages served without auth — `/setup/security`, `/setup/tickets`, etc. | `dashboard.js` | HTML/JS accessible to unauthenticated users |
| 14 | Unbounded in-memory caches — `discordTokenCache`, `configCache`, `cooldowns`, `rateLimits` | Multiple | Memory leak under sustained load |
| 15 | Plaintext admin password fallback — bcrypt comparison falls back to plaintext | `dashboard.js` | Weak password storage if admin hasn't set bcrypt hash |
| 16 | Error messages leak internal details — `error.stack` and `error.message` in responses | Multiple | Information disclosure |
| 17 | CSP allows `unsafe-inline` for scripts | `darklock/server.js` | XSS protection weakened |
| 18 | Coin transfer race condition — balance check separated from debit | `database.js` | Concurrent transfers could overdraw |
| 19 | Inconsistent level formula between leaderboard and messageCreate | Multiple | Users see different levels in different contexts |
| 20 | `Math.random()` for JWT secret generation in setup wizard | `setup.js` | Not cryptographically secure |
| 21 | Foreign keys never enforced — `PRAGMA foreign_keys` never set to ON | `database.js` | Referential integrity not enforced |

### LOW

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| 22 | Dead code: `handleXPGain()` defined but never called | `messageCreate.js` | Code confusion |
| 23 | Auto-kick timer lost on bot restart (in-memory setTimeout) | `guildMemberAdd-verification.js` | Unverified members never auto-kicked after restart |
| 24 | `RankSystem` uses synchronous `writeFileSync` on every message | `RankSystem.js` | Event loop blocking at scale |
| 25 | Leaderboard: no rate limiting, open CORS, no caching | `src/web/server.js` | Resource exhaustion via Discord API amplification |
| 26 | Three separate migration systems running on startup | Multiple | Complexity, potential conflicts |
| 27 | No data retention/cleanup for log tables | Multiple | Unbounded growth, performance degradation |

---

## 12. File Structure Reference

```
├── src/
│   ├── bot.js                          # Main bot class (SecurityBot, ~3800 lines)
│   ├── commands/
│   │   ├── admin/                      # 18 admin commands
│   │   ├── security/                   # 17 security commands
│   │   ├── moderation/                 # 15 moderation commands
│   │   ├── utility/                    # 22 utility commands
│   │   └── handlers/                   # Command handlers
│   ├── core/
│   │   ├── canonical-systems.js        # System registry
│   │   ├── command-allowlist.js        # Allowed command list
│   │   ├── eventLoader.js             # Dynamic event loader
│   │   ├── events/                    # Core event definitions
│   │   └── interactions/              # Core interaction handlers
│   ├── dashboard/
│   │   ├── dashboard.js               # Main dashboard server (~14,000 lines)
│   │   ├── bootstrap.js               # Dashboard DB initialization
│   │   ├── middleware/                 # 7 middleware modules
│   │   ├── routes/                    # 10 route modules
│   │   ├── services/                  # 2 service modules
│   │   ├── views/                     # 25+ HTML views
│   │   │   └── site/                  # 12 public site pages
│   │   ├── public/                    # Static assets
│   │   └── websocket/                 # WebSocket handler
│   ├── database/
│   │   ├── database.js                # Main DB module (90+ tables)
│   │   ├── MigrationRunner.js         # Migration system (20 migrations)
│   │   └── migrations/                # File-based migrations (8)
│   ├── db/
│   │   ├── xpDatabase.js             # XP database module
│   │   └── schema.sql                # XP schema
│   ├── events/                        # 12 Discord event handlers
│   ├── security/                      # 34 security modules
│   ├── services/                      # 6 enterprise services
│   ├── systems/                       # 13 bot subsystems
│   ├── utils/                         # 36 utility modules
│   └── web/
│       └── server.js                  # XP leaderboard server
├── darklock/
│   ├── server.js                      # Platform server (~2,600 lines)
│   ├── start.js                       # Platform entry point
│   ├── routes/                        # 10 route modules
│   ├── middleware/                     # RFID middleware
│   ├── utils/                         # 10 utility modules
│   ├── views/                         # 18+ HTML views
│   ├── public/                        # CSS, JS, icons
│   ├── admin-v4/                      # Admin panel v4
│   ├── data/                          # Platform data
│   └── downloads/                     # Desktop app installers
├── file-protection/
│   ├── index.js                       # Tamper protection system
│   ├── agent/                         # Baseline generator
│   ├── hardware-key/                  # Hardware key + watchdog
│   ├── config/                        # Hash baselines
│   └── backups/                       # File backups
├── guard-v2/                          # Rust/Tauri desktop app
├── secure-channel/                    # Encrypted comms app
├── data/
│   ├── security_bot.db               # Main database
│   ├── xp.db                         # XP database
│   ├── darklock.db                   # Platform database
│   ├── ranks.json                    # Legacy XP data (file-based)
│   └── file-integrity.json           # File hash baseline
├── hardware/                          # Hardware schematics
├── scripts/                           # Deployment scripts
├── docs/                              # Documentation
├── tests/                             # Test suites
├── locale/                            # i18n translations
├── assets/                            # Brand assets
├── main.py                            # Pico watchdog (MicroPython)
├── config.json                        # Default security config
├── package.json                       # NPM config (29 dependencies)
├── docker-compose.yml                 # Docker deployment
├── Dockerfile                         # Container build
├── startup.sh                         # Docker CMD entry
├── start-all.sh                       # Local multi-service launcher
└── start-bot.js                       # Hardware watchdog launcher
```

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/your-repo/darklock-guard.git
cd darklock-guard
npm install

# 2. Configure
cp .env.example .env
# Edit .env with your Discord bot token, client ID/secret, and secrets

# 3. Interactive setup
npm run setup

# 4. Generate tamper baseline
AUDIT_ENCRYPTION_KEY=your-key npm run tamper:generate

# 5. Start the bot
npm start

# 6. Start all services (local development)
./start-all.sh
```

## Production Deployment (Raspberry Pi 5)

```bash
# Deploy with systemd service
sudo systemctl stop discord-bot
git fetch origin main && git reset --hard origin/main
AUDIT_ENCRYPTION_KEY=your-key npm run tamper:generate
sudo systemctl start discord-bot

# Verify
systemctl is-active discord-bot
curl -s https://admin.darklock.net/health
```

---

## Dependencies (29 production)

| Package | Purpose |
|---------|---------|
| `discord.js` v14 | Discord API client |
| `express` v4 | HTTP server framework |
| `sqlite3` | Database driver |
| `helmet` | Security headers |
| `cors` | Cross-Origin Resource Sharing |
| `express-rate-limit` | API rate limiting |
| `bcrypt` | Password hashing |
| `jsonwebtoken` | JWT authentication |
| `speakeasy` | TOTP 2FA |
| `qrcode` | QR code generation (2FA setup) |
| `canvas` | Image generation (rank cards) |
| `sharp` | Image processing |
| `openai` | AI toxicity analysis |
| `stripe` | Payment processing |
| `axios` | HTTP client |
| `ws` | WebSocket server |
| `winston` | Logging framework |
| `dotenv` | Environment variable loading |
| `multer` | File upload handling |
| `nodemailer` | Email sending |
| `node-cron` | Scheduled tasks |
| `chokidar` | File change watching |
| `geoip-lite` | IP geolocation |
| `string-similarity` | String comparison (phishing detection) |
| `serialport` | Hardware communication |
| `moment` | Date manipulation (legacy) |
| `url-parse` | URL parsing |

---

*Last updated: February 2026*
