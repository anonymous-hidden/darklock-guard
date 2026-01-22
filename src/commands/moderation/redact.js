/**
 * Redact & Delete - Message Context Menu Command
 * 
 * A privacy-focused feature that protects message content from "see deleted messages"
 * client mods by editing the message to neutral text before deletion.
 * 
 * This ensures logger clients record the redacted placeholder instead of the original message.
 * 
 * Security Features:
 * - Per-user rate limiting (5 uses per minute)
 * - Permission validation (author or MANAGE_MESSAGES)
 * - Message age validation (< 14 days)
 * - Safe logging (no content stored)
 */

const { ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits } = require('discord.js');
const { Collection } = require('discord.js');

// Configurable redaction placeholder - plain ASCII only
const REDACTION_PLACEHOLDER = '[Message removed]';

// Delay between edit and delete (ms) - allows edit to propagate
const PROPAGATION_DELAY = 400;

// Rate limit settings
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 5;        // Max 5 uses per minute

// Per-user cooldown tracking
const userCooldowns = new Collection();

/**
 * Check if user is rate limited
 * @param {string} userId - User ID
 * @returns {{ limited: boolean, remaining: number, resetIn: number }}
 */
function checkRateLimit(userId) {
    const now = Date.now();
    
    if (!userCooldowns.has(userId)) {
        userCooldowns.set(userId, { uses: 0, windowStart: now });
    }
    
    const userData = userCooldowns.get(userId);
    
    // Reset window if expired
    if (now - userData.windowStart > RATE_LIMIT_WINDOW) {
        userData.uses = 0;
        userData.windowStart = now;
    }
    
    const remaining = RATE_LIMIT_MAX - userData.uses;
    const resetIn = Math.max(0, RATE_LIMIT_WINDOW - (now - userData.windowStart));
    
    return {
        limited: userData.uses >= RATE_LIMIT_MAX,
        remaining,
        resetIn
    };
}

/**
 * Increment rate limit counter
 * @param {string} userId - User ID
 */
function incrementRateLimit(userId) {
    const userData = userCooldowns.get(userId);
    if (userData) {
        userData.uses++;
    }
}

/**
 * Validate bot permissions in channel
 * @param {import('discord.js').Channel} channel 
 * @param {import('discord.js').Client} client 
 * @returns {{ valid: boolean, missing: string[] }}
 */
function validateBotPermissions(channel, client) {
    const botMember = channel.guild.members.cache.get(client.user.id);
    if (!botMember) {
        return { valid: false, missing: ['Bot not in guild'] };
    }
    
    const permissions = channel.permissionsFor(botMember);
    const missing = [];
    
    if (!permissions.has(PermissionFlagsBits.ViewChannel)) {
        missing.push('View Channel');
    }
    if (!permissions.has(PermissionFlagsBits.ReadMessageHistory)) {
        missing.push('Read Message History');
    }
    if (!permissions.has(PermissionFlagsBits.ManageMessages)) {
        missing.push('Manage Messages');
    }
    
    return {
        valid: missing.length === 0,
        missing
    };
}

/**
 * Check if user can redact the target message
 * @param {import('discord.js').GuildMember} member - Executing member
 * @param {import('discord.js').Message} message - Target message
 * @returns {boolean}
 */
function canUserRedact(member, message) {
    // User is the message author
    if (message.author.id === member.id) {
        return true;
    }
    
    // User has Manage Messages permission
    if (member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return true;
    }
    
    return false;
}

