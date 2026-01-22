/**
 * Guild Create Event Handler
 * Handles bot being added to a new server
 */

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'guildCreate',
    once: false,
    async execute(guild, bot) {
        try {
            bot.logger.info(`✅ Bot added to new server: ${guild.name} (${guild.id})`);
            
            // Initialize guild configuration
            if (bot.database) {
                await bot.database.getGuildConfig(guild.id);
            }
            
            // Send comprehensive DM guide to server owner
            try {
                const owner = await guild.fetchOwner();
                
                const welcomeEmbeds = createWelcomeEmbeds(guild, bot.client);
                
                // Send all embeds to owner
                for (const embed of welcomeEmbeds) {
                    await owner.send({ embeds: [embed] });
                }

                bot.logger.info(`📧 Sent welcome guide to ${owner.user.tag}`);
            } catch (dmError) {
                bot.logger.error('Could not send DM to server owner:', dmError);
                // Fallback: send basic message in server
            }
            
            // Send welcome message in server channel
            const welcomeEmbed = new EmbedBuilder()
                .setTitle('🛡️ DarkLock is now online!')
                .setDescription(`
Thank you for adding me to **${guild.name}**!

I'm performing an **initial security scan** and **automatic backup** of your server. This will complete in a few minutes.

**Server owner:** Check your DMs for a complete feature guide!
**Quick start:** Use \`/wizard\` to configure the bot
**Server setup:** Use \`/serversetup\` to create a complete server structure
                `)
                .setColor('#00d4ff')
                .addFields(
                    { name: '🔧 Setup', value: '`/wizard` or `/setup`', inline: true },
                    { name: '❓ Help', value: '`/help`', inline: true },
                    { name: '🌐 Dashboard', value: process.env.DASHBOARD_URL || 'See DM', inline: true }
                )
                .setTimestamp();

            const firstChannel = guild.channels.cache.find(c => 
                c.type === 0 && 
                c.permissionsFor(guild.members.me).has(PermissionFlagsBits.SendMessages)
            );

            if (firstChannel) {
                await firstChannel.send({ embeds: [welcomeEmbed] });
            }

            // Start comprehensive initial scan and backup in background
            setTimeout(async () => {
                try {
                    const scanResults = await performInitialScan(guild, bot);
                    const backupResult = await createInitialBackup(guild, bot);
                    
                    // Send scan report to owner
                    await sendScanReport(guild, bot, scanResults, backupResult);
                    
                    bot.logger.info(`✅ Initial scan and backup complete for ${guild.name}`);
                } catch (error) {
                    bot.logger.error('Error during initial scan/backup:', error);
                }
            }, 5000); // Wait 5 seconds before starting
            
        } catch (error) {
            bot.logger.error('Error in guildCreate handler:', error);
        }
    }
};

/**
 * Perform comprehensive initial scan of the server
 */
