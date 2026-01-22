/**
 * Client Ready Event Handler
 * Fires once when the bot successfully connects to Discord
 */

const StandardEmbedBuilder = require('../../utils/embed-builder');

module.exports = {
    name: 'clientReady',
    once: true,
    async execute(client, bot) {
        bot.logger.info(`🚀 Bot is online as ${client.user.tag}`);
        bot.logger.info(`📊 Serving ${client.guilds.cache.size} guilds`);
        
        // Initialize StandardEmbedBuilder with client instance
        StandardEmbedBuilder.init(client);
        bot.logger.info('✅ StandardEmbedBuilder initialized');
        
        // Set bot presence
        client.user.setActivity('🛡️ DarkLock.xyz | Protecting servers', { type: 'WATCHING' });
        
        // Register slash commands (global + per-guild for immediacy)
        await bot.registerSlashCommands();
        
        // Initialize Anti-Nuke snapshots for all guilds
        if (bot.antiNuke) {
            bot.logger.info('🛡️ Initializing Anti-Nuke snapshots for all guilds...');
            let initialized = 0;
            for (const [guildId, guild] of client.guilds.cache) {
                try {
                    const config = await bot.database.getGuildConfig(guildId);
                    if (config?.antinuke_enabled) {
                        await bot.antiNuke.initializeGuild(guild);
                        initialized++;
                    }
                } catch (error) {
                    bot.logger.warn(`[AntiNuke] Failed to initialize guild ${guild.name}: ${error.message}`);
                }
            }
            bot.logger.info(`🛡️ Anti-Nuke initialized for ${initialized} guilds`);
        }
        
        // Log disabled features for each guild on startup
        try {
            for (const [guildId, guild] of client.guilds.cache) {
                const config = await bot.database.getGuildConfig(guildId);
                if (!config) continue;
                
                const disabledFeatures = [];
                if (!config.anti_raid_enabled && !config.antiraid_enabled) disabledFeatures.push('Anti-Raid');
                if (!config.anti_spam_enabled && !config.antispam_enabled) disabledFeatures.push('Anti-Spam');
                if (!config.anti_phishing_enabled && !config.antiphishing_enabled) disabledFeatures.push('Anti-Phishing');
                if (!config.antinuke_enabled) disabledFeatures.push('Anti-Nuke');
                if (!config.verification_enabled) disabledFeatures.push('Verification');
                if (!config.tickets_enabled) disabledFeatures.push('Tickets');
                if (!config.welcome_enabled) disabledFeatures.push('Welcome');
                if (!config.autorole_enabled) disabledFeatures.push('Autorole');
                if (!config.auto_mod_enabled) disabledFeatures.push('Auto-Mod');
                if (!config.ai_enabled) disabledFeatures.push('AI');
                
                if (disabledFeatures.length > 0) {
                    bot.logger.info(`[FeatureStatus] Guild ${guild.name} (${guildId}): Disabled features: ${disabledFeatures.join(', ')}`);
                }
            }
        } catch (error) {
            bot.logger.warn('[FeatureStatus] Error logging disabled features on startup:', error.message);
        }
    }
};

