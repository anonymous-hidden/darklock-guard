# Command Migration Map - Before → After

## Security Commands

| Old Command | New Command |
|-------------|-------------|
| `/anti-raid on` | `/security antiraid enable` |
| `/anti-raid off` | `/security antiraid disable` |
| `/anti-raid status` | `/security antiraid status` |
| `/anti-raid settings` | `/security antiraid config` |
| `/anti-spam on` | `/security antispam enable` |
| `/anti-spam off` | `/security antispam disable` |
| `/anti-spam status` | `/security antispam status` |
| `/anti-phishing on` | `/security phishing enable` |
| `/anti-phishing off` | `/security phishing disable` |
| `/anti-phishing scan` | `/security phishing scan` |
| `/anti-links` | `/security automod config filter_links:true` |
| `/automod` | `/security automod enable` |
| `/lockdown` | `/security lockdown on` |
| `/unlockdown` | `/security lockdown off` |
| `/quarantine` | `/security quarantine add` |
| `/altdetect` | `/security quarantine config auto_alts:true` |
| `/antinuke` | `/security audit permissions` |
| `/rolescan` | `/security audit permissions` |
| `/webhookprotect` | `/security audit summary` |
| `/wordfilter` | `/security automod config` |

**Total Consolidated: ~18 commands → 1 command (/security)**

---

## Moderation Commands

| Old Command | New Command |
|-------------|-------------|
| `/ban` | `/mod ban` |
| `/kick` | `/mod kick` |
| `/timeout` | `/mod timeout` |
| `/warn` | `/mod warn` |
| `/strike` | `/mod strike` |
| `/purge` | `/mod purge` |
| `/slowmode` | `/mod slowmode` |
| `/lock` | `/mod lock` |
| `/unlock` | `/mod unlock` |
| `/unban` | `/mod unban` |
| `/redact` | `/mod redact` |

**Total Consolidated: 11 commands → 1 command (/mod)**

---

## Setup/Configuration Commands

| Old Command | New Command |
|-------------|-------------|
| `/wizard` | `/setup start` |
| `/serversetup` | `/setup start` |
| `/language` | `/setup language` |
| `/onboarding` | `/setup verification` |
| `/verified_setup` | `/setup verification` |
| `/autorole` | `/setup roles` |
| `/permissions` | `/setup view` |
| `/welcome` | `/setup welcome` |
| `/goodbye` | `/setup goodbye` |

**Total Consolidated: ~9 commands → 1 command (/setup)**

---

## Ticket Commands (TODO)

| Old Command | New Command |
|-------------|-------------|
| `/ticket` | `/ticket open` |
| `/ticketpanel` | `/ticket panel` |
| `/closeticket` | `/ticket close` |
| `/claimticket` | `/ticket claim` |
| `/transferticket` | `/ticket transfer` |
| `/ticketsetup` | `/ticket settings` |

**Total Consolidated: ~6 commands → 1 command (/ticket)**

---

## Case Management Commands (TODO)

| Old Command | New Command |
|-------------|-------------|
| `/cases` | `/case list` |
| `/viewcase` | `/case view` |
| `/appeal` | `/case appeal` |
| `/modnote` | `/case note` |
| `/resolvecase` | `/case resolve` |

**Total Consolidated: ~5 commands → 1 command (/case)**

---

## Server Utility Commands (TODO)

| Old Command | New Command |
|-------------|-------------|
| `/serverinfo` | `/server info` |
| `/serverstats` | `/server stats` |
| `/serverbackup` | `/server backup` |
| `/admin nuke` | `/server channels nuke` |
| `/console` | `/server console` |

**Total Consolidated: ~5 commands → 1 command (/server)**

---

## XP Commands (TODO - Optional)

| Old Command | New Command |
|-------------|-------------|
| `/rank` | `/xp rank` |
| `/leaderboard` | `/xp leaderboard` |
| `/setxp` | `/xp set` |
| `/addxp` | `/xp add` |
| `/removexp` | `/xp remove` |

**Total Consolidated: ~5 commands → 1 command (/xp)**

---

## Standalone Commands (Keep As-Is)

| Command | Purpose |
|---------|---------|
| `/userinfo` | User information lookup |
| `/status` | Bot status and uptime |
| `/help` | Help documentation |
| `/ping` | Check bot latency |
| `/announce` | Server announcements |

**Total: 5 standalone commands**

---

## Summary

### Before Refactoring
- **Total Commands**: ~69 top-level slash commands
- **User Experience**: Overwhelming, hard to discover
- **Organization**: Flat namespace, no grouping

### After Refactoring
- **Total Commands**: 12-15 top-level slash commands
- **User Experience**: Clean, organized, discoverable
- **Organization**: Hierarchical with logical grouping

### Reduction
**~69 commands → ~12 commands = 82% reduction in command clutter**

### Functionality
**All features preserved - Zero functionality lost**

---

## Migration Timeline

1. ✅ **Phase 1** - Create core commands (security, mod, setup)
2. **Phase 2** - Create remaining commands (ticket, case, server, xp)
3. **Phase 3** - Mark old commands as deprecated
4. **Phase 4** - Update help system and documentation
5. **Phase 5** - Production testing
6. **Phase 6** - Remove deprecated commands after 30 days
