# Discord Bot Command System Refactoring

## Overview
This refactoring consolidates ~69 top-level slash commands into **12-15 organized parent commands** using Discord.js v14 subcommands and subcommand groups.

---

## Top-Level Commands (Final Structure)

```
/setup      - Server configuration and onboarding
/mod        - Moderation actions
/security   - Security & protection systems
/ticket     - Ticket management
/case       - Moderation case management
/server     - Server utilities
/userinfo   - User information lookup
/status     - Bot and system status
/help       - Help and documentation
/ping       - Bot latency check
/xp         - XP system (optional)
/announce   - Announcements (optional)
```

---

## Command Mapping

### /setup (Replaces 15+ commands)
**File:** `src/commands/setup.js`

**Subcommands:**
- `start` - Quick setup wizard
- `language` - Set server language
- `verification` - Configure verification system
- `roles` - Auto-role configuration
- `permissions` - Custom permission rules
- `tickets` - Ticket system setup
- `welcome` - Welcome messages
- `goodbye` - Goodbye messages
- `logging` - Audit log configuration

**Consolidates:**
- /wizard
- /serversetup
- /language
- /onboarding
- /verified_setup
- /autorole
- /permissions
- /welcome
- /goodbye

---

### /mod (Replaces 11 commands)
**File:** `src/commands/mod.js` ✅ **IMPLEMENTED**

**Subcommands:**
- `ban` - Ban a user
- `kick` - Kick a user
- `timeout` - Timeout a user
- `warn` - Issue a warning
- `strike` - Issue a strike
- `purge` - Bulk delete messages
- `slowmode` - Set channel slowmode
- `lock` - Lock a channel
- `unlock` - Unlock a channel
- `unban` - Unban a user
- `redact` - Delete a specific message

**Consolidates:**
- /ban
- /kick
- /timeout
- /warn
- /strike
- /purge
- /slowmode
- /lock
- /unlock
- /unban
- /redact

---

### /security (Replaces 18+ commands)
**File:** `src/commands/security.js` ✅ **IMPLEMENTED**

**Subcommand Groups:**

#### antiraid
- `enable` - Enable anti-raid
- `disable` - Disable anti-raid
- `status` - View configuration
- `config` - Adjust thresholds

#### antispam
- `enable` - Enable anti-spam
- `disable` - Disable anti-spam
- `status` - View configuration
- `config` - Adjust limits

#### phishing
- `enable` - Enable anti-phishing
- `disable` - Disable anti-phishing
- `status` - View configuration
- `scan` - Scan a URL

#### automod
- `enable` - Enable automod
- `disable` - Disable automod
- `status` - View configuration
- `config` - Configure filters

#### lockdown
- `on` - Activate lockdown
- `off` - Deactivate lockdown
- `status` - Check status

#### quarantine
- `add` - Quarantine user
- `remove` - Release user
- `list` - List quarantined
- `config` - Configure auto-quarantine

#### audit
- `summary` - Security overview
- `incidents` - Recent incidents
- `permissions` - Audit dangerous permissions

**Consolidates:**
- /anti-raid
- /anti-spam
- /anti-phishing
- /anti-links
- /automod
- /lockdown
- /unlockdown
- /quarantine
- /altdetect
- /antinuke
- /security
- /status (security-related)
- /rolescan
- /webhookprotect
- /verification
- /wordfilter

---

### /ticket (Replaces 6+ commands)
**File:** `src/commands/ticket.js`

**Subcommands:**
- `open` - Open a new ticket
- `close` - Close a ticket
- `claim` - Claim a ticket
- `transfer` - Transfer to another staff
- `panel` - Create ticket panel
- `settings` - Configure ticket system

**Consolidates:**
- /ticket (old)
- /ticketpanel
- /ticketsetup
- /closeticket
- /claimticket

---

### /case (Replaces 5+ commands)
**File:** `src/commands/case.js`

**Subcommands:**
- `view` - View a case
- `list` - List all cases for a user
- `note` - Add note to case
- `appeal` - Submit appeal
- `resolve` - Resolve a case

