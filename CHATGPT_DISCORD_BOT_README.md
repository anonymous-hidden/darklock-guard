# ChatGPT Discord Bot Handoff

This document is the working reference for ChatGPT when operating on the Discord bot portion of this repository only.

It intentionally focuses on the Discord bot, the dashboard that ships with it, and the command surface that the bot currently exposes. Ignore the other apps in this repo unless the user explicitly asks for them.

## What This Bot Is

This is a large Discord security and community management bot built on `discord.js` and Node.js. It is centered on `src/bot.js`, which loads the command system, security services, moderation tools, ticketing, XP/levels, dashboards, and supporting services.

The bot is not a tiny command handler. It is a multi-service application with:

- Discord gateway client and slash commands
- Moderation and safety systems
- Auto-moderation and anti-raid protection
- Ticketing and support workflows
- XP / rank / leaderboard features
- Server setup and configuration flows
- Dashboard and web UI integration
- Anti-tamper / file integrity checks

## Current State

Current repo state is actively developed and somewhat hybrid:

- The bot core is in `src/bot.js`.
- Slash command loading is constrained by `src/core/command-allowlist.js`.
- Unified commands like `/setup`, `/security`, `/mod`, `/automod`, and `/ticket` are the primary user-facing surfaces.
- Older commands still exist as deprecated aliases or compatibility paths.
- Security and moderation features are the main supported workload.
- `src/commands/handlers/` contains shared logic used by the unified setup flows.
- The bot uses environment validation and anti-tamper preflight checks before login.

Important runtime notes:

- The bot expects a valid Discord token and related secrets from `.env` / environment variables.
- `.env.example` is the reference for required configuration values; do not store secrets in docs.
- The bot can skip strict env validation in CI/hosting contexts or when `SKIP_ENV_VALIDATION=1` is set.
- File integrity checks exist under `file-protection/` and the bot will refuse to start if the manifest does not match.

## How The Bot Starts

Main entrypoints and scripts:

- `npm start` → `node src/bot.js`
- `npm run dev` → `nodemon src/bot.js`
- `npm run setup` → environment/bootstrap helper
- `npm run security:check` → `npm audit --audit-level=moderate`

Startup flow in `src/bot.js`:

1. Load environment variables.
2. Run env sanitization and validation.
3. Initialize anti-tamper protection.
4. Initialize database and logger.
5. Load security modules and utility modules.
6. Register events.
7. Register slash commands.
8. Log into Discord.

If you need the source of truth for startup behavior, read `src/bot.js` first.

## Bot Command Philosophy

The command system is intentionally consolidated:

- `setup` handles server configuration.
- `security` handles protection and incident response.
- `automod` handles the faster auto-moderation knobs.
- `mod` handles moderation actions.
- `ticket` / `ticket-new` handle support workflows.
- `admin` handles higher-risk server administration.
- `help` presents the user-facing command catalog and support ticket entry point.

There are also deprecated command names kept for compatibility. The allowlist in `src/core/command-allowlist.js` is the active loading policy.

## Command Reference

This is the current bot command surface as reflected in the repo.

### 1. Moderation

Top-level command: `/mod`

Purpose: direct moderation actions for staff.

Subcommands:

- `/mod ban` - Ban a member, optionally with message deletion days and a reason.
- `/mod kick` - Kick a member with a reason.
- `/mod timeout` - Timeout a member for a duration in minutes.
- `/mod warn` - Store a warning case for a member.
- `/mod strike` - Store a strike with severity.
- `/mod purge` - Bulk delete messages, optionally filtered by user or bot messages.
- `/mod slowmode` - Set channel slowmode.
- `/mod lock` - Lock a channel.
- `/mod unlock` - Unlock a channel.
- `/mod unban` - Unban a user by ID.
- `/mod redact` - Delete a specific message by ID.

Behavior notes:

- Most actions write moderation case records to the bot database.
- Permission checks are enforced per action.
- This command is the modern replacement for many older moderation commands.

### 2. Security

Top-level command: `/security`

Purpose: security configuration, incident response, quarantine, and auditing.

Subcommand groups:

- `/security antiraid enable|disable|status|config`
- `/security antispam enable|disable|status|config`
- `/security phishing enable|disable|status|scan`
- `/security automod enable|disable|status|config`
- `/security lockdown on|off|status`
- `/security quarantine add|remove|list|config`
- `/security audit summary|incidents|permissions`

Behavior notes:

- Requires `Manage Server` / elevated moderation privileges.
- This is the high-level wrapper around the older security command set.
- Use this when you want a full security overview instead of one-off toggles.

### 3. Auto-Moderation

Top-level command: `/automod`

Purpose: unified controls for spam, raid, links, phishing, and emoji spam.

Subcommand groups:

- `/automod status`
- `/automod spam on|off|config`
- `/automod raid on|off|config`
- `/automod links on|off|config`
- `/automod phishing on|off|scan`
- `/automod emoji on|off|config`

Behavior notes:

- This command is marked premium-pro in the code.
- It consolidates older `anti-*` commands into one place.
- Thresholds are configurable for spam and raid behavior.

### 4. Setup / Server Configuration

Top-level command: `/setup`

Purpose: one command for almost all server configuration.

Known subcommands and groups:

- `/setup view` - show current configuration.
- `/setup wizard start|restart|cancel|status` - interactive setup flow.
- `/setup onboarding enable|disable|status|channel|message|test` - verification/onboarding settings.
- `/setup welcome setup|disable|customize|test|status` - welcome message configuration.
- `/setup goodbye setup|disable|customize|test|status` - goodbye message configuration.
- `/setup roles add|remove|list` - auto-role assignment.
- `/setup permissions set-group|set-command|list|clear` - permission routing.
- `/setup language set|current|list` - language selection.

