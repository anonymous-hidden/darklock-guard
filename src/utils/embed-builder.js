const { EmbedBuilder } = require('discord.js');

/**
 * Standardized Embed Builder for DarkLock
 * Ensures consistent branding, colors, and formatting across all bot messages
 */
class StandardEmbedBuilder {
    constructor() {
        // Brand colors
        this.colors = {
            primary: 0x00d4ff,      // Cyan - main brand color
            success: 0x06ffa5,      // Green - success messages
            error: 0xff5252,        // Red - errors
            warning: 0xff9800,      // Orange - warnings
            info: 0x00d4ff,         // Cyan - info messages (matches primary)
            security: 0xe74c3c,     // Dark red - security alerts
            feature: 0x9b59b6,      // Purple - feature messages
            neutral: 0x95a5a6       // Gray - neutral messages
        };

        // Common footer
        this.footer = {
            text: 'DarkLock • Advanced Security & Moderation',
            iconURL: null // Set dynamically from client.user
        };

        // Brand thumbnail
        this.brandThumbnail = null; // Set dynamically
    }

    /**
     * Initialize with bot client (call on startup)
     */
    init(client) {
        if (client?.user) {
            this.footer.iconURL = client.user.displayAvatarURL();
            this.brandThumbnail = client.user.displayAvatarURL();
        }
    }

    /**
     * Create a success embed
     */
    success(title, description, fields = []) {
        const embed = new EmbedBuilder()
            .setColor(this.colors.success)
            .setTitle(`✅ ${title}`)
            .setDescription(description)
            .setTimestamp()
            .setFooter(this.footer);

        if (fields.length > 0) {
            embed.addFields(fields);
        }

        return embed;
    }

    /**
     * Create an error embed
     */
    error(title, description, fields = []) {
        const embed = new EmbedBuilder()
            .setColor(this.colors.error)
            .setTitle(`❌ ${title}`)
            .setDescription(description)
            .setTimestamp()
            .setFooter(this.footer);

        if (fields.length > 0) {
            embed.addFields(fields);
        }

        return embed;
    }

    /**
     * Create a warning embed
     */
    warning(title, description, fields = []) {
        const embed = new EmbedBuilder()
            .setColor(this.colors.warning)
            .setTitle(`⚠️ ${title}`)
            .setDescription(description)
            .setTimestamp()
            .setFooter(this.footer);

        if (fields.length > 0) {
            embed.addFields(fields);
        }

        return embed;
    }

    /**
     * Create an info embed
     */
    info(title, description, fields = []) {
        const embed = new EmbedBuilder()
            .setColor(this.colors.info)
            .setTitle(`ℹ️ ${title}`)
            .setDescription(description)
            .setTimestamp()
            .setFooter(this.footer);

        if (fields.length > 0) {
            embed.addFields(fields);
        }

        return embed;
    }

    /**
     * Create a security alert embed
     */
    security(title, description, fields = []) {
        const embed = new EmbedBuilder()
            .setColor(this.colors.security)
            .setTitle(`🚨 ${title}`)
            .setDescription(description)
            .setTimestamp()
            .setFooter(this.footer);

        if (fields.length > 0) {
            embed.addFields(fields);
        }

        return embed;
    }

    /**
     * Create a feature notification embed
     */
    feature(title, description, fields = []) {
        const embed = new EmbedBuilder()
            .setColor(this.colors.feature)
            .setTitle(`✨ ${title}`)
            .setDescription(description)
            .setTimestamp()
            .setFooter(this.footer);

        if (fields.length > 0) {
            embed.addFields(fields);
        }

        return embed;
    }

    /**
     * Create a feature disabled embed
     */
    featureDisabled(featureName) {
        return new EmbedBuilder()
            .setColor(this.colors.warning)
            .setTitle('⚠️ Feature Disabled')
            .setDescription(`The **${featureName}** feature is currently disabled for this server. Enable it in the dashboard to use this functionality.`)
            .setTimestamp()
            .setFooter(this.footer);
    }

    /**
     * Create a permission error embed
     */
    permissionError(requiredPermission) {
        return new EmbedBuilder()
            .setColor(this.colors.error)
            .setTitle('❌ Missing Permissions')
            .setDescription(`You need the **${requiredPermission}** permission to use this command.`)
            .setTimestamp()
            .setFooter(this.footer);
    }

    /**
     * Create a cooldown embed
     */
    cooldown(timeLeft) {
        return new EmbedBuilder()
            .setColor(this.colors.warning)
            .setTitle('⏰ Command Cooldown')
            .setDescription(`Please wait **${timeLeft.toFixed(1)}** seconds before using this command again.`)
            .setTimestamp()
            .setFooter(this.footer);
    }