**Consolidates:**
- /cases
- /appeal
- /modnote
- /viewcase

---

### /server (Replaces 8+ commands)
**File:** `src/commands/server.js`

**Subcommands:**
- `info` - Server information
- `stats` - Server statistics
- `backup` - Create server backup
- `restore` - Restore from backup
- `emoji` - Emoji management
- `sticker` - Sticker management
- `channels` - Channel management

**Consolidates:**
- /serverinfo
- /serverstats
- /serverbackup
- /admin (channel/emoji management parts)
- /console

---

### /xp (Optional, Replaces 5+ commands)
**File:** `src/commands/xp.js`

**Subcommands:**
- `rank` - View your rank
- `leaderboard` - Server leaderboard
- `set` - Set user XP (admin)
- `add` - Add XP (admin)
- `remove` - Remove XP (admin)
- `config` - Configure XP system

**Consolidates:**
- /rank
- /leaderboard
- /xp (old)

---

### Keep As-Is (Simple Commands)
These remain standalone:
- `/userinfo` - User information lookup
- `/status` - Bot status
- `/help` - Help system
- `/ping` - Latency check
- `/announce` - Announcements

---

## Recommended Folder Structure

```
src/commands/
├── setup.js          # /setup command (all subcommands)
├── mod.js            # /mod command ✅
├── security.js       # /security command ✅
├── ticket.js         # /ticket command
├── case.js           # /case command
├── server.js         # /server command
├── xp.js             # /xp command (optional)
├── userinfo.js       # /userinfo standalone
├── status.js         # /status standalone
├── help.js           # /help standalone
├── ping.js           # /ping standalone
└── announce.js       # /announce standalone (optional)

# ARCHIVED (keep for reference during migration):
src/commands/admin/      # OLD commands (deprecate after migration)
src/commands/moderation/ # OLD commands
src/commands/security/   # OLD commands
src/commands/utility/    # OLD commands
```

---

## Command Loader Update

**File:** `src/bot.js`

### Current Implementation
```javascript
async loadCommands() {
    this.logger.info('📂 Loading commands...');
    
    const commandsPath = path.join(__dirname, 'commands');
    const commandFolders = ['admin', 'moderation', 'security', 'utility'];
    
    for (const folder of commandFolders) {
        const folderPath = path.join(commandsPath, folder);
        if (!fs.existsSync(folderPath)) continue;
        
        const commandFiles = fs.readdirSync(folderPath)
            .filter(file => file.endsWith('.js'));
        
        for (const file of commandFiles) {
            const command = require(path.join(folderPath, file));
            if (command.data && command.execute) {
                this.commands.set(command.data.name, command);
                this.logger.info(`   ✅ Loaded command: ${command.data.name}`);
            }
        }
    }
}
```

### New Implementation (Refactored)
```javascript
async loadCommands() {
    this.logger.info('📂 Loading commands...');
    
    const commandsPath = path.join(__dirname, 'commands');
    if (!fs.existsSync(commandsPath)) {
        fs.mkdirSync(commandsPath, { recursive: true });
        return;
    }

    // Load only top-level command files
    const commandFiles = fs.readdirSync(commandsPath)
        .filter(file => file.endsWith('.js') && !file.includes('.old'));
    
    for (const file of commandFiles) {
        try {
            const filePath = path.join(commandsPath, file);
            const command = require(filePath);
            
            // Skip deprecated commands
            if (command.deprecated) {
                this.logger.warn(`   ⚠️  Skipping deprecated: ${file} (use ${command.newCommand})`);
                continue;
            }
            
            // Validate command structure
            if (!command.data || !command.execute) {
                this.logger.warn(`   ⚠️  Invalid command structure: ${file}`);
                continue;
            }
            
            // Prevent duplicate registrations
            const commandName = command.data.name;
            if (this.commands.has(commandName)) {
                this.logger.warn(`   ⚠️  Duplicate command: ${commandName} (skipping)`);
                continue;
            }
            
            this.commands.set(commandName, command);
            this.logger.info(`   ✅ ${commandName}`);
            
        } catch (error) {
            this.logger.error(`   ❌ Failed to load ${file}:`, error);
        }
    }
    
    this.logger.info(`📋 Loaded ${this.commands.size} commands`);
}
```

