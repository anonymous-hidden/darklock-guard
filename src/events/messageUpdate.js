/**
 * messageUpdate event handler — Security Rule 9
 * 
 * Runs the same security pipeline as messageCreate when message content changes.
 * This closes the #1 critical vulnerability: editing clean messages to contain
 * phishing, spam, or malicious content after initial checks pass.
 * 
 * Only re-checks if:
 *  - The message is in a guild (not DM)
 *  - The author is not a bot
 *  - The content actually changed (not just embed/attachment updates)
 *  - The message is recent (< 5 minutes old, prevents scanning ancient edits)
 */

module.exports = {
    name: 'messageUpdate',
    async execute(oldMessage, newMessage, bot) {
        try {
            // Resolve partials (Discord may send partial message objects)
            if (oldMessage.partial) {
                try { oldMessage = await oldMessage.fetch(); } catch { return; }
            }
            if (newMessage.partial) {
                try { newMessage = await newMessage.fetch(); } catch { return; }
            }

            // Skip non-guild, bot, webhook, system messages
            if (!newMessage.guild) return;
            if (newMessage.author?.bot) return;
            if (newMessage.webhookId) return;
            if (newMessage.system) return;

            // Skip if content didn't actually change (embed unfurl, etc.)
            if (oldMessage.content === newMessage.content) return;

            // Skip edits to messages older than 5 minutes — reduces noise
            const messageAge = Date.now() - newMessage.createdTimestamp;
            if (messageAge > 5 * 60 * 1000) return;

            // Skip if no new content
            if (!newMessage.content || newMessage.content.trim().length === 0) return;

            const guildId = newMessage.guildId;

            // Get config through ConfigService (respects tier enforcement)
            const config = bot.configService
                ? await bot.configService.resolveEffective(guildId)
                : await bot.database.getGuildConfig(guildId);

            if (!config) return;

            // Log the edit for audit trail
            try {
                await bot.database.run(`
                    INSERT INTO message_logs 
                    (guild_id, channel_id, message_id, user_id, content, attachments, embeds)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    guildId,
                    newMessage.channelId,
                    newMessage.id,
                    newMessage.author.id,
                    `[EDIT] ${newMessage.content.substring(0, 500)}`,
                    '[]',
                    '[]'
                ]);
            } catch (_) {
                // Don't block security checks if logging fails
            }

            // Run security checks on the EDITED content
            // These are the same checks as messageCreate, in the same order

            // 1. Anti-spam (duplicate/flood detection on edited content)
            if ((config.anti_spam_enabled || config.antispam_enabled) && bot.antiSpam) {
                const spamDetected = await bot.antiSpam.checkMessage(newMessage);
                if (spamDetected) return;
            }

            // 2. AutoMod filters
            if (config.automod_enabled && bot.autoMod) {
                const automodHandled = await bot.autoMod.handleMessage(newMessage, config);
                if (automodHandled) return;
            }

            // 3. Link analysis
            if (bot.linkAnalyzer) {
                const linkResult = await bot.linkAnalyzer.analyzeMessage(newMessage);
                if (linkResult?.dominated) return;
            }

            // 4. Toxicity filtering
            if (config.ai_enabled && bot.config?.get?.('ai.toxicityFilter.enabled', false) && bot.toxicityFilter) {
                const toxicityDetected = await bot.toxicityFilter.checkMessage(newMessage);
                if (toxicityDetected) return;
            }

        } catch (error) {
            bot.logger?.error?.(`[messageUpdate] Security check failed:`, error);
        }
    }
};