Behavior notes:

- Admin-only command.
- This is the main configuration hub now; older command names are mostly compatibility paths.
- Shared handlers live in `src/commands/handlers/`.

### 5. Admin

Top-level command: `/admin`

Purpose: higher-risk server administration and destructive controls.

Common admin-related capabilities in the repo:

- Emergency controls such as lockdown and unlock flows.
- Server bootstrap and server setup workflows.
- Role / permission management helpers.
- XP administration.
- Voice monitoring and setup tools.

Treat admin actions as sensitive. They often require administrator-level permissions.

### 6. Ticketing

Top-level commands: `/ticket` and `/ticket-new`

Purpose: support ticket creation and lifecycle management.

`/ticket` supports:

- create
- close
- add
- remove
- claim
- transfer
- priority
- tag
- transcript
- stats
- setup
- reopen
- note
- blacklist
- lock
- unlock
- rename
- flag

Behavior notes:

- Ticket creation is rate-limited.
- A user can only open a limited number of active tickets.
- Staff/admin checks are enforced.
- Ticket data is stored in bot-managed database tables and config records.

`/ticket-new` is the newer unified ticket surface and is listed in the allowlist.

### 7. Utility / General Commands

Common utility commands present in the repo include:

- `/help` - command browser and support menu.
- `/ping` - latency check.
- `/serverinfo` - server details.
- `/userinfo` - user details.
- `/rank` - personal XP / rank card.
- `/leaderboard` - server XP leaderboard.
- `/analytics` - server analytics summary.
- `/invites` - invite analytics and leaderboard.
- `/schedule` - event / reminder scheduling.
- `/announce` - send announcement embed.
- `/poll` - create a poll.
- `/auditlog` - audit logging view.
- `/trustscore` - trust/risk summary.
- `/welcome` - welcome configuration helper.
- `/goodbye` - goodbye configuration helper.
- `/selfrole` - self-service role assignment.
- `/embed` - embed helper.
- `/fun` - fun/utility command bucket.

The help command currently exposes category-focused navigation for moderation, security, setup, utility, leveling, and tickets.

## Deprecated And Compatibility Commands

These names are still supported in various forms, but the repo prefers the unified commands above:

- `anti-phishing`
- `anti-raid`
- `anti-spam`
- `anti-links`
- `emojispam`
- `lockdown`
- `unlockdown`
- `server`
- `rolescan`
- `wizard`
- `onboarding`
- `verified_setup`
- `autorole`
- `permissions`
- `language`
- `welcome`
- `goodbye`
- `ticket`
- `ticket-manage`
- `reactionrole`
- `verification`
- `embed`
- `selfrole`
- `modmail`
- `webhookprotect`

When ChatGPT is reasoning about the codebase, prefer the unified commands and treat these as compatibility or migration surfaces.

## Important Files For Bot Logic

If you need to understand the current bot behavior quickly, these are the first files to inspect:

- `src/bot.js` - main runtime, loaders, services, event wiring.
- `src/core/command-allowlist.js` - which commands are allowed to load.
- `src/commands/mod.js` - moderation routing and case writes.
- `src/commands/security.js` - security/automod/quarantine/audit routing.
- `src/commands/admin/setup.js` - server configuration hub.
- `src/commands/utility/help.js` - user-facing command catalog.
- `src/commands/utility/ticket-new.js` - ticket flow.
- `src/commands/handlers/` - shared setup handlers.
- `src/security/` - protection systems.
- `src/utils/` - tickets, analytics, permissions, logging, rank, backup.
- `src/dashboard/dashboard.js` - bot dashboard server.
- `file-protection/` - anti-tamper manifest and integrity enforcement.

## Data And State

The bot uses a mix of database and file-backed state:

- Discord moderation case data is stored in the bot database layer.
- XP/rank data is stored in the XP database layer.
- Ticket state is persisted in bot-managed ticket storage.
- Security settings live in guild configuration tables / services.
- File protection stores integrity metadata under `file-protection/`.
- There is a separate `data/` area used by runtime features and integrations.

When making changes, do not assume one database contains everything. The bot is split across multiple stores.

## Environment Variables

The exact keys are documented in `.env.example`. Common required categories include:

- Discord token / client secret
- Dashboard and session secrets
- Stripe keys for billing features
- OAuth keys for integrations
- Security / internal API keys

Do not place real secret values in this README.

## Operational Constraints

- Respect the allowlist before assuming a command exists.
- Treat moderation, security, ticket closure, lockdown, and role changes as privileged operations.
- Keep edits focused: this repo has many moving parts, but the Discord bot should remain the target unless the user explicitly asks for another subsystem.
- If a command is not in the allowlist, assume it is deprecated or intentionally blocked.
- If a feature seems missing, check the command module, the shared handler, and the allowlist before changing behavior.

## Quick Mental Model For ChatGPT

When asked about this repo, answer from this hierarchy:

1. `src/bot.js` for runtime and wiring.
2. `src/core/command-allowlist.js` for what loads.
3. `src/commands/` for command behavior.
4. `src/security/` for protection logic.
5. `src/utils/` for support systems.
6. `src/dashboard/` if the question touches the bot dashboard.

If you need one sentence for the bot: it is a Discord security and community management bot with consolidated moderation, security, setup, tickets, analytics, and leveling commands.