---

## Migration Strategy

### Phase 1: Create New Commands ✅
- [x] Create `/security` command with all subcommand groups
- [x] Create `/mod` command with all subcommands
- [ ] Create `/setup` command
- [ ] Create `/ticket` command
- [ ] Create `/case` command
- [ ] Create `/server` command
- [ ] Create `/xp` command

### Phase 2: Update Command Loader
- [ ] Update `src/bot.js` to use new loader logic
- [ ] Add deprecation warnings for old commands
- [ ] Test new command registration

### Phase 3: Deprecate Old Commands
- [ ] Mark old commands with `deprecated: true` flag
- [ ] Add `newCommand` property to show migration path
- [ ] Update help system to show new command structure

### Phase 4: Testing
- [ ] Test all new commands in development
- [ ] Verify permission checks work correctly
- [ ] Test subcommand routing
- [ ] Ensure database integration works

### Phase 5: Deploy & Cleanup
- [ ] Deploy to production
- [ ] Monitor for issues
- [ ] Remove old command files after 30 days
- [ ] Update documentation

---

## Key Implementation Notes

### 1. Subcommand Groups
- Maximum 25 subcommands per command
- Maximum 25 subcommand groups per command
- Maximum 25 subcommands per group
- Cannot mix subcommands and subcommand groups

### 2. Permission Gating
```javascript
// Set default permissions at command level
.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

// Check permissions in execute()
if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '❌ Insufficient permissions', ephemeral: true });
}
```

### 3. Routing Pattern
```javascript
async execute(interaction, bot) {
    const group = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();
    
    if (group) {
        // Route to group handler
        switch (group) {
            case 'antiraid': return await this.handleAntiRaid(interaction, bot, subcommand);
            // ...
        }
    } else {
        // Direct subcommand
        switch (subcommand) {
            case 'ban': return await this.handleBan(interaction, bot);
            // ...
        }
    }
}
```

### 4. Error Handling
```javascript
try {
    // Command logic
} catch (error) {
    bot.logger.error('[Command] Error:', error);
    
    const errorMsg = { content: '❌ An error occurred.', ephemeral: true };
    
    if (interaction.replied) {
        return interaction.followUp(errorMsg);
    } else if (interaction.deferred) {
        return interaction.editReply(errorMsg);
    } else {
        return interaction.reply(errorMsg);
    }
}
```

---

## Benefits of This Refactoring

1. **Reduced Command Clutter**: From ~69 commands to ~12-15
2. **Better Organization**: Logical grouping by function
3. **Easier Discovery**: Users can explore subcommands naturally
4. **Professional Appearance**: Enterprise-grade command structure
5. **Maintainability**: Centralized logic per command category
6. **Scalability**: Easy to add new subcommands without cluttering namespace

---

## Discord.js v14 Best Practices

### ✅ DO:
- Use `PermissionFlagsBits` for permissions
- Set `defaultMemberPermissions` on commands
- Use embeds for rich responses
- Defer replies for long operations
- Handle errors gracefully
- Log important actions to database

### ❌ DON'T:
- Mix subcommands and subcommand groups in same command
- Exceed 25 subcommands/groups limit
- Use spaces or special characters in command names
- Register duplicate commands
- Forget permission checks in handlers
- Leave deprecated commands active

---

## Next Steps

1. **Review** this document and the example implementations
2. **Create** remaining command files following the pattern
3. **Update** the command loader in `src/bot.js`
4. **Test** each command thoroughly
5. **Deploy** to production with monitoring
6. **Deprecate** old commands after validation

---

## Support & Questions

If you encounter issues during migration:
1. Check command structure matches examples
2. Verify subcommand/group limits not exceeded
3. Ensure permissions are set correctly
4. Review Discord.js v14 documentation
5. Test in development guild before production deploy