/**
 * Sleep utility
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    // Context Menu Command Builder
    data: new ContextMenuCommandBuilder()
        .setName('Redact & Delete')
        .setType(ApplicationCommandType.Message)
        .setDMPermission(false),
    
    // Command metadata
    cooldown: 3,
    category: 'moderation',
    description: 'Safely delete a message by redacting content first (defeats message logger mods)',
    
    /**
     * Execute the redact & delete command
     * @param {import('discord.js').MessageContextMenuCommandInteraction} interaction 
     * @param {object} bot - Bot instance
     */
    async execute(interaction, bot) {
        // Validate guild context
        if (!interaction.guild) {
            return await interaction.reply({
                content: '❌ This command can only be used in servers.',
                ephemeral: true
            });
        }
        
        if (!interaction.member) {
            return await interaction.reply({
                content: '❌ Could not verify your server membership.',
                ephemeral: true
            });
        }
        
        if (!interaction.channel) {
            return await interaction.reply({
                content: '❌ Could not access channel information.',
                ephemeral: true
            });
        }
        
        // Defer reply immediately (ephemeral for privacy)
        await interaction.deferReply({ ephemeral: true });
        
        const targetMessage = interaction.targetMessage;
        const member = interaction.member;
        const channel = interaction.channel;
        
        // ═══════════════════════════════════════════════════════════════
        // RATE LIMIT CHECK
        // ═══════════════════════════════════════════════════════════════
        const rateLimit = checkRateLimit(interaction.user.id);
        if (rateLimit.limited) {
            const resetSeconds = Math.ceil(rateLimit.resetIn / 1000);
            return await interaction.editReply({
                content: `⏰ Rate limited. You can use this command again in ${resetSeconds} seconds.`
            });
        }
        
        // ═══════════════════════════════════════════════════════════════
        // BOT PERMISSION VALIDATION
        // ═══════════════════════════════════════════════════════════════
        const botPerms = validateBotPermissions(channel, interaction.client);
        if (!botPerms.valid) {
            return await interaction.editReply({
                content: `❌ Bot missing required permissions: ${botPerms.missing.join(', ')}`
            });
        }
        
        // ═══════════════════════════════════════════════════════════════
        // USER PERMISSION VALIDATION
        // ═══════════════════════════════════════════════════════════════
        if (!canUserRedact(member, targetMessage)) {
            return await interaction.editReply({
                content: '❌ You can only redact your own messages or messages you can manage.'
            });
        }
        
        // ═══════════════════════════════════════════════════════════════
        // MESSAGE STATE VALIDATION
        // ═══════════════════════════════════════════════════════════════
        
        // Check if message still exists
        if (!targetMessage || targetMessage.deleted) {
            return await interaction.editReply({
                content: '❌ Message not found or already deleted.'
            });
        }
        
        // Check message age (14 day Discord limit for editing)
        const messageAge = Date.now() - targetMessage.createdTimestamp;
        const fourteenDays = 14 * 24 * 60 * 60 * 1000;
        
        if (messageAge > fourteenDays) {
            return await interaction.editReply({
                content: '❌ Cannot redact messages older than 14 days.'
            });
        }
        
        // Determine if we can edit this message
        const isOwnMessage = targetMessage.author.id === interaction.user.id;
        const isSystemMessage = targetMessage.system === true;
        const isWebhook = targetMessage.webhookId !== null && targetMessage.webhookId !== undefined;
        const isReply = targetMessage.type === 19; // REPLY type
        const isDefaultMessage = targetMessage.type === 0 || targetMessage.type === 19; // DEFAULT or REPLY
        
        // Check if message is editable by the user
        // Only the message author can edit their own non-system, non-webhook messages
        const canEdit = isOwnMessage && !isSystemMessage && !isWebhook && isDefaultMessage;
        
        if (!canEdit) {
            // Can't edit - check if we can at least delete it
            const hasMod = interaction.member.permissions.has(PermissionFlagsBits.ManageMessages);
            
            if (!isOwnMessage && !hasMod) {
                return await interaction.editReply({
                    content: '❌ You can only redact your own messages or messages you can manage.'
                });
            }
            
            // Delete without redaction
            try {
                await targetMessage.delete();
                incrementRateLimit(interaction.user.id);
                
                // Log action (safe mode - no content)
                await logRedaction(bot, interaction, targetMessage, false);
                
                const reason = isSystemMessage ? 'system message' :
                               isWebhook ? 'webhook message' :
                               !isDefaultMessage ? `message type ${targetMessage.type}` :
                               !isOwnMessage ? 'not your message' : 'cannot edit';
                
                return await interaction.editReply({
                    content: `✅ Message deleted (redaction not possible: ${reason}).`
                });
            } catch (deleteError) {
                bot.logger?.error('Redact delete failed:', deleteError);
                
                if (deleteError.code === 50013) {
                    return await interaction.editReply({
                        content: '❌ Missing permissions to delete this message.'
                    });
                }
                
                return await interaction.editReply({
                    content: `❌ Failed to delete message: ${deleteError.message}`
                });
            }
        }
        
        // ═══════════════════════════════════════════════════════════════
        // REDACTION EXECUTION (CRITICAL ORDER)
        // ═══════════════════════════════════════════════════════════════
        
        try {
            // Step 1: Edit message to redaction placeholder (EXACTLY ONCE)
            try {
                await targetMessage.edit({
                    content: REDACTION_PLACEHOLDER,
                    embeds: [],        // Remove embeds
                    files: [],         // Note: Can't remove attachments via edit
                    components: []     // Remove components
                });
            } catch (editError) {
                // Edit failed - try to just delete instead
                bot.logger?.warn('Edit failed, deleting without redaction:', editError);
                
                try {
                    await targetMessage.delete();
                    incrementRateLimit(interaction.user.id);
                    await logRedaction(bot, interaction, targetMessage, false);
                    
                    return await interaction.editReply({
                        content: '✅ Message deleted (edit failed, but deletion succeeded).'
                    });
                } catch (deleteError) {
                    throw deleteError; // Rethrow to outer catch
                }
            }
            
            // Step 2: Short delay to allow edit to propagate
            await sleep(PROPAGATION_DELAY);
            
            // Step 3: Delete the message
            await targetMessage.delete();
            
            // Step 4: Increment rate limit counter
            incrementRateLimit(interaction.user.id);
            
            // Step 5: Log action (safe mode - no content)
            await logRedaction(bot, interaction, targetMessage, true);
            
            // Success response
            return await interaction.editReply({
                content: '✅ Message redacted and deleted successfully.'
            });
            
        } catch (error) {
            bot.logger?.error('Redact operation failed:', error);
            
            // Discord API error codes
            if (error.code === 50005) {
                return await interaction.editReply({
                    content: '❌ Cannot edit this message type.'
                });
            }
            
            if (error.code === 10008) {
                return await interaction.editReply({
                    content: '❌ Message was already deleted.'
                });
            }
            
            if (error.code === 50013) {
                return await interaction.editReply({
                    content: '❌ Missing permissions to edit/delete this message.'
                });
            }
            
            if (error.code === 50035) {
                return await interaction.editReply({
                    content: '❌ Invalid message content or structure.'
                });
            }
            
            return await interaction.editReply({
                content: `❌ Failed to redact message: ${error.message || 'Unknown error'}`
            });
        }
    }
};

