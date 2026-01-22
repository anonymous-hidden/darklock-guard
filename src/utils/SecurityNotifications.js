/**
 * Security Notification System
 * Centralized notification embeds with action buttons for all security modules
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Severity color mapping
const SEVERITY_COLORS = {
    CRITICAL: 0xff0000,   // Red
    HIGH: 0xff6600,       // Orange
    MEDIUM: 0xffa500,     // Yellow-Orange
    LOW: 0xffff00,        // Yellow
    INFO: 0x10b981,       // Green
};

// Module-specific icons
const MODULE_ICONS = {
    SPAM: '🗑️',
    RAID: '⚔️',
    NUKE: '💣',
    LINKS: '🔗',
    PHISHING: '🎣',
    VERIFICATION: '✅',
};

class SecurityNotifications {
    constructor(bot) {
        this.bot = bot;
    }

    /**
     * Get the log channel for a guild
     */
    async getLogChannel(guild, config = null) {
        try {
            if (!config) {
                config = await this.bot.database.getGuildConfig(guild.id);
            }
            
            let logChannel = null;
            
            // Primary: configured log channel
            if (config?.log_channel_id) {
                logChannel = guild.channels.cache.get(config.log_channel_id);
            }
            
            // Fallback: find a log/mod/security channel
            if (!logChannel) {
                logChannel = guild.channels.cache.find(c => 
                    c.isTextBased() && 
                    (c.name.includes('log') || c.name.includes('mod') || c.name.includes('security') || c.name.includes('alert'))
                );
            }
            
            return logChannel?.isTextBased() ? logChannel : null;
        } catch (err) {
            this.bot.logger?.error('Failed to get log channel:', err);
            return null;
        }
    }

    /**
     * Send a spam detection notification with action buttons
     */
    async sendSpamNotification(guild, data) {
        const {
            user,
            userId,
            channelId,
            score,
            breakdown,
            action,
            actionDuration,
            warningCount,
            contentSample,
            messageUrl
        } = data;

        const severity = score >= 80 ? 'CRITICAL' : score >= 60 ? 'HIGH' : 'MEDIUM';
        
        const embed = new EmbedBuilder()
            .setTitle(`${MODULE_ICONS.SPAM} Spam Detected`)
            .setDescription(`**${user?.tag || `<@${userId}>`}** triggered spam detection`)
            .setColor(SEVERITY_COLORS[severity])
            .setThumbnail(user?.displayAvatarURL?.() || null)
            .addFields(
                { name: '👤 User', value: `<@${userId}>\n\`${userId}\``, inline: true },
                { name: '📊 Score', value: `**${Math.round(score)}**/100`, inline: true },
                { name: '⚠️ Warnings', value: `${warningCount || 0}`, inline: true },
                { name: '📍 Channel', value: `<#${channelId}>`, inline: true },
                { name: '⚡ Action', value: this.formatAction(action, actionDuration), inline: true },
                { name: '🔒 Severity', value: severity, inline: true }
            )
            .setTimestamp();

        // Add breakdown if available
        if (breakdown && Object.keys(breakdown).length > 0) {
            const breakdownText = Object.entries(breakdown)
                .filter(([_, v]) => v > 0)
                .map(([k, v]) => `${this.formatBreakdownKey(k)}: ${v}`)
                .join('\n') || 'N/A';
            embed.addFields({ name: '📋 Detection Breakdown', value: breakdownText, inline: false });
        }

        // Add content sample if available
        if (contentSample) {
            const truncated = contentSample.length > 200 ? contentSample.substring(0, 200) + '...' : contentSample;
            embed.addFields({ name: '💬 Content Sample', value: `\`\`\`${truncated}\`\`\``, inline: false });
        }

        // Create action buttons
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`spam_untimeout_${userId}`)
                    .setLabel('Untimeout')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🔓'),
                new ButtonBuilder()
                    .setCustomId(`spam_warn_${userId}`)
                    .setLabel('Warn')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('⚠️'),
                new ButtonBuilder()
                    .setCustomId(`spam_kick_${userId}`)
                    .setLabel('Kick')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('👢'),
                new ButtonBuilder()
                    .setCustomId(`spam_ban_${userId}`)
                    .setLabel('Ban')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔨'),
                new ButtonBuilder()
                    .setCustomId(`spam_whitelist_${userId}`)
                    .setLabel('Whitelist')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⚪')
            );

        const logChannel = await this.getLogChannel(guild);
        if (logChannel) {
            try {
                await logChannel.send({ embeds: [embed], components: [row] });
            } catch (err) {
                this.bot.logger?.error('Failed to send spam notification:', err);
            }
        }

        return { embed, row };
    }

    /**
     * Send a raid detection notification with action buttons
     */
    async sendRaidNotification(guild, data) {
        const {
            stage,
            joinCount,
            threshold,
            pattern,
            inviteSummary,
            recentJoins,
            isLockdownActive
        } = data;

        const severity = stage === 'CRITICAL' ? 'CRITICAL' : stage === 'HARD' ? 'HIGH' : stage === 'SOFT' ? 'MEDIUM' : 'LOW';
        
        const embed = new EmbedBuilder()
            .setTitle(`${MODULE_ICONS.RAID} Raid ${stage}`)
            .setDescription(`**${joinCount} joins** detected in under a minute (threshold: ${threshold})`)
            .setColor(SEVERITY_COLORS[severity])
            .addFields(
                { name: '📊 Pattern', value: `Type: **${pattern?.patternType || 'Unknown'}**\nConfidence: ${((pattern?.confidence || 0) * 100).toFixed(1)}%`, inline: true },
                { name: '⚠️ Severity', value: pattern?.severity || severity, inline: true },
                { name: '🔒 Status', value: isLockdownActive ? '🔴 Lockdown Active' : '🟢 Normal', inline: true }
            )
            .setTimestamp();

        // Add pattern signals
        if (pattern) {
            embed.addFields({
                name: '🔍 Signals',
                value: `Bot-like accounts: ${pattern.botLikeCount || 0}\nNew accounts (<24h): ${pattern.newAccountCount || 0}\nName similarity: ${((pattern.similarityRatio || 1) * 100).toFixed(1)}%`,
                inline: false
            });
        }

        // Add invite summary
        if (inviteSummary?.top?.length > 0) {
            const inviteText = inviteSummary.top.map(([code, count]) => `\`${code}\`: ${count} uses`).join('\n');
            embed.addFields({ name: '📨 Top Invites', value: inviteText, inline: false });
        }

        // Add recent joins (show first 10)
        if (recentJoins?.length > 0) {
            const joinList = recentJoins.slice(0, 10)
                .map(j => `<@${j.userId}> - ${this.formatAccountAge(j.accountAge)}`)
                .join('\n');
            embed.addFields({ 
                name: `👥 Recent Joins (${recentJoins.length} total)`, 
                value: joinList + (recentJoins.length > 10 ? `\n... and ${recentJoins.length - 10} more` : ''),
                inline: false 
            });
        }

        // Create action buttons
        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`raid_endlockdown_${guild.id}`)
                    .setLabel('End Lockdown')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🔓')
                    .setDisabled(!isLockdownActive),
                new ButtonBuilder()
                    .setCustomId(`raid_extendlockdown_${guild.id}`)
                    .setLabel('Extend +10m')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('⏰')
                    .setDisabled(!isLockdownActive),
                new ButtonBuilder()
                    .setCustomId(`raid_lockdown_${guild.id}`)
                    .setLabel('Start Lockdown')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒')
                    .setDisabled(isLockdownActive)
            );

        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`raid_masskick_${guild.id}`)
                    .setLabel('Kick Flagged')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('👢'),
                new ButtonBuilder()
                    .setCustomId(`raid_massban_${guild.id}`)
                    .setLabel('Ban Flagged')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔨'),
                new ButtonBuilder()
                    .setCustomId(`raid_approve_${guild.id}`)
                    .setLabel('False Alarm')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('✅')
            );

        const logChannel = await this.getLogChannel(guild);
        if (logChannel) {
            try {
                await logChannel.send({ embeds: [embed], components: [row1, row2] });
            } catch (err) {
                this.bot.logger?.error('Failed to send raid notification:', err);
            }
        }

        return { embed, rows: [row1, row2] };
    }

    /**
     * Send an anti-nuke detection notification with action buttons
     */
    async sendNukeNotification(guild, data) {
        const {
            user,
            userId,
            violation,
            actionTaken,
            reversalResult
        } = data;

        const embed = new EmbedBuilder()
            .setTitle(`${MODULE_ICONS.NUKE} Anti-Nuke Alert`)
            .setDescription(`**${user?.tag || `<@${userId}>`}** triggered nuke protection`)
            .setColor(SEVERITY_COLORS.CRITICAL)
            .setThumbnail(user?.displayAvatarURL?.() || null)
            .addFields(
                { name: '👤 Perpetrator', value: `<@${userId}>\n\`${userId}\``, inline: true },
                { name: '⚠️ Violation', value: `**${violation?.actionType || 'Unknown'}**`, inline: true },
                { name: '📊 Count', value: `${violation?.count || 0} / ${violation?.limit || '?'}`, inline: true }
            )
            .setTimestamp();

        // Add action counts
        if (violation?.counts) {
            const countsText = Object.entries(violation.counts)
                .filter(([_, v]) => v > 0)
                .map(([k, v]) => `${this.formatActionType(k)}: ${v}`)
                .join('\n') || 'N/A';
            embed.addFields({ name: '📋 All Actions', value: countsText, inline: false });
        }

        // Add action taken
        if (actionTaken) {
            embed.addFields({ name: '⚡ Action Taken', value: actionTaken, inline: false });
        }

        // Add reversal result
        if (reversalResult) {
            embed.addFields({ 
                name: '↩️ Reversal', 
                value: `Success: ${reversalResult.success || 0}\nFailed: ${reversalResult.failed || 0}`,
                inline: false 
            });
        }

        // Create action buttons
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`nuke_restore_${guild.id}_${userId}`)
                    .setLabel('Restore Changes')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('↩️'),
                new ButtonBuilder()
                    .setCustomId(`nuke_ban_${userId}`)
                    .setLabel('Ban')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔨'),
                new ButtonBuilder()
                    .setCustomId(`nuke_striproles_${userId}`)
                    .setLabel('Strip Roles')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('⬇️'),
                new ButtonBuilder()
                    .setCustomId(`nuke_whitelist_${userId}`)
                    .setLabel('Whitelist')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⚪')
            );

        const logChannel = await this.getLogChannel(guild);
        if (logChannel) {
            try {
                await logChannel.send({ embeds: [embed], components: [row] });
            } catch (err) {
                this.bot.logger?.error('Failed to send nuke notification:', err);
            }
        }

        return { embed, row };
    }

    /**
     * Send an anti-link/phishing notification with action buttons
     */
    async sendLinkNotification(guild, data) {
        const {
            user,
            userId,
            channelId,
            link,
            threatType,
            action,
            domain
        } = data;

        const severity = threatType === 'phishing' || threatType === 'malware' ? 'CRITICAL' : 
                        threatType === 'iplogger' ? 'HIGH' : 'MEDIUM';
        
        const icon = threatType === 'phishing' ? MODULE_ICONS.PHISHING : MODULE_ICONS.LINKS;
        
        const embed = new EmbedBuilder()
            .setTitle(`${icon} ${threatType === 'phishing' ? 'Phishing' : 'Blocked Link'} Detected`)
            .setDescription(`**${user?.tag || `<@${userId}>`}** posted a blocked link`)
            .setColor(SEVERITY_COLORS[severity])
            .setThumbnail(user?.displayAvatarURL?.() || null)
            .addFields(
                { name: '👤 User', value: `<@${userId}>\n\`${userId}\``, inline: true },
                { name: '📍 Channel', value: `<#${channelId}>`, inline: true },
                { name: '⚠️ Threat Type', value: this.formatThreatType(threatType), inline: true },
                { name: '🔗 Domain', value: `\`${domain || 'Unknown'}\``, inline: true },
                { name: '⚡ Action', value: action || 'Deleted', inline: true },
                { name: '🔒 Severity', value: severity, inline: true }
            )
            .setTimestamp();

        // Add sanitized link
        if (link) {
            const sanitized = link.replace(/https?:\/\//g, '[blocked]://');
            embed.addFields({ name: '🔗 Link (sanitized)', value: `\`\`\`${sanitized.substring(0, 200)}\`\`\``, inline: false });
        }

        // Create action buttons
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`link_kick_${userId}`)
                    .setLabel('Kick')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('👢'),
                new ButtonBuilder()
                    .setCustomId(`link_ban_${userId}`)
                    .setLabel('Ban')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔨'),
                new ButtonBuilder()
                    .setCustomId(`link_whitelist_${guild.id}_${encodeURIComponent(domain || '')}`)
                    .setLabel('Whitelist Domain')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⚪'),
                new ButtonBuilder()
                    .setCustomId(`link_false_${userId}`)
                    .setLabel('False Positive')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅')
            );

        const logChannel = await this.getLogChannel(guild);
        if (logChannel) {
            try {
                await logChannel.send({ embeds: [embed], components: [row] });
            } catch (err) {
                this.bot.logger?.error('Failed to send link notification:', err);
            }
        }

        return { embed, row };
    }

    /**
     * Send a verification notification with action buttons
     */
    async sendVerificationNotification(guild, data) {
        const {
            user,
            userId,
            method,
            accountAge,
            joinedAt
        } = data;

        const embed = new EmbedBuilder()
            .setTitle(`${MODULE_ICONS.VERIFICATION} Verification Pending`)
            .setDescription(`**${user?.tag || `<@${userId}>`}** is awaiting verification`)
            .setColor(SEVERITY_COLORS.INFO)
            .setThumbnail(user?.displayAvatarURL?.() || null)
            .addFields(
                { name: '👤 User', value: `<@${userId}>\n\`${userId}\``, inline: true },
                { name: '📅 Account Age', value: this.formatAccountAge(accountAge), inline: true },
                { name: '⏰ Joined', value: joinedAt ? `<t:${Math.floor(new Date(joinedAt).getTime() / 1000)}:R>` : 'Unknown', inline: true },
                { name: '🔐 Method', value: method || 'Standard', inline: true }
            )
            .setTimestamp();

        // Risk assessment
        const risk = accountAge && accountAge < 24 * 60 * 60 * 1000 ? 'HIGH' : 
                    accountAge && accountAge < 7 * 24 * 60 * 60 * 1000 ? 'MEDIUM' : 'LOW';
        embed.addFields({ name: '⚠️ Risk Level', value: risk, inline: true });

        // Create action buttons
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`verify_approve_${guild.id}_${userId}`)
                    .setLabel('Approve')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`verify_reject_${guild.id}_${userId}`)
                    .setLabel('Reject & Kick')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌'),
                new ButtonBuilder()
                    .setCustomId(`verify_ban_${userId}`)
                    .setLabel('Ban')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔨')
            );

        const logChannel = await this.getLogChannel(guild);
        if (logChannel) {
            try {
                await logChannel.send({ embeds: [embed], components: [row] });
            } catch (err) {
                this.bot.logger?.error('Failed to send verification notification:', err);
            }
        }

        return { embed, row };
    }

    /**
     * Update an existing notification to show action was taken
     */
    async updateNotificationWithAction(message, moderator, actionTaken) {
        try {
            const originalEmbed = message.embeds[0];
            if (!originalEmbed) return;

            const updatedEmbed = EmbedBuilder.from(originalEmbed)
                .setColor(SEVERITY_COLORS.INFO)
                .addFields({
                    name: '✅ Action Taken',
                    value: `**${moderator?.tag || 'Moderator'}** used: **${actionTaken}**`,
                    inline: false
                });

            await message.edit({
                embeds: [updatedEmbed],
                components: [] // Remove buttons after action
            });
        } catch (err) {
            this.bot.logger?.error('Failed to update notification:', err);
        }
    }

    // Helper: Format action for display
    formatAction(action, duration) {
        if (!action) return 'None';
        if (action === 'TIMEOUT' && duration) {
            return `Timeout ${Math.round(duration / 60000)}m`;
        }
        return action;
    }

    // Helper: Format breakdown keys
    formatBreakdownKey(key) {
        const map = {
            floodScore: '🌊 Flood',
            duplicateScore: '📝 Duplicates',
            mentionScore: '📢 Mentions',
            emojiScore: '😀 Emojis',
            capsScore: '🔠 Caps',
            linkScore: '🔗 Links'
        };
        return map[key] || key;
    }

    // Helper: Format action type
    formatActionType(type) {
        const map = {
            roleCreate: '🏷️ Role Create',
            roleDelete: '🏷️ Role Delete',
            channelCreate: '📁 Channel Create',
            channelDelete: '📁 Channel Delete',
            banAdd: '🔨 Ban',
            memberKick: '👢 Kick',
            webhookCreate: '🪝 Webhook Create',
            webhookDelete: '🪝 Webhook Delete'
        };
        return map[type] || type;
    }

    // Helper: Format threat type
    formatThreatType(type) {
        const map = {
            phishing: '🎣 Phishing',
            malware: '🦠 Malware',
            iplogger: '📍 IP Logger',
            scam: '💰 Scam',
            blocked: '🚫 Blocked Domain',
            unknown: '❓ Unknown'
        };
        return map[type] || type;
    }

    // Helper: Format account age
    formatAccountAge(ageMs) {
        if (!ageMs) return 'Unknown';
        const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
        if (days < 1) return '< 1 day ⚠️';
        if (days < 7) return `${days} days ⚠️`;
        if (days < 30) return `${days} days`;
        const months = Math.floor(days / 30);
        if (months < 12) return `${months} months`;
        const years = Math.floor(days / 365);
        return `${years}+ years`;
    }
}

module.exports = SecurityNotifications;
