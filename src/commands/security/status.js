const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function getPlatformStatusUrl() {
    const configured = process.env.PLATFORM_URL || process.env.DASHBOARD_URL || process.env.PUBLIC_URL || 'https://darklock.net';
    const base = String(configured).replace(/\/+$/, '');
    return `${base}/platform/status`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check the security status of the server'),

    async execute(interaction) {
        const guild = interaction.guild;
        const bot = interaction.client;

        // Defer reply for data collection
        await interaction.deferReply();

        try {
            // Collect security metrics
            let securityScore = 50; // Base score
            const issues = [];
            const strengths = [];

            // Check verification level
            if (guild.verificationLevel >= 2) {
                securityScore += 15;
                strengths.push('✅ Server has medium+ verification');
            } else {
                issues.push('⚠️ Server verification level is low');
                securityScore -= 10;
            }

            // Check bot permissions
            const botMember = guild.members.cache.get(bot.user.id);
            const hasAdminPerms = botMember?.permissions.has('Administrator');
            const hasModeratePerms = botMember?.permissions.has(['BanMembers', 'KickMembers', 'ManageMessages']);

            if (hasAdminPerms) {
                securityScore += 15;
                strengths.push('✅ Bot has administrator permissions');
            } else if (hasModeratePerms) {
                securityScore += 10;
                strengths.push('✅ Bot has moderation permissions');
            } else {
                issues.push('❌ Bot lacks necessary moderation permissions');
                securityScore -= 15;
            }

            // Check for security modules status
            if (bot.antiSpam) {
                securityScore += 10;
                strengths.push('✅ Anti-spam protection active');
            }

            if (bot.antiRaid) {
                securityScore += 10;
                strengths.push('✅ Anti-raid protection active');
            }

            if (bot.antiMaliciousLinks) {
                securityScore += 5;
                strengths.push('✅ Malicious link protection active');
            }

            // Check recent activity
            let threatsBlocked = 0;

            if (bot.database) {
                try {
                    const row = await bot.database.get(
                        `SELECT COUNT(*) as count FROM security_events WHERE guild_id = ? AND timestamp > datetime('now', '-1 day')`,
                        [guild.id]
                    );
                    threatsBlocked = row?.count || 0;
                    if (threatsBlocked > 0) {
                        securityScore += Math.min(threatsBlocked * 2, 15);
                        strengths.push(`✅ Blocked ${threatsBlocked} threats in last 24h`);
                    }
                } catch (_) {
                    // Table may not exist yet - that's fine
                }
            }

            // Check server features
            if (guild.features.includes('COMMUNITY')) {
                securityScore += 5;
                strengths.push('✅ Community server features enabled');
            }

            // Check for log channel
            const logChannel = guild.channels.cache.find(
                c => c.name === 'mod-logs' || c.name === 'audit-logs' || c.name === 'security-logs'
            );
            
            if (logChannel) {
                securityScore += 5;
                strengths.push('✅ Security logging channel configured');
            } else {
                issues.push('⚠️ No security log channel found');
            }

            // Ensure score is within bounds
            securityScore = Math.max(0, Math.min(100, securityScore));

            // Determine overall status
            let statusText = '🟢 Secure';
            let statusColor = '#2ed573';
            let statusDescription = 'Your server has strong security measures in place.';

            if (securityScore < 60) {
                statusText = '🔴 Vulnerable';
                statusColor = '#ff4757';
                statusDescription = 'Your server needs immediate security improvements.';
            } else if (securityScore < 80) {
                statusText = '🟡 Moderate';
                statusColor = '#ffa502';
                statusDescription = 'Your server has basic security but could be improved.';
            }

            // Create status embed
            const statusEmbed = new EmbedBuilder()
                .setTitle('🛡️ Server Security Status')
                .setDescription(statusDescription)
                .addFields(
                    { name: 'Security Score', value: `${securityScore}/100`, inline: true },
                    { name: 'Overall Status', value: statusText, inline: true },
                    { name: 'Threats Blocked (24h)', value: `${threatsBlocked}`, inline: true }
                )
                .setColor(statusColor)
                .setTimestamp();

            // Add strengths if any
            if (strengths.length > 0) {
                statusEmbed.addFields({
                    name: '💪 Security Strengths',
                    value: strengths.slice(0, 8).join('\n'),
                    inline: false
                });
            }

            // Add issues if any
            if (issues.length > 0) {
                statusEmbed.addFields({
                    name: '⚠️ Security Issues',
                    value: issues.slice(0, 8).join('\n'),
                    inline: false
                });
            }

            // Add server info
            statusEmbed.addFields(
                { name: 'Server Members', value: `${guild.memberCount.toLocaleString()}`, inline: true },
                { name: 'Verification Level', value: `${guild.verificationLevel}`, inline: true },
                { name: 'Bot Uptime', value: bot.uptime ? `${Math.floor(bot.uptime / 3600000)}h` : 'Unknown', inline: true }
            );

            // Action buttons
            const actionRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Platform Status')
                        .setStyle(ButtonStyle.Link)
                        .setURL(getPlatformStatusUrl())
                        .setEmoji('🌐'),
                    new ButtonBuilder()
                        .setLabel('Refresh Status')
                        .setStyle(ButtonStyle.Secondary)
                        .setCustomId('refresh_status')
                        .setEmoji('🔄'),
                    new ButtonBuilder()
                        .setLabel('Security Guide')
                        .setStyle(ButtonStyle.Secondary)
                        .setCustomId('security_guide')
                        .setEmoji('📋')
                );

            await interaction.editReply({ 
                embeds: [statusEmbed], 
                components: [actionRow] 
            });

        } catch (error) {
            console.error('Error generating security status:', error);
            await interaction.editReply({
                content: '❌ An error occurred while checking security status.',
                ephemeral: true
            });
        }
    },
};
