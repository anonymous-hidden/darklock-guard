# DarkLock — Full Technical Project Audit

> **Generated:** March 5, 2026  
> **Purpose:** Comprehensive technical reference of the entire DarkLock ecosystem — architecture, subsystems, algorithms, data flows, and design decisions. Intended for external context sharing (no secrets included).

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Map](#2-architecture-map)
3. [Discord Security Bot (Node.js)](#3-discord-security-bot)
   - 3.1 [Entry Point & Lifecycle](#31-entry-point--lifecycle)
   - 3.2 [Security Modules](#32-security-modules)
   - 3.3 [Moderation & Management Systems](#33-moderation--management-systems)
   - 3.4 [XP / Leveling System](#34-xp--leveling-system)
   - 3.5 [Event Pipeline](#35-event-pipeline)
   - 3.6 [Command System](#36-command-system)
   - 3.7 [Enterprise Services Layer](#37-enterprise-services-layer)
   - 3.8 [Database Layer](#38-database-layer)
   - 3.9 [Internationalization](#39-internationalization)
4. [Web Dashboard](#4-web-dashboard)
   - 4.1 [Express Server & Middleware](#41-express-server--middleware)
   - 4.2 [Authentication & OAuth](#42-authentication--oauth)
   - 4.3 [REST API Routes](#43-rest-api-routes)
   - 4.4 [Real-Time System (WebSocket)](#44-real-time-system-websocket)
   - 4.5 [Frontend Views](#45-frontend-views)
   - 4.6 [Billing & Tier Enforcement](#46-billing--tier-enforcement)
5. [Darklock Platform (darklock/)](#5-darklock-platform)
   - 5.1 [Platform Server](#51-platform-server)
   - 5.2 [Admin v4 Dashboard](#52-admin-v4-dashboard)
   - 5.3 [RBAC & Security](#53-rbac--security)
   - 5.4 [Premium & Billing](#54-premium--billing)
   - 5.5 [Maintenance System](#55-maintenance-system)
6. [Platform API (TypeScript + PostgreSQL)](#6-platform-api)
7. [Darklock Secure Notes](#7-darklock-secure-notes)
   - 7.1 [Cryptographic Architecture](#71-cryptographic-architecture)
   - 7.2 [Web App (React)](#72-web-app-react)
   - 7.3 [Sync Server](#73-sync-server)
   - 7.4 [Desktop App (Tauri)](#74-desktop-app-tauri)
8. [Secure Channel (Rust Messenger)](#8-secure-channel)
9. [Guard v2 (Rust File Integrity)](#9-guard-v2)
10. [Hardware / IoT Layer](#10-hardware--iot-layer)
    - 10.1 [Pi 5 → Elegoo Mega Bridge](#101-pi-5--elegoo-mega-bridge)
    - 10.2 [Pico Microcontroller Firmware](#102-pico-microcontroller-firmware)
    - 10.3 [Pico Watchdog (Emergency Failover)](#103-pico-watchdog)
    - 10.4 [RFID Security Gateway](#104-rfid-security-gateway)
    - 10.5 [Bot-Side Hardware Integration](#105-bot-side-hardware-integration)
11. [Security Suite (Runtime Protection)](#11-security-suite)
12. [File Tamper Protection](#12-file-tamper-protection)
13. [Cloudflare Worker (Edge Failover)](#13-cloudflare-worker)
14. [Deployment & Infrastructure](#14-deployment--infrastructure)
15. [Tech Stack Summary](#15-tech-stack-summary)

---

## 1. Project Overview

**DarkLock** is a multi-application security ecosystem centered around a Discord security bot, with companion apps including:

- A **Discord security bot** (Node.js / discord.js v14) with 50+ slash commands, 20+ security modules, and an integrated web dashboard
- A **Darklock Platform** (Express.js) — multi-tenant admin portal with RBAC, premium billing, and team management
- A **Platform API** (TypeScript/Express + PostgreSQL) — next-gen device management and update portal
- **Darklock Secure Notes** — zero-knowledge encrypted note-taking app (React + Tauri + libsodium)
- **Secure Channel** — Signal Protocol-inspired E2E encrypted messenger (Rust)
- **Guard v2** — Rust-based file integrity monitoring with a Tauri desktop GUI
- A **Hardware/IoT layer** — Raspberry Pi 5, Elegoo Mega 2560, Raspberry Pi Pico modules for physical status indicators, RFID authentication, and emergency failover
- **Security Suite** — runtime integrity monitoring (memory, env, network, auth)
- **File Tamper Protection** — SHA-256 baseline verification with filesystem watchers

The system is self-hosted on a Raspberry Pi 5, with Cloudflare Tunnel for public access and a Cloudflare Worker for edge-level failover.

---

## 2. Architecture Map

```
┌──────────────────────────────────────────────────────────────┐
│                     INTERNET / USERS                         │
└────────────┬──────────────────────┬──────────────────────────┘
             │                      │
    Cloudflare Tunnel        Cloudflare Worker
             │               (edge failover)
             ▼
┌──────────────────────────────────────────────────────────────┐
│                  RASPBERRY PI 5 HOST                         │
│                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │  Discord Bot     │  │  Darklock       │  │  Platform   │  │
│  │  (Node.js:3001)  │  │  Platform       │  │  API        │  │
│  │  + Web Dashboard │  │  (Express:3002) │  │  (TS:5000)  │  │
│  │  + XP Dashboard  │  │  + Admin v4     │  │  + Postgres │  │
│  │  (:3005, :3007)  │  │                 │  │             │  │
│  └──────┬───────────┘  └─────────────────┘  └─────────────┘  │
│         │                                                     │
│  ┌──────┴───────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │  SQLite DBs      │  │  Guard v2       │  │  Secure     │  │
│  │  (data/*.db)     │  │  (Rust daemon)  │  │  Channel    │  │
│  │                  │  │  + Tauri GUI    │  │  (Rust)     │  │
│  └──────────────────┘  └─────────────────┘  └─────────────┘  │
│                                                              │
│  ┌──────────────────┐  ┌─────────────────┐                   │
│  │  Security Suite  │  │  File Tamper    │                   │
│  │  (runtime)       │  │  Protection     │                   │
│  └──────────────────┘  └─────────────────┘                   │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │                  HARDWARE (USB/SPI/UART)                 ││
│  │  Elegoo Mega 2560 ← serial ← Pi 5 → SPI → RFID RC522   ││
│  │  (RGB LEDs, LCD, MAX7219)        (rfid_gateway.py)       ││
│  │                                                          ││
│  │  Pico (7seg display) ← USB serial                       ││
│  │  Pico W (status LEDs) ← USB serial                      ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│               PICO 2 W (INDEPENDENT WATCHDOG)                │
│  Monitors Pi 5 /health over Wi-Fi                            │
│  Serves fallback 503 page if Pi 5 goes down                  │
│  RGB LED status indicator                                    │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Discord Security Bot

**Stack:** Node.js 18+, discord.js v14.14, SQLite3 (WAL mode), Express.js  
**Entry:** `src/bot.js` — `SecurityBot` class (3844 lines)

### 3.1 Entry Point & Lifecycle

The bot is a single `SecurityBot` class that:

1. **Validates environment** — `EnvValidator` checks required variables, prints a report; CI/cloud platforms auto-skip strict validation.
2. **Initializes Tamper Protection** — loads file-protection baseline, starts filesystem watchers.
3. **Connects to SQLite** — WAL mode, `busy_timeout=5000`, foreign keys enabled. Runs versioned migrations (`MigrationRunner`) then legacy ad-hoc column additions.
4. **Instantiates 30+ modules** in sequence: security modules → utility modules → enhanced systems → XP system → enterprise services.
5. **Loads commands** — two-phase: refactored top-level commands first, then legacy subfolder commands (duplicates skipped).
6. **Sets up Discord event handlers** — `ready`, `messageCreate`, `interactionCreate`, `guildMemberAdd`, `guildMemberRemove`, `messageUpdate`, `messageReactionAdd/Remove`, etc.
7. **Starts web dashboard** — Express on port 3001 (configurable).
8. **Starts XP dashboard** — separate Express on port 3007.
9. **Logs in to Discord** — registers slash commands (global + per-guild).
10. **Graceful shutdown** — `SIGINT`/`SIGTERM` handlers call `bot.shutdown()`, which disconnects Discord, closes DB, and stops servers.

**Launcher:** `start-bot.js` detects hardware (Pico USB via `serialport.list()`, vendor `2e8a`). If found, uses `AdvancedServerWatchdog` (3s heartbeat, max 10 restarts/5min); otherwise, spawns `node src/bot.js` as a child process.

### 3.2 Security Modules

All modules live in `src/security/` and receive the bot instance for DB/logger/event access.

#### Anti-Raid (`antiraid.js` — 563 lines)
- **Algorithm:** Sliding 60-second window of join timestamps per guild. When joins exceed `raid_threshold` (default 10), triggers raid response.
- **Response:** Logs to `raid_detection` table, activates server lockdown, processes offending users, notifies moderators, emits real-time dashboard event.
- **Config:** `anti_raid_enabled`, `raid_threshold`, configurable via dashboard.

#### Anti-Spam (`antispam.js` — 1,102 lines)
- **Algorithm:** 7 independent checks per message using `BoundedMap` (TTL-evicting, max 5k–20k entries):
  1. Per-channel flood (N msgs in window)
  2. Cross-channel flood
  3. Duplicate message detection
  4. Mention spam (> threshold mentions)
  5. Emoji spam (> threshold emojis)
  6. Excessive links
  7. Excessive caps (> ratio threshold)
- **Response:** Configurable action — delete, warn, timeout, or kick. 30-second grace period post-punishment. Moderator/channel bypass lists.
- **Config:** Per-guild thresholds via `guild_configs` columns (`antispam_flood_messages`, `antispam_caps_ratio`, etc.).

#### Anti-Nuke (`antinuke.js` — 2,836 lines)
- **Algorithm:** Dual-layer detection:
  - **Burst thresholds** — e.g., 2 channel deletes in 8 seconds
  - **Cumulative quotas** — e.g., 5 channel deletes/hour, 15/day (catches slow-burn attacks)
- **Live Snapshots:** Maintains in-memory copies of channels, roles, webhooks for instant restoration.
- **Repair Lock:** `repairMode` flag prevents the system from triggering on its own restoration actions.
- **Diff-Based Restore:** Only restores what was actually changed.
- **Response:** Quarantine mode (strips dangerous permissions server-wide), automatic channel/role restoration, incident IDs for tracking.
- **Backup Freshness:** Warns if backup > 24h old, marks stale after 72h.

#### Anti-Nuke Manager (`AntiNukeManager.js` — 260 lines)
Higher-level orchestrator composing `PermissionMonitor`, `RateLimiter`, `SnapshotManager`, and `restoreManager`. Tracks actions per user, triggers when create/delete counts exceed thresholds. Auto-deletes flagged users' channel creations. Mitigation strips dangerous roles, applies quarantine — but skips whitelisted users, server owner, and the bot itself.

#### Anti-Phishing (`antiphishing.js` — 644 lines)
- **Algorithm:** Regex pattern matching for Discord/Steam impersonation, crypto scams, urgency phrases. URL-conditional patterns reduce false positives (e.g., "congratulations" alone is safe).
- **Username Analysis:** `string-similarity` library for lookalike detection against staff members.
- **New Member Check:** Scans usernames for admin/moderator impersonation patterns.

#### Link Analyzer (`LinkAnalyzer.js` — 649 lines)
- **Databases:** Known shortener domains (18), IP logger domains (16), phishing domains (hardcoded + DB `malicious_links` table, refreshed hourly).
- **Confusable Characters:** Maps Cyrillic → Latin homoglyphs, fullwidth digits for lookalike domain detection against targets like `discord.com`, `steamcommunity.com`.
- **Cache:** TTL-based (1 hour) analysis results.
- **External APIs:** Optional Google Safe Browsing integration and URL shortener expansion.
- **Trusted Domains:** Discord CDN, YouTube, Google, etc. — skip analysis entirely.

#### Word Filter Engine (`WordFilterEngine.js` — 791 lines)
- **Normalization:** Strips zero-width characters, variation selectors, combining marks; collapses whitespace. "Smart" mode converts leetspeak (e.g., `1337` → `leet`).
- **Matching:** Three modes — exact, contains, smart. Supports wildcards (`*`) in banned words.
- **Actions:** delete, warn, mute, kick, log_only. Per-user 5-second cooldown prevents punishment floods.
- **Config:** Dashboard-driven via `guild_configs` columns (`banned_words`, `banned_phrases`, `word_filter_action`, `word_filter_mode`, whitelist channels/roles).

#### Automod (`automod.js` — 458 lines)
Dashboard-driven with `automod_settings` JSON config. 6 filters in priority order (stops on first match):
1. Invite links (can allow server's own invites)
2. Word filter
3. Mention spam
4. Emoji spam
5. Caps filter
6. Message length filter

#### Behavior Detection (`behavior.js` — stub)
Placeholder — empty method shells for `analyzeNewJoin`, `analyzeMessage`, `trackUserBehavior`. Not yet implemented.

#### Toxicity Filter (`toxicity.js` — stub)
Placeholder — single empty `checkMessage` method. Not yet implemented.

#### Alt Account Detector (`altdetector.js` — 557 lines)
- **Fingerprinting:** Stores fingerprints of banned users (username patterns, display name, avatar hash, account creation range) in `banned_fingerprints` table.
- **Detection:** On new joins, compares avatar hash, username patterns, join timing correlation. Also stores behavioral patterns (typing speed, message length, active hours, emoji usage) in `user_behavior_patterns`.
- **Confidence Scoring:** Assigns confidence levels to detected alts.
- **Actions:** alert, quarantine, or kick (configurable).

#### Verification System (`VerificationSystem.js` — 428 lines)
Multi-mode adaptive verification:
- Button click (risk < 40)
- Emoji reaction (risk 40–59)
- Emoji sequence (risk 60–79)
- Web CAPTCHA (risk ≥ 80)

Difficulty selected by risk score from `RiskScoring`. Uses `crypto`-generated tokens with expiry.

#### User Verification (`userverification.js` — 1,016 lines)
Full lifecycle: join → risk assessment → verification challenge → role assignment. Enforces minimum account age (auto-kick if too young), button rate limiting (10s cooldown), risk alert cooldown (15min), whitelist bypass, max 5 attempts before lockout.

#### Risk Scoring (`RiskScoring.js` — 346 lines)
Composite scoring with 6 sub-scores:
- Account age (< 1 day = 90, > 1 year = 10)
- Avatar presence (none = 40)
- Mutual servers
- Join velocity (how fast users are joining)
- Username analysis
- Previous flags in the guild

Averaged into a total score. Stored in `user_risk_scores` table.

#### Risk Engine (`RiskEngine.js` — 130 lines)
Lighter scorer for joins:
- Account < 1 day: +30, < 7 days: +15
- No avatar: +10
- No mutual servers: +5
- ≥5 joins in 60s: +20, ≥3: +10
- Base: 30, cap: 100

Risk levels: low (<40), elevated (40–59), medium (60–79), high (80+). Returns explainable `reasons` array.

#### Lockdown Service (`LockdownService.js` — 102 lines)
Iterates all roles, backs up permission bitfields to `role_perm_backup`, strips dangerous permissions (`Administrator`, `ManageChannels`, `ManageRoles`, `BanMembers`, `KickMembers`). Uses DB transactions (BEGIN/COMMIT/ROLLBACK) for atomicity.

#### Recovery System (`RecoverySystem.js` — 539 lines)
Auto-snapshots every 6 hours. Captures channels, roles, members, settings in parallel (`Promise.all`), stores as JSON in `server_snapshots` table. Used by anti-nuke restore flow.

#### Snapshot Service (`SnapshotService.js` — 100 lines)
Lightweight, frequent snapshots every 15 minutes. Serializes each role (name, permissions, color, hoist, mentionable) and channel (name, type, parent, position, overwrites) into `role_snapshots` and `channel_snapshots` tables with transaction-based upserts.

#### Scan Engine (`ScanEngine.js` — 331 lines)
**Read-only** guild scanner — never performs destructive actions. Scans text channels for malicious file patterns (double-extension tricks like `.exe.png`), spam phrases, and link threats. Single-instance lock prevents concurrent scans. Findings delegated to `DecisionLayer` and `ActionExecutor`.

#### Staff Security (`StaffSecurity.js` — 459 lines)
TOTP-based 2FA via `speakeasy` (verification window = 2 codes). QR codes via `qrcode` library. Generates 10 backup codes on setup. Stores state in `staff_2fa` table. Requires 2FA for sensitive admin actions.

#### Whitelist Manager (`WhitelistManager.js` — 358 lines)
Central whitelist system with per-layer bypass flags (`bypass_antispam`, `bypass_antinuke`, `bypass_antiraid`, `bypass_verification`). Supports expiration timestamps. Types: user, role, bot, channel, webhook. Queried by all security subsystems.

### 3.3 Moderation & Management Systems

All in `src/systems/`:

#### Strike System (`strikesystem.js`)
Point-based infractions. Per-offense-type point values, automatic actions at configurable thresholds (e.g., timeout at 5 points, ban at 15). Strike decay: configurable (default 30 days, 1 point per decay period).

#### Appeal System (`appealsystem.js`)
Ban appeal workflow with configurable cooldown (default 7 days), custom review questions (JSON array), review channel, and auto-DM on ban.

#### Quarantine System (`quarantine.js`)
Role-isolation system. Stores previous roles for release. Auto-quarantine trigger for alt accounts and accounts below configurable age threshold (default 7 days).

#### Modmail (`modmail.js`)
DM-based modmail with private threads. Per-guild config (category, log channel, staff role, greeting, anonymous mode). Canned response snippets. Active sessions cached in memory for fast DM routing.

#### Invite Tracker (`invitetracker.js`)
Caches guild invites in memory. Tracks who joined via which invite. Fake detection by account age. Per-inviter stats (total, regular, bonus, fake, left). Useful for raid detection and member rewards.

#### Server Backup (`serverbackup.js`)
Captures roles (hierarchy, permissions, colors), channels (types, categories, positions, overwrites), server settings, and optionally bans. Files in `data/backups/` with SHA-256 integrity hashes. Auto-backup scheduler checks every 10 minutes. Concurrent-restore prevention via `Set`.

#### Discord Logger (`DiscordLogger.js`)
Rich embeds posted to configured log channels — message edits/deletes, member joins/leaves, role changes, channel creation/deletion, mod actions. Channel resolution priority: specialized channel → `mod_log_channel` → general `log_channel_id`. Config cached with 30s TTL.

#### Rank System (`systems/rankSystem.js`)
EventEmitter-based XP/leveling. Message XP: 15–25 random, voice XP: 10/min, 60s cooldown per user+guild. Level formula: XP_required = level² × 100. Emits events on level-up.

### 3.4 XP / Leveling System

Dual implementation:

**1. JSON-Based (`utils/RankSystem.js`):**
- Data in `data/ranks.json`
- 15 base XP + 0–10 random bonus, 60s cooldown
- Streak bonuses: +5% (2-day), +15% (7-day), +30% (30-day)
- Role rewards at milestones (5/10/20/30/50)
- Level formula: `level = floor(0.1 × √XP)`
- Weekly/monthly reset support, global XP multiplier, temporary boosts

**2. DB-Based Arcane-Style (`src/bot/xpTracker.js` + `src/db/xpDatabase.js`):**
- SQLite `data/xp.db` with WAL mode
- Filters: bots, DMs, system messages, messages < 5 chars
- Per-guild enable/disable, configurable min/max XP
- Anti-spam cooldown checks, automatic daily/weekly/monthly counter resets
- Level-up notifications with customizable messages, channels, and role rewards
- Separate web leaderboard dashboard on port 3005

### 3.5 Event Pipeline

Events loaded via `src/core/eventLoader.js`. Key handlers:

#### `messageCreate.js` (263 lines) — Core Message Pipeline
1. Ignore bots/system messages
2. **DMs:** Verification handler → DM ticket manager
3. **Guild messages:** Verification channel check → resolve guild config (tier-masked via `ConfigService`)
4. **Logging:** Insert into `message_logs` (optional content redaction)
5. **Security pipeline** (sequential, short-circuits on first match):
   - Anti-spam → Word filter → Anti-phishing → Automod → Link analyzer → Toxicity filter (AI-gated)
6. After security: update analytics and trust scores

#### `guildMemberAdd.js` (155 lines)
4 modes based on config:
| Welcome | Verification | Behavior |
|---------|-------------|----------|
| ON | OFF | Send welcome immediately |
| OFF | ON | Run verification only |
| ON | ON | Run verification, defer welcome until verified |
| OFF | OFF | No action |

Also applies autoroles with optional bot bypass and configurable delay.

#### `ready.js` (218 lines)
- Sets presence ("Watching N servers | /help")
- Iterates all guilds: ensure config, initialize antiRaid/antiSpam/verification
- Caches invites for tracking
- Starts periodic maintenance tasks and `HardwareStatusWriter`

### 3.6 Command System

**67 slash commands** organized into categories:

| Category | Count | Commands |
|----------|-------|----------|
| Security | 8 | `automod`, `antinuke`, `wordfilter`, `altdetect`, `security`, `status`, `baseline-update`, `rolescan` |
| Moderation | 15 | `ban`, `unban`, `kick`, `timeout`, `warn`, `modnote`, `cases`, `purge`, `lock`, `unlock`, `slowmode`, `appeal`, `strike`, `quarantine`, `redact` |
| Admin | 9 | `setup`, `admin`, `settings`, `serverbackup`, `reactionroles`, `channelaccess`, `serversetup`, `voicemonitor`, `xp` |
| Utility | 14 | `ticket-new`, `help`, `ping`, `serverinfo`, `userinfo`, `announce`, `poll`, `invites`, `schedule`, `auditlog`, `trustscore`, `rank`, `leaderboard`, `analytics` |
| Deprecated | 20 | Old commands showing migration warnings |
| Blocked | 17 | Economy, fun, AI — files deleted |

**Command dispatch pipeline** (middleware chain):
1. Cooldown check (per-user, per-command)
2. Enterprise security middleware (blocked user check, rate limit, permission, input validation)
3. Feature flag check
4. Plan-based gating (pro/enterprise)
5. Role-based permission check
6. Analytics tracking
7. Command execution

**Canonical Systems Enforcement** (`canonical-systems.js`):
Hooks into Node's `require()` to prevent importing deprecated/duplicate modules. Defines canonical implementations per domain (tickets, antinuke, trust). Hard-fails on import of deleted systems. Sandboxes `OpenAIClient.js` — AI must not run in the security process.

### 3.7 Enterprise Services Layer

#### Config Service (`ConfigService.js`)
Typed, versioned guild configuration with validation and live sync. Full schema with types (`boolean`, `number`, `string`, `snowflake`, `json_array`), constraints (min/max, enum, maxLength), and defaults. 5-minute cache with `lastKnownGood` fallback. Emits events on changes. Integrates tier enforcement.

#### Verification Service (`VerificationService.js`)
Multi-method verification (button, captcha, web, reaction, auto). Rate-limited (5s cooldown, max 5 attempts/session, max 15 global before lockout). Sessions tracked in `verification_sessions` table with hashed codes and unique tokens.

#### Security Middleware (`SecurityMiddleware.js`)
Command-level chain: blocked user → rate limit (30 cmd/min) → permission → role hierarchy → input validation (detects Discord gift scams, `eval`/`exec` injection, `<script>` XSS) → guild-only check.

#### Moderation Queue (`ModerationQueue.js`)
Queued moderation with retries, idempotency (SHA-256 keys, 1-min TTL), per-guild rate limiting (10 actions/10s), async processing with 3 retries and 2s delay. Configurable escalation thresholds (warn→timeout at 3, timeout→kick at 2, kick→ban at 1, 30-day offense decay).

#### Tier Enforcement (`tier-enforcement.js`)
Single authority for subscription gating. Three tiers (free/pro/enterprise) with numeric limits:
- Free: 3 protected roles, 1 backup slot
- Pro ($9.99/mo): 25 protected roles, 10 backup slots, AI, advanced analytics, API access
- Enterprise ($29.99/mo): Unlimited, whitelabel, custom integrations, SLA

Fail-closed (defaults to `free` on error).

### 3.8 Database Layer

**Engine:** SQLite3 with WAL mode, `busy_timeout=5000`, `foreign_keys=ON`  
**Path:** `data/darklock.db` (configurable via `DB_PATH`/`DB_NAME`)

**Migration System:** Dual:
1. **MigrationRunner** (`MigrationRunner.js` — 735 lines): Tracks applied versions in `_migrations` table. Lock file prevents concurrent runs. DB adapter abstraction (SQLite/MySQL compatible).
2. **Legacy ad-hoc migrations**: Sequential `ALTER TABLE ADD COLUMN` blocks in `database.js`, each independently try/caught for idempotency.

**Core Tables:**
- `guild_configs` — per-guild settings (100+ columns covering all security/moderation toggles)
- `guild_settings` — nested JSON settings blob
- `tickets`, `active_tickets` — support ticket system
- `mod_logs`, `warnings`, `user_records` — moderation history
- `message_logs`, `security_logs`, `verification_logs` — event logging
- `raid_detection`, `user_risk_scores`, `verification_sessions` — security data
- `server_snapshots`, `role_snapshots`, `channel_snapshots` — backup data
- `role_perm_backup` — pre-lockdown permission storage
- `settings_history` — setting change audit trail
- `audit_logs` — encrypted forensic events with before/after diffs
- `stripe_subscriptions`, `guild_subscriptions` — billing
- `user_levels`, `user_xp` — ranking/XP
- `whitelists` — bypass lists with per-layer flags
- `banned_fingerprints`, `detected_alts`, `user_behavior_patterns` — alt detection
- `staff_2fa` — TOTP 2FA state
- `word_filter_violations` — filter logs
- `dashboard_audit_logs` — dashboard activity trail

**Config Caching:** In-memory `Map` with 5-minute TTL to reduce DB reads.

### 3.9 Internationalization

6 locales: `en.json`, `de.json`, `es.json`, `fr.json`, `pt.json`

Strings organized by domain: `verification.*`, `moderation.*`, `strike.*`, `captcha.*`, `queue.*`. Template variables use `{{var}}` syntax.

---

## 4. Web Dashboard

**Stack:** Express.js 4, EJS templates, WebSocket (`ws`), JWT, bcrypt, Stripe

### 4.1 Express Server & Middleware

`src/dashboard/dashboard.js` configures:
- **Helmet** with custom dynamic CSP (built per-request for correct `wss://` derivation behind reverse proxies)
- **CORS** for configured origins
- **Trust proxy** for Render/Docker/Cloudflare deployments
- **Cookie parsing** + session management
- **Rate limiting** via `BoundedMap` (max 5,000 entries, 1h TTL, 60s cleanup cycle)
- **HSTS** in production only
- **Permissions-Policy:** Camera, microphone, geolocation blocked

### 4.2 Authentication & OAuth

- **Discord OAuth2:** Crypto-random `state` for CSRF, server-side token exchange
- **Google OAuth2:** Configurable via environment
- **Username/Password:** bcrypt hashing, brute-force middleware
- **Sessions:** JWT with `jti` (JWT ID) for session invalidation
- **2FA:** TOTP verification before sensitive operations
- **CSRF:** Token-based protection on all write endpoints

### 4.3 REST API Routes

| Route Module | Endpoints |
|-------------|-----------|
| **Auth** | Discord OAuth, login/logout, session check, token refresh, CSRF token |
| **Guild** | List user guilds, get/update config, stats, channels, roles, feature toggles |
| **Settings** | CRUD with `ConfigService` validation, tier enforcement, CSRF |
| **Analytics** | Member stats, message activity, moderation summaries, security events (time-period filtered) |
| **Billing** | Subscription status, plan listing (Free/$0, Pro/$9.99, Enterprise/$29.99) |
| **Moderation** | Warnings, bans, mod-logs, user lookup/history, verification queue, strike management |
| **Backups** | List/manage server backups |
| **Tickets** | Severity levels, SLA deadlines, premium gating, tags, assignees, full-text search, pagination |
| **Unified Admin** | Cross-guild admin operations |

All protected routes use `authenticateToken` + `requireGuildAccess` middleware chain.

### 4.4 Real-Time System (WebSocket)

Three-layer architecture:

1. **AnalyticsCollector** — hooks Discord.js events (`messageCreate`, `guildMemberAdd`, `guildMemberRemove`, custom `modAction`/`securityEvent`/`verificationUpdate`) and pushes structured events per guild.
2. **EventBus** — per-guild event queues, batched and flushed at configurable intervals (250–1000ms). Stores latest guild snapshots for new subscribers. Cross-guild isolation enforced.
3. **WebSocket Handler** — JWT-authenticated connections, per-user connection sets, per-guild subscription maps, 30s heartbeat. Session revocation checked on connect.

### 4.5 Frontend Views

28 EJS/HTML templates:
- Auth: `login.html`, `verify-2fa.html`
- Dashboard: `index-modern.html`, `landing.html`, `console.html`, `logs.html`
- Analytics: `analytics-modern.html` (real-time charts)
- Tickets: `tickets-enhanced.html`
- Setup: 10 per-feature config pages (anti-raid, anti-spam, antinuke, autorole, verification, welcome, goodbye, etc.)
- Utilities: command permissions, access codes, status, updates, web verification, help
- Site pages: 12 public pages (index, features, pricing, security, privacy, terms, etc.)

### 4.6 Billing & Tier Enforcement

**Stripe SDK** integration for checkout sessions. Tiers:

| Tier | Price | Notable Features |
|------|-------|-----------------|
| Free | $0 | Basic protection, 3 protected roles, 1 backup |
| Pro | $9.99/mo | Full security suite, AI features, 25 roles, 10 backups, API access |
| Enterprise | $29.99/mo | Unlimited everything, whitelabel, custom integrations, SLA, priority support |

Subscription state stored in `stripe_subscriptions` + `guild_subscriptions` tables. `requireTier()` Express middleware for plan-gated routes.

---

## 5. Darklock Platform

**Stack:** Express.js, EJS, SQLite3, JWT, bcrypt, speakeasy, Stripe  
**Entry:** `darklock/server.js` — `DarklockPlatform` class, default port 3002

### 5.1 Platform Server

Separate Express app from the bot dashboard. Features:
- Helmet + Cloudflare-aware CSP
- Rate limiting, cookie parsing, CORS
- SSL cert detection for HTTPS
- Accepts optional Discord bot reference (`setBot()`)
- Mounts all route modules, initializes RBAC + admin schemas on startup

### 5.2 Admin v4 Dashboard

Enterprise RBAC admin dashboard mounted at `/api/v4/admin`. Full CRUD for:
- Announcements (create/edit/delete)
- User accounts (CRUD, role assignment)
- Roles (hierarchy management)
- App updates (with `multer` file uploads up to 500MB)
- Bug reports (from users)
- Audit logs (browsing)
- Security settings

JWT cookie auth (`admin_token`) with admin existence + active status validation.

### 5.3 RBAC & Security

**Role Hierarchy:**
| Role | Level |
|------|-------|
| Owner | 100 |
| Co-Owner | 90 |
| Admin | 70 |
| Moderator | 50 |
| Helper | 30 |

Granular permission presets per role. RBAC tables: `roles`, `permissions`, `role_permissions`, `admin_users`.

**Security features:**
- Separate admin JWT secret from user JWT secret (enforced by env validator)
- Secrets must be ≥ 64 characters
- Admin auth rate-limited (5 attempts/15min)
- Anti-enumeration (generic error messages)
- RBAC middleware returns 404 (not 403) for hidden pages
- Request ID tracing for audit correlation
- RFID middleware — optional physical-presence check via hardware RC522 reader (`localhost:5555`)

### 5.4 Premium & Billing

Stripe integration for:
- Checkout session creation
- Webhook handling (subscription events)
- License code redemption
- Premium status lookup

Tier definitions shared between platform and bot.

### 5.5 Maintenance System

Database-driven maintenance mode with:
- **Scoped maintenance**: Can target `platform`, `bot_dashboard`, or both
- **Scheduled maintenance**: Start/end times
- Express middleware blocks requests during maintenance (5s TTL cache)
- Always-allowed paths for health checks and auth
- Public API endpoint for polling maintenance status

**Additional Platform Features:**
- **Team Management:** CRUD for team members with role hierarchy, granular permissions
- **Theme Manager:** CSS theme system with multiple dark themes (Darklock, Midnight Blue, Crimson, etc.)
- **Email Service:** SMTP/SendGrid/AWS SES for welcome, verification, and password reset emails
- **Debug Logger:** Conditional logging controlled by `admin_settings` DB flag

---

## 6. Platform API

**Stack:** TypeScript, Express.js, PostgreSQL (`pg`), Argon2id, JWT, speakeasy  
**Entry:** `platform/api/src/app.ts` — factory function `createApp()`

Next-generation device management and update portal backend.

### Key Features:
- **Auth:** Argon2id password hashing (64MB memory, 3 iterations, 4 parallelism). Registration validation (username 3–32 chars, password ≥10 chars). TOTP 2FA via `speakeasy`.
- **Device Auth:** Separate JWT auth for devices (12h) and servers (1h). Role-based `AuthContext` with `securityProfile`.
- **Dashboard:** User stats (device counts, online/offline, alerts in last 24h), event feeds, paginated logs with search/filter.
- **Releases:** Software release management, filterable by OS, channel, product, version. "Get latest" endpoint per OS/channel.
- **Database:** PostgreSQL connection pool, `withTransaction()` helper (begin/commit/rollback). Sequential SQL migration runner tracking versions in `schema_migrations`.
- **Design System:** "Darklock Cyberpunk Premium" theme — Inter + JetBrains Mono fonts, cyan/purple/pink accent palette on dark backgrounds.

---

## 7. Darklock Secure Notes

**Stack:** React (Vite), Zustand, TypeScript, libsodium-wrappers, Express.js, better-sqlite3, Tauri v2  
**Monorepo:** `darklock-notes/` with `apps/web`, `apps/server`, `apps/desktop`, `packages/crypto`, `packages/ui`

### 7.1 Cryptographic Architecture

Zero-knowledge, end-to-end encrypted. The server **never** sees plaintext.

**Key Derivation:**
- Master password → **Argon2id** (≥19 MiB memory, ≥2 iterations) → 64-byte output
  - First 32 bytes = **encryption key** (never leaves client)
  - Last 32 bytes = **server-auth key** (sent to server, then double-hashed before storage)

**Encryption:**
- **XChaCha20-Poly1305** AEAD with 256-bit keys, 192-bit random nonces
- Versioned `EncryptedEnvelope` format with associated data binding (note ID, content type)

**Key Hierarchy (3 levels):**
1. **RootKey** (password-derived) — wraps ItemKeys
2. **ItemKey** (per-vault/section) — wraps ContentKeys
3. **ContentKey** (per-note) — encrypts note contents

Key wrapping uses AEAD with associated data. Key rotation supported at each level.

**Sharing:**
- **X25519** key exchange with ephemeral keypairs
- `crypto_scalarmult` → shared secret → BLAKE2b-derived symmetric key → XChaCha20-Poly1305 encryption of the item key
- Share metadata bound as associated data
- Server is cryptographically blind to shared content

### 7.2 Web App (React)

Pages/features:
- **SetupWizard:** First-run onboarding — storage mode (cloud vs local-only), master password creation with strength meter
- **UnlockScreen:** Vault unlock via password → key derivation
- **Library:** Section grid, folder browser, quick-access cards (Teams, Charts, Trash, Settings)
- **Workspace:** Three-pane editor — sections → note list → editor. Pin, search, section organization
- **Search:** Client-side full-text search across decrypted notes. No server-side indexing (zero-knowledge)
- **Settings:** 8 tabs — Profile, Editor, Security, Shortcuts, Notifications, Data, Accessibility, Advanced
- **Collaborators:** Team collaboration via invite codes with E2E encrypted sharing via X25519 key exchange
- **Sharing:** Manage shared notes, recipients, permissions (view/edit), revocation. X25519 key-wrapped envelopes
- **Sync:** Device list, conflict detection + resolution, note revisions, recovery tools. Explicit conflict handling (never silent overwrites)
- **Charts:** Built-in chart builder — bar, line, pie, doughnut, area, scatter. Pure SVG/CSS rendering
- **Trash:** View/restore/permanently-delete with search and bulk empty

**State:** Zustand stores  
**Shortcuts:** Command palette (Ctrl+K) with keyboard shortcuts

### 7.3 Sync Server

Express.js zero-knowledge sync server (port 3003). Stores **only** encrypted data.

- **Auth:** Client sends the server-auth half of the Argon2id key. Server double-hashes before storage. Anti-enumeration via deterministic dummy salts (HMAC-SHA256).
- **Notes API:** CRUD for vaults, sections, notes, item keys, content keys, tags, revisions. Zod schema validation on structure only — content is opaque ciphertext.
- **Sync:** Share envelopes (encrypted keys + ephemeral public keys + nonces), pull/push encrypted data.
- **Security:** Strict CSP (`default-src 'none'`), rate limiting (20 auth/15min, 500 API/15min), 5MB body limit.
- **Database:** better-sqlite3 with WAL. Tables: `users`, `sessions`, `vaults`, `sections`, `notes`, `item_keys`, `content_keys`, `tags`, `revisions`, `shares`. Zero plaintext fields.

### 7.4 Desktop App (Tauri)

Tauri v2 wrapper (`com.darklock.notes`). Rust backend with plugins: `tauri-plugin-fs`, `tauri-plugin-shell`, `tauri-plugin-dialog`. Uses `zeroize` for memory-safe secret handling. Window: 1200×800, min 800×600. CSP restricts to self + localhost server.

---

## 8. Secure Channel

**Stack:** Rust (workspace), Node.js (microservices), Tauri v2, SQLite (via sqlx)  
**Location:** `secure-channel/`

Production-grade, self-hosted, end-to-end encrypted messenger. Signal Protocol-inspired.

### Architecture:
Two backend microservices behind Caddy reverse proxy:
- **IDS** (`:4100`): Identity service — user registration, public key storage, device management, prekey bundles
- **RLY** (`:4101`): Relay service — encrypted message routing and delivery

### Rust Crates:

| Crate | Purpose |
|-------|---------|
| `dl_crypto` | X25519, Ed25519, AES-GCM, ChaCha20-Poly1305, BLAKE3, Argon2, HKDF. Implements **X3DH** (Extended Triple Diffie-Hellman) for session establishment, **Double Ratchet** for forward/future secrecy, hash chains for key advancement, hardware unlock integration. |
| `dl_proto` | Protocol types — message, envelope, group, codec, API definitions. Depends on `dl_crypto`. |
| `dl_store` | Encrypted local SQLite storage — vault, DB, models, migrations. Uses `sqlx` + `zeroize`. |

### Desktop App:
Tauri v2 with Vite/TypeScript/Tailwind CSS frontend. Rust backend using workspace crates.

---

## 9. Guard v2

**Stack:** Rust (workspace), Tauri v2  
**Location:** `guard-v2/`

File integrity monitoring and enforcement system.

### Rust Crates:

| Crate | Purpose |
|-------|---------|
| `guard-core` | Content-addressed backup store. Blobs BLAKE3-hashed, optionally zstd-compressed (>4 KiB). Manifest Ed25519-signed. Verified reads. |
| `guard-service` | Background daemon — integrity audit pipeline (`audit_loop.rs`, `pipeline.rs`) and enforcement (quarantine tampered files, restore from signed backups). |
| `guard-cli` | Clap CLI with HMAC-SHA256 IPC auth over Unix sockets. Commands: `status`, `get-settings`, `set-paths`, etc. |

### Desktop App:
Tauri v2 GUI — `guard-v2/desktop/` with components, pages, utils, onboarding. Provides visual interface for file-integrity management.

---

## 10. Hardware / IoT Layer

### 10.1 Pi 5 → Elegoo Mega Bridge

**`hardware_controller.py`** (275 lines): Python bridge on Pi 5. Reads `data/bot_status.json`, sends serial commands (115200 baud) to Elegoo Mega 2560 over USB (`/dev/elegoo`). Controls:
- 2 RGB LEDs (bot status + secondary)
- Tamper-shutdown LED
- RFID scanner indicator LEDs
- 16×2 LCD
- MAX7219 dot matrix display

**`hardware/arduino_bridge.py`** (209 lines): Alternative bridge that also polls systemd service status and checks journalctl for tamper violations.

### 10.2 Pico Microcontroller Firmware

All MicroPython, running on Raspberry Pi Pico / Pico W:

| Firmware | Hardware | Function |
|----------|----------|----------|
| `pico_7segment_display.py` | Pico + 5461AS 4-digit display | Shows guild count via `COUNT:N` serial commands. Non-blocking multiplexing with `select.poll()`. |
| `pico_portable_status.py` | Pico W + 4 LEDs (G/B/R/Y) | Receives status commands (`OK`/`CHECKING`/`DEGRADED`/`FAIL`/`SHUTDOWN`). 15s dead-cable detection fallback. |
| `pico_led_bridge.py` | Pi 5-side bridge | Polls `bot_status.json` every 5s, maps state to LED commands for the Pico. |

**Host-Side Bridges:**
- `pico-bridge.js` (248 lines): Node.js companion for portable Pico. Auto-detects USB port (vendor `2e8a`). Reads status JSON every 3s, applies fail/recover thresholds.

### 10.3 Pico Watchdog (Emergency Failover)

Independent Pico 2 W running MicroPython with `uasyncio`:

- **Monitors** Pi 5 `/health` endpoint every 10s over Wi-Fi
- After 3 consecutive failures → **FALLBACK mode**: serves a lightweight "Servers Offline" HTML page on port 80
- Returns to MONITORING when Pi 5 recovers
- **RGB LED** status: blue (booting), green (healthy), amber (warning), red (down), purple (Wi-Fi lost)
- **Boot:** Wi-Fi connect with optional static IP, WebREPL for remote access
- **Fallback server:** Raw socket HTTP server, pre-built response (< 5 KB), inline CSS only

### 10.4 RFID Security Gateway

**`hardware/rfid_gateway.py`** (343 lines): RC522 RFID reader on Pi 5 SPI bus (`mfrc522`/`SimpleMFRC522`, `rpi-lgpio` for Pi 5). Exposes:
- Unix socket (`/tmp/darklock_rfid.sock`)
- TCP port 9999

Maintains tag allowlist, tracks scan stats, communicates granted/denied to Arduino for LED feedback.

**`hardware/rfid_client.js`**: Node.js IPC client. Connects over Unix socket or TCP, sends JSON commands, 20s timeout.

**Integration with Darklock Platform:** `darklock/middleware/rfid.js` — Express middleware queries the RFID gateway as a physical-presence second factor for admin access.

### 10.5 Bot-Side Hardware Integration

- **`src/hardware/guildCounterDisplay.js`** (51 lines): Streams guild count to Arduino 7-segment display (`COUNT:N\n`). Hooks `guildCreate`/`guildDelete`, refreshes every 5 min.
- **`src/hardware/statusWriter.js`** (106 lines): Writes `data/bot_status.json` every 5s — online flag, guild/user count, ping, uptime, username, host, timestamp. Writes offline status on shutdown. **This file is the data source for all hardware bridges.**

---

## 11. Security Suite

**Location:** `security-suite/`  
Runtime protection system with 6 modules:

| Module | What It Does |
|--------|-------------|
| **Runtime Integrity** | SHA-256 hashes critical Node.js modules at startup, periodically re-checks for in-memory code tampering. |
| **Env Validator** | Validates required env vars exist; captures SHA-256 baseline of sensitive vars and detects runtime mutation. |
| **Process Monitor** | Detects working-directory changes, parent-PID changes (process hijacking), and abnormal memory usage. |
| **Network Monitor** | Logs outgoing network requests; domain whitelist (Discord, Stripe allowed) / blacklist checking. |
| **Auth Auditor** | Tracks auth attempts; auto-locks IPs after 5 failures for 15 minutes; brute-force detection. |
| **Recommender** | Analyzes all module outputs and generates prioritized hardening recommendations (critical/high/medium). |

Config in `security-suite/config/security.json`. Production mode can trigger shutdown on critical violations.

---

## 12. File Tamper Protection

**Location:** `file-protection/`

`TamperProtectionSystem` (entry: `index.js`):
1. Enumerates protected files (tiered by criticality)
2. Validates environment
3. Loads/verifies a **signed baseline** of file SHA-256 hashes
4. Runs startup validation (all hashes match?)
5. Starts filesystem watcher (`fs.watch`) + periodic re-scan timer

**Agent modules** (12 files in `file-protection/agent/`):
- `file-enumerator.js` — discovers protected files
- `baseline-manager.js` / `baseline-generator.js` — signed hash baselines (generated via `npm run tamper:generate`)
- `hasher.js` — SHA-256 file hashing
- `validator.js` — baseline vs. current comparison
- `watcher.js` — `fs.watch` integration for real-time monitoring
- `protector.js` — backup creation (timestamped copies), quarantine of tampered files (as `.evidence`), restore-from-backup with hash verification
- `environment-guard.js` — env validation
- `response-handler.js` — alert and remediation actions
- `anomaly-ai.js` — anomaly detection module
- `constants.js` — paths, intervals
- `protected-files.json` — file list

---

## 13. Cloudflare Worker

**Location:** `cloudflare-worker/worker.js` (339 lines)

Edge-level proxy and failover:
- Proxies requests to Pi 5 origin via Cloudflare Tunnel
- On error codes (502, 503, 522–525, 530) or network errors → serves a branded animated "Servers Offline" maintenance page
- Pure CSS animated background (no client-side JavaScript)
- Includes timestamp and retry messaging

---

## 14. Deployment & Infrastructure

### Docker (`Dockerfile` + `docker-compose.yml`)
- Node 18 on Debian Bullseye slim
- Native deps for canvas, SQLite3
- Non-root `node` user
- Resource limits: 1 GB RAM, 2 CPUs (Pi 5 tuned)
- `no-new-privileges` security option
- JSON-file logging (10 MB × 3 rotation)
- Healthcheck every 30s
- Ports: 3001 (bot dashboard), 3002 (platform)
- Persistent volumes: `data/`, `logs/`, `uploads/`, `file-protection/` config/backups/logs

### Render (`render.yaml`)
- Free-tier web service (Oregon)
- Auto-deploy on push
- 1 GB persistent disk at `/data`
- Health check on `/health`

### Multi-Service Orchestrator (`start-all.sh`)
Starts and monitors 4 services:
1. Discord Bot (`npm start`)
2. Darklock Platform (`node darklock/start.js`)
3. Guard Service Daemon (Rust binary)
4. Darklock Guard UI (Tauri desktop app)

Sequential startup, duplicate-run prevention, health-check status report. Log routing to `logs/` directory.

### Additional Infrastructure:
- **`start-bot.js`:** Smart launcher with hardware watchdog detection
- **`startup.sh`:** System startup script
- **`.github/`:** GitHub Actions CI/CD
- **Cloudflare Tunnel:** Secure ingress without port forwarding

---

## 15. Tech Stack Summary

### Languages
| Language | Where Used |
|----------|-----------|
| **JavaScript (Node.js 18+)** | Discord bot, dashboard, Darklock platform, bridges |
| **TypeScript** | Platform API, Darklock Notes (web + server + crypto), Secure Channel frontend |
| **Rust** | Secure Channel (crypto, protocol, storage), Guard v2 (integrity, backup, CLI), Tauri backends |
| **Python (MicroPython)** | Pico firmware (watchdog, displays, LEDs) |
| **Python (CPython)** | Pi 5 hardware bridges (serial, RFID) |
| **SQL** | SQLite (bot, platform, notes server), PostgreSQL (Platform API) |
| **HTML/CSS/EJS** | Dashboard views, site pages, fallback pages |

### Key Libraries & Frameworks
| Library | Purpose |
|---------|---------|
| discord.js v14 | Discord API client |
| Express.js 4 | HTTP servers (bot, dashboard, platform, notes server, XP) |
| SQLite3 (+ better-sqlite3) | Primary data storage |
| PostgreSQL (pg) | Platform API database |
| libsodium-wrappers | Notes encryption (XChaCha20-Poly1305, Argon2id, X25519) |
| speakeasy + qrcode | TOTP 2FA |
| Stripe SDK | Subscription billing |
| Helmet | HTTP security headers |
| jsonwebtoken + bcrypt | Auth tokens + password hashing |
| Argon2 (argon2id) | Password hashing (Platform API, Notes) |
| ws | WebSocket real-time dashboard |
| canvas + sharp | Rank card image generation |
| serialport | USB serial communication (hardware bridges) |
| openai | Optional AI features (ticket summarization) |
| winston | Structured logging |
| node-cron | Scheduled tasks |
| Zustand | React state management (Notes app) |
| Tauri v2 | Desktop app framework (Notes, Secure Channel, Guard) |
| sqlx | Rust async database (Secure Channel) |
| zeroize | Memory-safe secret handling (Rust) |

### Cryptographic Algorithms Used
| Algorithm | Where | Purpose |
|-----------|-------|---------|
| XChaCha20-Poly1305 | Notes, Secure Channel | AEAD encryption |
| AES-256-GCM | Forensics, Secure Channel | Payload encryption |
| Argon2id | Notes (KDF), Platform API (passwords) | Key derivation, password hashing |
| X25519 | Notes (sharing), Secure Channel (X3DH) | Key exchange |
| Ed25519 | Guard (manifest signing), Secure Channel (identity) | Digital signatures |
| BLAKE2b / BLAKE3 | Notes (KDF), Guard (hashing), Secure Channel (KDF) | Hashing |
| SHA-256 | File tamper protection, forensics, security suite | Integrity verification |
| HMAC-SHA256 | Guard CLI (IPC auth), Notes server (anti-enumeration) | Message authentication |
| HKDF | Secure Channel | Key derivation |
| Double Ratchet | Secure Channel | Forward/future secrecy |
| X3DH | Secure Channel | Session establishment |
| bcrypt | Bot/platform auth | Password hashing |
| TOTP (RFC 6238) | Staff 2FA, admin 2FA, platform 2FA | Time-based one-time passwords |

### Ports
| Port | Service |
|------|---------|
| 3001 | Bot web dashboard |
| 3002 | Darklock platform |
| 3003 | Notes sync server |
| 3005 | XP web leaderboard |
| 3007 | XP dashboard |
| 4100 | Secure Channel IDS |
| 4101 | Secure Channel RLY |
| 5000 | Platform API |
| 5555 | RFID gateway (internal) |
| 9999 | RFID TCP (internal) |
| 80 | Pico watchdog fallback server |

---

*End of audit. This document covers all applications, services, and subsystems in the DarkLock project as of March 2026.*
