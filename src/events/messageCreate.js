module.exports = {
    name: 'messageCreate',
    async execute(message, bot) {
        // Ignore bot messages and system messages
        if (message.author.bot || message.system) return;
        
        // Handle DM messages (verification first, then tickets)
        if (!message.guild) {
            bot.logger?.info && bot.logger.info(`[Events] DM received from ${message.author.id}: "${(message.content||'').trim()}"`);
            if (bot.userVerification?.handleDirectMessage) {
                const handled = await bot.userVerification.handleDirectMessage(message);
                bot.logger?.info && bot.logger.info(`[Events] DM verification handler returned: ${handled}`);
                if (handled) return;
            }
            if (bot.dmTicketManager) {
                return await bot.dmTicketManager.handleDM(message);
            }
            return; // Ignore DMs if ticket manager not available
        }
        
        const guildId = message.guildId;
        const userId = message.author.id;
        const channelId = message.channelId;
        
        try {
            // Early verification channel processing (code challenges in guild)
            if (bot.userVerification?.handleGuildChannelMessage) {
                const handled = await bot.userVerification.handleGuildChannelMessage(message);
                if (handled) return; // Stop further processing if verification consumed message
            }
            // Get guild configuration
            const config = await bot.database.getGuildConfig(guildId);

            // Log the message (if enabled)
            if (config && bot.config.get('logging.logMessages', true)) {
                await bot.database.run(`
                    INSERT INTO message_logs 
                    (guild_id, channel_id, message_id, user_id, content, attachments, embeds)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    guildId,
                    channelId,
                    message.id,
                    userId,
                    bot.config.get('logging.redactSensitiveContent', true) ? 
                        redactSensitiveContent(message.content) : message.content,
                    JSON.stringify(message.attachments.map(a => ({ name: a.name, size: a.size, type: a.contentType }))),
                    JSON.stringify(message.embeds.map(e => ({ title: e.title, description: e.description })))
                ]);
            }

            // Security checks
            if (config) {
                // Anti-spam detection (check both field names for compatibility)
                if ((config.anti_spam_enabled || config.antispam_enabled) && bot.antiSpam) {
                    const spamDetected = await bot.antiSpam.checkMessage(message);
                    if (spamDetected) return; // Message was handled by anti-spam
                }

                // AutoMod filters (reads from automod_settings JSON)
                if (config.automod_enabled && bot.autoMod) {
                    const automodHandled = await bot.autoMod.handleMessage(message, config);
                    if (automodHandled) return; // Message was handled by automod
                }

                // Unified link analysis
                if (bot.linkAnalyzer) {
                    const linkResult = await bot.linkAnalyzer.analyzeMessage(message);
                    if (linkResult?.dominated) return;
                }

                // Toxicity filtering (if AI is enabled)
                if (config.ai_enabled && bot.config.get('ai.toxicityFilter.enabled', false) && bot.toxicityFilter) {
                    const toxicityDetected = await bot.toxicityFilter.checkMessage(message);
                    if (toxicityDetected) return; // Message was handled
                }
            }

            // Update user activity
            await bot.database.createOrUpdateUserRecord(guildId, userId, {
                last_activity: new Date().toISOString()
            });

            // Handle commands (if it's a command)
            if (message.content.startsWith('/') || message.mentions.has(bot.client.user)) {
                await handleCommand(message, bot);
            }

            // Update behavior analysis
            if (bot.behaviorDetection) {
                await bot.behaviorDetection.analyzeMessage(message);
            }

        } catch (error) {
            bot.logger.error(`Error processing message from ${message.author.tag}:`, error);
        }
    }
};

async function handleCommand(message, bot) {
    // This is a simplified command handler
    // In a full implementation, you'd parse slash commands properly
    const content = message.content.toLowerCase();
    
    if (content.includes('help') || content.includes('commands')) {
        const helpEmbed = {
            title: '🛡️ Security Bot Commands',
            description: 'Here are the available security commands:',
            fields: [
                {
                    name: '🔧 Configuration',
                    value: '`/config` - Configure bot settings\n`/dashboard` - Access web dashboard\n`/status` - Bot status',
                    inline: true
                },
                {
                    name: '🚨 Security',
                    value: '`/lockdown` - Emergency lockdown\n`/raid-check` - Check for raids\n`/scan-links` - Scan recent links',
                    inline: true
                },
                {
                    name: '👥 Moderation',
                    value: '`/timeout` - Timeout user\n`/kick` - Kick user\n`/ban` - Ban user',
                    inline: true
                },
                {
                    name: '📊 Analytics',
                    value: '`/security-report` - Generate report\n`/audit-log` - View audit log\n`/backup` - Create backup',
                    inline: true
                }
            ],
            color: 0x3498db,
            footer: { text: 'Use /help <command> for detailed information' }
        };

        await message.reply({ embeds: [helpEmbed] });
    }
}

function redactSensitiveContent(content) {
    if (!content) return content;
    
    // Redact potential tokens, passwords, etc.
    const sensitivePatterns = [
        /[A-Za-z0-9]{24}\.[A-Za-z0-9]{6}\.[A-Za-z0-9_-]{27}/g, // Discord bot tokens
        /mfa\.[A-Za-z0-9_-]{84}/g, // Discord MFA tokens
        /[A-Za-z0-9]{64}/g, // Potential API keys
        /password[:\s=]*[^\s]+/gi, // Passwords
        /token[:\s=]*[^\s]+/gi, // Tokens
        /key[:\s=]*[^\s]+/gi // Keys
    ];

    let redacted = content;
    
    for (const pattern of sensitivePatterns) {
        redacted = redacted.replace(pattern, '[REDACTED]');
    }
    
    return redacted;
}

// Helper function for XP gain
async function handleXPGain(message, bot) {
    try {
        const guildId = message.guildId;
        const userId = message.author.id;

        // Get user's current level data
        const userData = await bot.database.get(`
            SELECT xp, level, last_xp_gain FROM user_levels
            WHERE guild_id = ? AND user_id = ?
        `, [guildId, userId]);

        // Check cooldown (1 minute between XP gains)
        if (userData && userData.last_xp_gain) {
            const lastGain = new Date(userData.last_xp_gain);
            const now = new Date();
            if ((now - lastGain) < 60000) return; // Less than 1 minute
        }

        // Calculate XP gain (random between 15-25)
        const xpGain = Math.floor(Math.random() * 11) + 15;
        const newXP = (userData?.xp || 0) + xpGain;
        const currentLevel = userData?.level || 0;

        // Calculate new level
        const newLevel = calculateLevel(newXP);
        const leveledUp = newLevel > currentLevel;

        // Update database
        if (!userData) {
            await bot.database.run(`
                INSERT INTO user_levels (guild_id, user_id, xp, level, total_messages, last_xp_gain)
                VALUES (?, ?, ?, ?, 1, datetime('now'))
            `, [guildId, userId, newXP, newLevel]);
        } else {
            await bot.database.run(`
                UPDATE user_levels 
                SET xp = ?, level = ?, total_messages = total_messages + 1, last_xp_gain = datetime('now')
                WHERE guild_id = ? AND user_id = ?
            `, [newXP, newLevel, guildId, userId]);
        }

        // Send level up message
        if (leveledUp) {
            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setColor('#00d4ff')
                .setTitle(' Level Up!')
                .setDescription(`${message.author} just reached **Level ${newLevel}**!`)
                .addFields(
                    { name: 'Total XP', value: `${newXP.toLocaleString()}`, inline: true },
                    { name: 'Messages', value: `${(userData?.total_messages || 0) + 1}`, inline: true }
                )
                .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
                .setTimestamp();

            await message.channel.send({ embeds: [embed] });

            bot.logger.info(`User ${message.author.tag} leveled up to ${newLevel} in ${message.guild.name}`);
        }
    } catch (error) {
        bot.logger.error('Error handling XP gain:', error);
    }
}

function calculateLevel(xp) {
    // Inverse of: 5 * (level^2) + 50 * level + 100
    // Using quadratic formula
    let level = 0;
    while (getXPForLevel(level + 1) <= xp) {
        level++;
    }
    return level;
}

function getXPForLevel(level) {
    return Math.floor(5 * Math.pow(level, 2) + 50 * level + 100);
}