/**
 * Log redaction action (SAFE MODE - no content logged)
 * @param {object} bot - Bot instance
 * @param {import('discord.js').MessageContextMenuCommandInteraction} interaction 
 * @param {import('discord.js').Message} message 
 * @param {boolean} wasRedacted - Whether edit succeeded before delete
 */
async function logRedaction(bot, interaction, message, wasRedacted) {
    try {
        // Log to bot logger (SAFE - no message content)
        if (bot.logger) {
            await bot.logger.logSecurityEvent({
                eventType: 'MESSAGE_REDACT_DELETE',
                guildId: interaction.guild.id,
                channelId: interaction.channel.id,
                messageId: message.id,
                executorId: interaction.user.id,
                executorTag: interaction.user.tag,
                targetAuthorId: message.author.id,
                wasRedacted: wasRedacted,
                timestamp: new Date().toISOString()
                // INTENTIONALLY OMITTED: content, embeds, attachments
            });
        }
        
        // Log to forensics manager if available
        if (bot.forensicsManager) {
            await bot.forensicsManager.logAuditEvent({
                guildId: interaction.guild.id,
                eventType: 'MESSAGE_REDACT_DELETE',
                eventCategory: 'moderation',
                executor: { 
                    id: interaction.user.id, 
                    tag: interaction.user.tag 
                },
                target: {
                    type: 'message',
                    id: message.id,
                    authorId: message.author.id
                },
                metadata: {
                    channelId: interaction.channel.id,
                    wasRedacted: wasRedacted
                    // INTENTIONALLY OMITTED: content, embeds, attachments
                }
            });
        }
        
        // Broadcast to dashboard console
        if (typeof bot.broadcastConsole === 'function') {
            bot.broadcastConsole(
                interaction.guild.id, 
                `[REDACT] ${interaction.user.tag} redacted message ${message.id} in #${interaction.channel.name}`
            );
        }
        
    } catch (logError) {
        // Don't fail the command if logging fails
        bot.logger?.warn('Failed to log redaction:', logError);
    }
}