    /**
     * Create a custom embed with full control
     */
    custom(options) {
        const embed = new EmbedBuilder()
            .setColor(options.color || this.colors.primary)
            .setTimestamp()
            .setFooter(this.footer);

        if (options.title) embed.setTitle(options.title);
        if (options.description) embed.setDescription(options.description);
        if (options.fields && options.fields.length > 0) embed.addFields(options.fields);
        if (options.thumbnail) embed.setThumbnail(options.thumbnail);
        if (options.image) embed.setImage(options.image);
        if (options.author) embed.setAuthor(options.author);
        if (options.url) embed.setURL(options.url);

        return embed;
    }

    /**
     * Create a raid alert embed
     */
    raidAlert(guildName, joinCount, timeWindow) {
        return new EmbedBuilder()
            .setColor(this.colors.security)
            .setTitle('🚨 RAID DETECTED')
            .setDescription(`**${joinCount}** users joined **${guildName}** within **${timeWindow}** seconds!`)
            .addFields(
                { name: '🛡️ Actions Taken', value: 'Server lockdown activated\nSuspicious accounts flagged\nModerators notified', inline: false }
            )
            .setTimestamp()
            .setFooter(this.footer);
    }

    /**
     * Create a spam detection embed with full details
     */
    spamDetection(username, userId, channelId, spamTypes, warningCount, actionTaken, accountAge, messageContent, userAvatar, severity) {
        const severityColor = severity === 'HIGH' ? 0xff0000 : severity === 'MEDIUM' ? 0xffa500 : 0xffff00;
        
        const embed = new EmbedBuilder()
            .setColor(severityColor)
            .setTitle('🚨 Spam Detected')
            .setDescription(`User **${username}** was flagged for spam`)
            .addFields(
                { name: '👤 User', value: `<@${userId}>\n\`${userId}\``, inline: true },
                { name: '📍 Channel', value: `<#${channelId}>`, inline: true },
                { name: '⚠️ Warning Count', value: `${warningCount}/5`, inline: true },
                { name: '🏷️ Spam Types', value: spamTypes.map(t => `• ${t.replace('_', ' ')}`).join('\n'), inline: true },
                { name: '⏰ Account Age', value: accountAge || 'Unknown', inline: true },
                { name: '🔧 Action Taken', value: actionTaken, inline: true }
            )
            .setTimestamp()
            .setFooter(this.footer);
        
        // Add message content if available
        if (messageContent && messageContent.length > 0) {
            const truncatedContent = messageContent.length > 300 
                ? messageContent.substring(0, 300) + '...' 
                : messageContent;
            embed.addFields({
                name: '💬 Message Content',
                value: `\`\`\`${truncatedContent}\`\`\``,
                inline: false
            });
        }
        
        // Add user avatar if available
        if (userAvatar) {
            embed.setThumbnail(userAvatar);
        }
        
        return embed;
    }

    /**
     * Create a phishing detection embed
     */
    phishingDetection(url, threatType) {
        return new EmbedBuilder()
            .setColor(this.colors.security)
            .setTitle('🎣 Phishing Link Blocked')
            .setDescription(`Blocked a malicious link: \`${url}\``)
            .addFields(
                { name: '⚠️ Threat Type', value: threatType, inline: false }
            )
            .setTimestamp()
            .setFooter(this.footer);
    }

    /**
     * Create a ticket created embed
     */
    ticketCreated(ticketNumber, subject, user) {
        return new EmbedBuilder()
            .setColor(this.colors.primary)
            .setTitle('🎫 New Support Ticket')
            .setDescription(`Ticket **#${ticketNumber}** has been created`)
            .addFields(
                { name: '👤 User', value: `${user.tag} (${user.id})`, inline: true },
                { name: '📋 Subject', value: subject, inline: true }
            )
            .setTimestamp()
            .setFooter(this.footer);
    }

    /**
     * Create a verification prompt embed
     */
    verificationPrompt(guildName, verificationMethod) {
        return new EmbedBuilder()
            .setColor(this.colors.primary)
            .setTitle(`🔐 Welcome to ${guildName}`)
            .setDescription(`Please complete verification to access the server.`)
            .addFields(
                { name: '✅ Verification Method', value: verificationMethod, inline: false },
                { name: '⏱️ Time Limit', value: 'Complete within 10 minutes', inline: false }
            )
            .setTimestamp()
            .setFooter(this.footer);
    }
}

// Export singleton instance
module.exports = new StandardEmbedBuilder();