async function performInitialScan(guild, bot) {
    const results = {
        roles: { total: 0, adminRoles: [], dangerousPerms: [] },
        channels: { total: 0, categories: 0, text: 0, voice: 0, forums: 0 },
        members: { total: 0, bots: 0, admins: 0 },
        security: { threats: [], warnings: [], recommendations: [] },
        timestamp: new Date().toISOString()
    };

    try {
        // Scan roles
        results.roles.total = guild.roles.cache.size;
        for (const [id, role] of guild.roles.cache) {
            if (role.permissions.has(PermissionFlagsBits.Administrator)) {
                results.roles.adminRoles.push({ name: role.name, id: role.id, memberCount: role.members.size });
            }
            if (role.permissions.has(PermissionFlagsBits.BanMembers) || 
                role.permissions.has(PermissionFlagsBits.KickMembers) ||
                role.permissions.has(PermissionFlagsBits.ManageGuild)) {
                results.roles.dangerousPerms.push({ 
                    name: role.name, 
                    id: role.id,
                    perms: []
                        .concat(role.permissions.has(PermissionFlagsBits.BanMembers) ? ['Ban'] : [])
                        .concat(role.permissions.has(PermissionFlagsBits.KickMembers) ? ['Kick'] : [])
                        .concat(role.permissions.has(PermissionFlagsBits.ManageGuild) ? ['ManageGuild'] : [])
                });
            }
        }

        // Scan channels
        results.channels.total = guild.channels.cache.size;
        for (const [id, channel] of guild.channels.cache) {
            if (channel.type === 4) results.channels.categories++;
            else if (channel.type === 0 || channel.type === 5) results.channels.text++;
            else if (channel.type === 2 || channel.type === 13) results.channels.voice++;
            else if (channel.type === 15) results.channels.forums++;
        }

        // Scan members (basic count - full fetch would be too slow)
        results.members.total = guild.memberCount;
        results.members.bots = guild.members.cache.filter(m => m.user.bot).size;
        results.members.admins = guild.members.cache.filter(m => m.permissions.has(PermissionFlagsBits.Administrator)).size;

        // Security analysis
        if (results.roles.adminRoles.length > 5) {
            results.security.warnings.push(`⚠️ High number of admin roles (${results.roles.adminRoles.length})`);
        }
        if (guild.verificationLevel === 0) {
            results.security.warnings.push('⚠️ Server verification level is set to None');
            results.security.recommendations.push('Enable server verification level in Server Settings');
        }
        if (!guild.systemChannel) {
            results.security.recommendations.push('Set a system messages channel for new member alerts');
        }

        // Check for potentially compromised webhooks
        const webhookCount = await guild.fetchWebhooks().then(w => w.size).catch(() => 0);
        if (webhookCount > 20) {
            results.security.warnings.push(`⚠️ High number of webhooks (${webhookCount})`);
        }

        // Run security scanner if available
        if (bot.securityScanner) {
            try {
                const scannerResults = await bot.securityScanner.scanServer(guild);
                if (scannerResults?.threats) {
                    results.security.threats = results.security.threats.concat(scannerResults.threats);
                }
            } catch (e) {
                bot.logger.warn('Security scanner error:', e.message);
            }
        }

    } catch (error) {
        bot.logger.error('Error during initial scan:', error);
    }

    return results;
}

/**
 * Create automatic backup on first join
 */
async function createInitialBackup(guild, bot) {
    const result = {
        success: false,
        backupId: null,
        error: null
    };

    try {
        if (bot.serverBackup) {
            const backupResult = await bot.serverBackup.createBackup(guild.id, {
                description: 'Initial automatic backup (bot first joined)',
                createdBy: bot.client.user.id,
                isAutomatic: true
            });
            
            if (backupResult.success) {
                result.success = true;
                result.backupId = backupResult.backupId;
                bot.logger.info(`✅ Created initial backup for ${guild.name}: ${backupResult.backupId}`);
            } else {
                result.error = backupResult.error;
            }
        } else {
            result.error = 'Backup system not available';
        }
    } catch (error) {
        result.error = error.message;
        bot.logger.error('Error creating initial backup:', error);
    }

    return result;
}

/**
 * Send scan report to server owner
 */
