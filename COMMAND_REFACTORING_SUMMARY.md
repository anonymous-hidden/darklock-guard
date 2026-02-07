# Command System Refactoring - Quick Reference

## ✅ Completed (Commit: 389a74c)

### New Commands Created
1. **`/security`** - 7 subcommand groups, 25+ subcommands
2. **`/mod`** - 11 moderation subcommands  
3. **`/setup`** - 9 configuration subcommands

### Updated Infrastructure
- **Command Loader** - Prevents duplicates, handles deprecation
- **Bot.js** - Prioritizes new command structure

---

## 📋 Command Structure Examples

### /security Usage
```
/security antiraid enable
/security antiraid disable
/security antiraid status
/security antiraid config threshold:15

/security antispam enable
/security antispam config message_limit:10

/security phishing scan url:https://example.com

/security automod enable
/security automod config filter_profanity:true

/security lockdown on mode:full reason:"Emergency"
/security lockdown off

/security quarantine add user:@BadActor reason:"Suspicious"
/security quarantine list

/security audit summary
/security audit incidents limit:20
```

### /mod Usage
```
/mod ban user:@User reason:"Spam" delete_days:7
/mod kick user:@User reason:"Warning"
/mod timeout user:@User duration:60 reason:"Spam"
/mod warn user:@User reason:"Language"
/mod strike user:@User reason:"Violation" severity:2

/mod purge amount:50
/mod purge amount:100 user:@User
/mod purge amount:50 bots:true

/mod slowmode seconds:30
/mod lock channel:#general reason:"Raid"
/mod unlock channel:#general

/mod unban user_id:123456789 reason:"Appeal approved"
/mod redact message_id:987654321 reason:"Policy violation"
```

### /setup Usage
```
/setup start
/setup language lang:en

/setup verification enabled:true channel:#verify verified_role:@Verified
/setup roles role:@Member on_join:true

/setup welcome enabled:true channel:#welcome message:"Welcome {user}!"
/setup goodbye enabled:true channel:#goodbye

/setup tickets enabled:true category:Tickets staff_role:@Staff
/setup logging channel:#logs log_moderation:true log_joins:true

/setup view
```

---

## 🎯 Key Features

### Subcommand Groups
- `/security` uses groups (antiraid, antispam, phishing, etc.)
- Each group has multiple subcommands (enable, disable, status, config)
- Maximum organization and scalability

### Permission Gating
```javascript
// Command-level default permission
.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

// Runtime permission check
if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '❌ Insufficient permissions', ephemeral: true });
}
```

### Handler Pattern
```javascript
async execute(interaction, bot) {
    const group = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();
    
    switch (group) {
        case 'antiraid': return await this.handleAntiRaid(interaction, bot, subcommand);
        // ...
    }
}
```

---

## 🚀 Next Steps

### Remaining Commands to Create
1. **`/ticket`** - Ticket management (open, close, claim, transfer, panel, settings)
2. **`/case`** - Moderation cases (view, list, note, appeal, resolve)
3. **`/server`** - Server utilities (info, stats, backup, restore)
4. **`/xp`** - XP system (rank, leaderboard, config)

### Keep As-Is
- `/userinfo` - Simple standalone
- `/status` - Simple standalone
- `/help` - Simple standalone
- `/ping` - Simple standalone

### Deprecation Phase
Mark old commands with:
```javascript
module.exports = {
    deprecated: true,
    newCommand: '/security antiraid',
    data: new SlashCommandBuilder()
        .setName('anti-raid')
        .setDescription('⚠️ MOVED → Use /security antiraid instead')
    // ...
};
```

---

## 📊 Impact

### Before
- 69 top-level slash commands
- Overwhelming `/` command list
- Hard to discover features
- Cluttered namespace

### After
- 12-15 top-level commands
- Organized by category
- Easy feature discovery
- Professional appearance
- Enterprise-grade structure

---

## 🔧 Testing Checklist

- [ ] Test `/security` all subcommand groups
- [ ] Test `/mod` all subcommands  
- [ ] Test `/setup` configuration flow
- [ ] Verify permission checks work
- [ ] Test database interactions
- [ ] Check error handling
- [ ] Validate embed formatting
- [ ] Test in production-like environment

---

## 📚 Documentation

Full guide: `COMMAND_REFACTORING_GUIDE.md`

Example files:
- `src/commands/security.js` - Subcommand groups pattern
- `src/commands/mod.js` - Simple subcommands pattern
- `src/commands/setup.js` - Configuration pattern
