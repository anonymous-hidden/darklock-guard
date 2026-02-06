const { Events } = require('discord.js');

/**
 * XP Tracker - Handles XP gain from messages
 * Implements anti-spam cooldown and random XP rewards
 */
class XPTracker {
    constructor(client, xpDatabase) {
        this.client = client;
        this.db = xpDatabase;
        this.init();
    }

    /**
     * Initialize message listener
     */
    init() {
        this.client.on(Events.MessageCreate, async (message) => {
            await this.handleMessage(message);
        });

        console.log('✅ XP Tracker initialized');
    }

    /**
     * Handle incoming messages and award XP
     * @param {Message} message - Discord message object
     */
    async handleMessage(message) {
        try {
            // Ignore bots, DMs, and system messages
            if (message.author.bot) return;
            if (!message.guild) return;
            if (message.system) return;

            // Check if XP is enabled for this guild
            const settings = await this.db.getGuildSettings(message.guild.id);
            if (!settings.xp_enabled) return;

            // Ignore messages that are too short (spam prevention)
            if (message.content.length < 5) return;

            // Calculate random XP amount
            const xpAmount = this.calculateXPReward(
                settings.xp_per_message_min,
                settings.xp_per_message_max
            );

            // Add XP to user
            const result = await this.db.addXP(
                message.author.id,
                message.guild.id,
                xpAmount
            );

            // Skip if on cooldown
            if (result.onCooldown) return;

            // Handle level up
            if (result.leveledUp) {
                await this.handleLevelUp(message, result.newLevel, settings);
            }

        } catch (error) {
            console.error('Error in XP tracker:', error);
        }
    }

    /**
     * Calculate random XP reward within min/max range
     * @param {number} min - Minimum XP
     * @param {number} max - Maximum XP
     * @returns {number} Random XP amount
     */
    calculateXPReward(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    /**
     * Handle user level up event
     * @param {Message} message - Discord message object
     * @param {number} newLevel - New level achieved
     * @param {Object} settings - Guild XP settings
     */
    async handleLevelUp(message, newLevel, settings) {
        try {
            // Get level up channel (use message channel if not set)
            const channelId = settings.level_up_channel_id || message.channel.id;
            const channel = await this.client.channels.fetch(channelId);

            if (!channel) return;

            // Format level up message
            const levelUpMessage = settings.level_up_message
                .replace('{user}', `<@${message.author.id}>`)
                .replace('{level}', newLevel)
                .replace('{username}', message.author.username);

            // Send level up notification
            await channel.send({
                content: levelUpMessage,
                allowedMentions: { users: [message.author.id] }
            });

            // Check for level role rewards (if implemented)
            await this.checkLevelRoles(message.member, newLevel);

        } catch (error) {
            console.error('Error sending level up message:', error);
        }
    }

    /**
     * Check and assign level-based roles
     * @param {GuildMember} member - Discord guild member
     * @param {number} level - New level
     */
    async checkLevelRoles(member, level) {
        // This is a placeholder for level role rewards
        // You can extend this to assign roles based on levels
        // Example: Level 10 = "Active Member", Level 50 = "Elite"
        
        const levelRoles = {
            5: '1234567890', // Role ID for level 5
            10: '1234567891', // Role ID for level 10
            25: '1234567892', // Role ID for level 25
            50: '1234567893', // Role ID for level 50
            100: '1234567894', // Role ID for level 100
        };

        const roleId = levelRoles[level];
        if (roleId) {
            try {
                const role = member.guild.roles.cache.get(roleId);
                if (role && !member.roles.cache.has(roleId)) {
                    await member.roles.add(role);
                    console.log(`✅ Assigned level ${level} role to ${member.user.tag}`);
                }
            } catch (error) {
                console.error('Error assigning level role:', error);
            }
        }
    }

    /**
     * Get XP statistics for a user
     * @param {string} userId - Discord user ID
     * @param {string} guildId - Discord guild ID
     * @returns {Promise<Object>}
     */
    async getUserStats(userId, guildId) {
        return await this.db.getUserStats(userId, guildId);
    }

    /**
     * Get leaderboard for a guild
     * @param {string} guildId - Discord guild ID
     * @param {number} limit - Number of users
     * @returns {Promise<Array>}
     */
    async getLeaderboard(guildId, limit = 10) {
        return await this.db.getLeaderboard(guildId, limit);
    }
}

module.exports = XPTracker;