async function sendScanReport(guild, bot, scanResults, backupResult) {
    try {
        const owner = await guild.fetchOwner();
        
        const reportEmbed = new EmbedBuilder()
            .setTitle('📊 Initial Server Scan Complete')
            .setDescription(`Security scan of **${guild.name}** has completed.`)
            .setColor(scanResults.security.threats.length > 0 ? '#ff6b6b' : 
                       scanResults.security.warnings.length > 0 ? '#ffd43b' : '#51cf66')
            .addFields(
                { 
                    name: '👥 Members', 
                    value: `Total: ${scanResults.members.total}\nBots: ${scanResults.members.bots}\nAdmins: ${scanResults.members.admins}`, 
                    inline: true 
                },
                { 
                    name: '📁 Channels', 
                    value: `Total: ${scanResults.channels.total}\nCategories: ${scanResults.channels.categories}\nText: ${scanResults.channels.text}\nVoice: ${scanResults.channels.voice}`, 
                    inline: true 
                },
                { 
                    name: '🎭 Roles', 
                    value: `Total: ${scanResults.roles.total}\nAdmin roles: ${scanResults.roles.adminRoles.length}\nDangerous perms: ${scanResults.roles.dangerousPerms.length}`, 
                    inline: true 
                }
            )
            .setTimestamp();

        // Add warnings if any
        if (scanResults.security.warnings.length > 0) {
            reportEmbed.addFields({
                name: '⚠️ Warnings',
                value: scanResults.security.warnings.slice(0, 5).join('\n') || 'None',
                inline: false
            });
        }

        // Add recommendations
        if (scanResults.security.recommendations.length > 0) {
            reportEmbed.addFields({
                name: '💡 Recommendations',
                value: scanResults.security.recommendations.slice(0, 5).join('\n') || 'None',
                inline: false
            });
        }

        // Add backup info
        if (backupResult.success) {
            reportEmbed.addFields({
                name: '💾 Automatic Backup Created',
                value: `Backup ID: \`${backupResult.backupId}\`\nView backups at: ${process.env.DASHBOARD_URL || 'your dashboard'}/backups`,
                inline: false
            });
        }

        // Security status
        const statusText = scanResults.security.threats.length > 0 ? '🔴 Threats Detected' :
                          scanResults.security.warnings.length > 0 ? '🟡 Warnings Present' :
                          '🟢 No Issues Found';
        reportEmbed.addFields({
            name: '🛡️ Security Status',
            value: statusText,
            inline: false
        });

        await owner.send({ embeds: [reportEmbed] });

        // Also send to first text channel if available
        const logChannel = guild.channels.cache.find(c => 
            c.type === 0 && 
            c.permissionsFor(guild.members.me).has(PermissionFlagsBits.SendMessages)
        );
        
        if (logChannel) {
            const summaryEmbed = new EmbedBuilder()
                .setTitle('✅ Initial Scan Complete')
                .setDescription(`Security scan completed. ${scanResults.security.warnings.length} warnings found.\n${backupResult.success ? `💾 Backup created: \`${backupResult.backupId}\`` : ''}`)
                .setColor('#00d4ff')
                .setFooter({ text: 'Full report sent to server owner' })
                .setTimestamp();
            
            await logChannel.send({ embeds: [summaryEmbed] });
        }

    } catch (error) {
        bot.logger.error('Error sending scan report:', error);
    }
}

/**
 * Create all the welcome embeds for the DM guide
 */
function createWelcomeEmbeds(guild, client) {
    const welcomeDM1 = new EmbedBuilder()
        .setTitle('🛡️ Welcome to DarkLock!')
        .setDescription(`
Thank you for adding **DarkLock** to **${guild.name}**!

I'm an advanced security and moderation bot designed to protect your server and make management easier.

**🎯 I'm currently performing an initial security scan** of your server to check for existing threats. This will complete in a few minutes.
        `)
        .setColor('#00d4ff')
        .setThumbnail(client.user.displayAvatarURL())
        .setTimestamp();

    const securityFeatures = new EmbedBuilder()
        .setTitle('🔒 Security Features')
        .setColor('#e74c3c')
        .setDescription('DarkLock provides comprehensive protection:')
        .addFields(
            { 
                name: '🚨 Anti-Raid Protection', 
                value: 'Automatically detects and stops server raids\n• Monitors join patterns\n• Configurable thresholds\n• Auto-lockdown capabilities', 
                inline: false 
            },
            { 
                name: '🗑️ Anti-Spam System', 
                value: 'Prevents spam and flooding\n• Message rate limiting\n• Duplicate detection\n• Auto-delete spam', 
                inline: false 
            },
            { 
                name: '🔗 Link Protection', 
                value: 'Blocks malicious links and phishing\n• Real-time URL scanning\n• Phishing database checks\n• Scam prevention', 
                inline: false 
            },
            { 
                name: '🧹 Toxicity Detection', 
                value: 'Filters toxic and harmful content\n• Advanced content analysis\n• Configurable sensitivity\n• Automatic warnings', 
                inline: false 
            },
            { 
                name: '📊 Proactive Scanning', 
                value: 'Regular security scans of all channels\n• Scheduled automatic scans\n• Manual scan triggers\n• Detailed threat reports', 
                inline: false 
            }
        );

    const moderationCommands = new EmbedBuilder()
        .setTitle('⚖️ Moderation Commands')
        .setColor('#3498db')
        .addFields(
            { name: '`/ban` `[user] [reason]`', value: 'Ban a user from the server', inline: true },
            { name: '`/kick` `[user] [reason]`', value: 'Kick a user from the server', inline: true },
            { name: '`/timeout` `[user] [duration]`', value: 'Timeout a user temporarily', inline: true },
            { name: '`/warn` `[user] [reason]`', value: 'Issue a warning to a user', inline: true },
            { name: '`/purge` `[amount]`', value: 'Delete multiple messages', inline: true },
            { name: '`/lockdown` `[channel]`', value: 'Lock a channel temporarily', inline: true }
        );

    const adminCommands = new EmbedBuilder()
        .setTitle('🛠️ Setup & Admin Commands')
        .setColor('#f39c12')
        .addFields(
            { name: '`/wizard`', value: '**⭐ Recommended first step!**\nInteractive setup wizard for all features', inline: false },
            { name: '`/serversetup` `[template]`', value: '**NEW!** Complete server setup with channels & roles\nChoose from Gaming, Business, Education, Creative, or General templates', inline: false },
            { name: '`/setup`', value: 'Configure security features and channels', inline: true },
            { name: '`/settings` `[feature]`', value: 'View and modify bot settings', inline: true },
            { name: '`/security` `[action]`', value: 'Manage security features', inline: true },
            { name: '`/permissions` `[role]`', value: 'Configure role permissions', inline: true }
        );

    const utilityCommands = new EmbedBuilder()
        .setTitle('🔧 Utility Commands')
        .setColor('#2ecc71')
        .addFields(
            { name: '`/ticket` `[create/close]`', value: 'Manage support tickets', inline: true },
            { name: '`/help` `[command]`', value: 'Get help with commands', inline: true },
            { name: '`/serverinfo`', value: 'View server information', inline: true },
            { name: '`/userinfo` `[user]`', value: 'View user information', inline: true },
            { name: '`/analytics`', value: 'View server analytics', inline: true },
            { name: '`/status`', value: 'Check security status', inline: true }
        );

    const dashboardInfo = new EmbedBuilder()
        .setTitle('🌐 Web Dashboard')
        .setColor('#9b59b6')
        .setDescription(`
**Access your dashboard at:** \`${process.env.DASHBOARD_URL || 'Your Dashboard URL'}\`

**Dashboard Features:**
🎨 Modern, responsive interface
📊 Real-time server statistics
🔧 Configure all bot settings
🚨 View security alerts and quarantined content
📈 Detailed analytics and insights
🎫 Manage tickets
👥 User management tools
⚙️ Auto-delete configuration for threats
📋 Security scan history

**Login:** Use your Discord account to authenticate
        `);

    const quickStart = new EmbedBuilder()
        .setTitle('🚀 Quick Start Guide')
        .setColor('#1abc9c')
        .setDescription(`
**Recommended Setup Steps:**

**1️⃣ Run the Setup Wizard**
Use \`/wizard\` to configure basic settings in a guided format

**2️⃣ Set Up Your Server Structure** *(Optional)*
Use \`/serversetup\` to create a complete server template with channels and roles

**3️⃣ Configure Security Features**
Use \`/security enable\` to enable protection features
• Anti-raid protection
• Anti-spam filtering
• Link protection
• Toxicity detection

**4️⃣ Set Moderation Roles**
Use \`/setup\` to assign moderator and admin roles

**5️⃣ Configure Auto-Delete Settings**
Visit the web dashboard to configure automatic deletion of threats

**6️⃣ Review Security Scan Results**
Check the scan report I'm generating now!

**💡 Pro Tips:**
• Use the web dashboard for advanced configuration
• Enable notifications for security events
• Set up a dedicated log channel
• Regular security scans are automatically performed
• Check quarantined messages before deletion
        `);

    const supportInfo = new EmbedBuilder()
        .setTitle('❓ Need Help?')
        .setColor('#95a5a6')
        .setDescription(`
**Support Resources:**

📖 **Documentation:** Use \`/help\` for command documentation
🌐 **Web Dashboard:** Full feature documentation available
💬 **In-Server Help:** Use \`/help [command]\` for specific commands
🔍 **Status Check:** Use \`/status\` to verify bot functionality
🔗 **Website:** https://DarkLock.xyz
💬 **Community Server:** https://discord.gg/r8dvnad9c9

**Common Issues:**
• Missing permissions: Grant Administrator permission
• Commands not working: Check role hierarchy
• Features not triggering: Verify settings with \`/settings\`

**All set!** DarkLock is now protecting your server. Run \`/wizard\` to get started!
        `)
        .setFooter({ text: 'DarkLock - Advanced Security & Moderation' })
        .setTimestamp();

    return [welcomeDM1, securityFeatures, moderationCommands, adminCommands, utilityCommands, dashboardInfo, quickStart, supportInfo];
}
