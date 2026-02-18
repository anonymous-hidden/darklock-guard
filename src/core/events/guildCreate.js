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
                
                const welcomeDM = createWelcomeEmbed(guild, bot.client);
                await owner.send({ embeds: [welcomeDM] });

                bot.logger.info(`📧 Sent welcome guide to ${owner.user.tag}`);
            } catch (dmError) {
                bot.logger.error('Could not send DM to server owner:', dmError);
                // Fallback: send basic message in server
            }
            
            // Send welcome message in server channel
            const welcomeEmbed = new EmbedBuilder()
                .setTitle('🛡️ DarkLock Security Bot is Online!')
                .setDescription(`
Thanks for adding **DarkLock** to **${guild.name}**! 🚀

**🎯 First Steps:**
• Run \`/wizard\` for quick setup
• Use \`/serversetup\` to create channels & roles
• Visit the dashboard for advanced config

**🔒 Security Features:**
• Anti-Raid & Anti-Spam Protection
• Phishing Link Detection
• Toxicity Filtering
• Automatic Threat Scanning

**⚙️ I'm now performing:**
✓ Initial security scan (analyzing existing messages)
✓ Automatic server backup

**💡 Server owner:** Check your DMs for the full guide!
                `)
                .setColor('#00d4ff')
                .addFields(
                    { name: '🚀 Quick Setup', value: '`/wizard`', inline: true },
                    { name: '📚 Commands', value: '`/help`', inline: true },
                    { name: '🌐 Dashboard', value: process.env.DASHBOARD_URL || '[See DM]', inline: true }
                )
                .setFooter({ text: 'DarkLock will send a scan report when complete' })
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
 * Create single comprehensive welcome embed for DM
 */
function createWelcomeEmbed(guild, client) {
    const dashboardURL = process.env.DASHBOARD_URL || 'https://darklock.xyz/dashboard';
    
    return new EmbedBuilder()
        .setTitle('🛡️ Welcome to DarkLock!')
        .setDescription(`
Thank you for adding **DarkLock** to **${guild.name}**!

I'm an advanced security and moderation bot designed to protect your server. I'm currently performing an **initial security scan** and **automatic backup** - you'll receive a detailed report shortly.

**🚀 Quick Start Guide:**

**1️⃣ Run Setup Wizard** → \`/wizard\`
Interactive guided setup for all features

**2️⃣ Configure Security** → \`/security enable\`
Enable protection features (anti-raid, anti-spam, phishing detection)

**3️⃣ Optional: Server Setup** → \`/serversetup [template]\`
Create complete server structure with channels & roles
Templates: Gaming, Business, Education, Creative, General

**4️⃣ Access Web Dashboard** → [${dashboardURL}](${dashboardURL})
Configure advanced settings, view analytics, manage quarantine
        `)
        .setColor('#00d4ff')
        .setThumbnail(client.user.displayAvatarURL())
        .addFields(
            { 
                name: '🔒 Security Features', 
                value: '• **Anti-Raid** - Stops coordinated attacks\n• **Anti-Spam** - Filters spam & flooding\n• **Link Protection** - Blocks phishing & malicious URLs\n• **Toxicity Filter** - Removes harmful content\n• **Proactive Scanning** - Regular security audits', 
                inline: false 
            },
            { 
                name: '⚖️ Moderation Tools', 
                value: '`/ban` `/kick` `/timeout` `/warn` `/purge` `/lockdown`\nComplete moderation suite with auto-logging', 
                inline: true 
            },
            { 
                name: '🎫 Utility Commands', 
                value: '`/ticket` `/serverinfo` `/userinfo` `/analytics` `/status` `/help`', 
                inline: true 
            },
            { 
                name: '🌐 Web Dashboard Features', 
                value: '• Real-time server statistics & analytics\n• Configure all settings visually\n• View security alerts & quarantine\n• Manage tickets & users\n• Auto-delete threat configuration', 
                inline: false 
            },
            { 
                name: '💡 Pro Tips', 
                value: '• Grant **Administrator** permission for full functionality\n• Use `/help [command]` for detailed command info\n• Check the dashboard for advanced configuration\n• Security scans run automatically every 24 hours', 
                inline: false 
            },
            { 
                name: '❓ Need Help?', 
                value: '**Commands:** `/help`\n**Status:** `/status`\n**Support:** https://discord.gg/Vsq9PUTrgb\n**Website:** https://darklock.xyz', 
                inline: false 
            }
        )
        .setFooter({ text: 'DarkLock - Advanced Security & Moderation | Protecting your server 24/7' })
        .setTimestamp();
}
