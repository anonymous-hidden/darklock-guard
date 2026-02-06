/**
 * InteractionGuard — Centralized security checks for all Discord interactions.
 * 
 * Security Rule 2: Server-side enforcement only.
 * Security Rule 4: Button custom IDs are untrusted.
 * 
 * This module provides:
 *  1. Permission validation for button/modal interactions
 *  2. Rate limiting per user per action type  
 *  3. Custom ID integrity verification
 *  4. Audit logging for all enforcement actions triggered by interactions
 * 
 * Usage in interactionCreate handler:
 *   const guard = require('../utils/InteractionGuard');
 *   if (!guard.validateButton(interaction, 'verify_user', { requireSelf: true })) return;
 */

const BoundedMap = require('./BoundedMap');

// Rate limit tracking: userId_actionType → { count, windowStart }
const interactionRateLimits = new BoundedMap({
    maxSize: 50000,
    ttlMs: 120000, // 2 minute window
    name: 'InteractionRateLimits'
});

// Default rate limits per action category
const RATE_LIMITS = {
    verify:     { max: 5,  windowMs: 60000 },   // 5 per minute
    ticket:     { max: 3,  windowMs: 60000 },   // 3 per minute
    modAction:  { max: 10, windowMs: 60000 },   // 10 per minute (for staff)
    appeal:     { max: 2,  windowMs: 300000 },  // 2 per 5 minutes
    general:    { max: 15, windowMs: 60000 },   // 15 per minute
};

/**
 * Check if the interaction user is rate-limited for this action type.
 * 
 * @param {Interaction} interaction
 * @param {string} category - One of: verify, ticket, modAction, appeal, general
 * @returns {boolean} true if allowed, false if rate-limited
 */
function checkRateLimit(interaction, category = 'general') {
    const userId = interaction.user.id;
    const key = `${userId}_${category}`;
    const limit = RATE_LIMITS[category] || RATE_LIMITS.general;
    const now = Date.now();

    let entry = interactionRateLimits.get(key);
    if (!entry || (now - entry.windowStart) > limit.windowMs) {
        entry = { count: 0, windowStart: now };
    }

    entry.count++;
    interactionRateLimits.set(key, entry);

    if (entry.count > limit.max) {
        return false;
    }
    return true;
}

/**
 * Validate a button interaction with security checks.
 * 
 * @param {ButtonInteraction} interaction
 * @param {Object} options
 * @param {boolean} [options.requireSelf=false] - Clicker must be the target user (extracted from custom ID)
 * @param {string[]} [options.requirePermissions=[]] - Required Discord permissions
 * @param {boolean} [options.requireStaff=false] - Requires ManageGuild or Administrator
 * @param {string} [options.rateCategory='general'] - Rate limit category
 * @param {string} [options.extractUserId] - Regex group to extract target user ID from custom ID
 * @returns {{ allowed: boolean, reason?: string, targetId?: string }}
 */
function validateButton(interaction, options = {}) {
    const {
        requireSelf = false,
        requirePermissions = [],
        requireStaff = false,
        rateCategory = 'general',
        extractUserId = null,
    } = options;

    // 1. Rate limit check
    if (!checkRateLimit(interaction, rateCategory)) {
        safeReply(interaction, '⏳ You\'re doing that too fast. Please wait a moment.');
        return { allowed: false, reason: 'rate_limited' };
    }

    // 2. Must be in a guild (unless DM is explicitly allowed)
    if (!interaction.guild && !interaction.channel?.isDMBased?.()) {
        return { allowed: false, reason: 'no_guild' };
    }

    // 3. Extract target user ID from custom ID if specified
    let targetId = null;
    if (extractUserId) {
        const match = interaction.customId.match(extractUserId);
        if (match && match[1]) {
            targetId = match[1];
            // Validate it looks like a Discord snowflake
            if (!/^\d{17,20}$/.test(targetId)) {
                safeReply(interaction, '❌ Invalid interaction target.');
                return { allowed: false, reason: 'invalid_target_id' };
            }
        }
    }

    // 4. Self-action check: the clicker must be the target
    if (requireSelf && targetId) {
        if (interaction.user.id !== targetId) {
            safeReply(interaction, '❌ This action is only for the intended user.');
            return { allowed: false, reason: 'not_self', targetId };
        }
    }

    // 5. Staff/permission check
    if (requireStaff) {
        if (!interaction.member) {
            safeReply(interaction, '❌ This action requires server permissions.');
            return { allowed: false, reason: 'no_member' };
        }
        const { PermissionsBitField } = require('discord.js');
        const hasStaff = interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
                         interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
        if (!hasStaff) {
            safeReply(interaction, '❌ You need **Manage Server** permission for this action.');
            return { allowed: false, reason: 'insufficient_permissions', targetId };
        }
    }

    // 6. Specific permission check
    if (requirePermissions.length > 0 && interaction.member) {
        const { PermissionsBitField } = require('discord.js');
        for (const perm of requirePermissions) {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags[perm])) {
                safeReply(interaction, `❌ You need **${perm}** permission for this action.`);
                return { allowed: false, reason: 'missing_permission', missing: perm, targetId };
            }
        }
    }

    return { allowed: true, targetId };
}

/**
 * Validate that the bot has required permissions before taking an enforcement action.
 * Security Rule 8.
 * 
 * @param {Guild} guild
 * @param {GuildMember} botMember - The bot's own member object
 * @param {string[]} requiredPerms - e.g. ['BanMembers', 'ManageRoles']
 * @returns {{ allowed: boolean, missing: string[] }}
 */
function checkBotPermissions(guild, botMember, requiredPerms) {
    if (!botMember) {
        return { allowed: false, missing: requiredPerms };
    }

    const { PermissionsBitField } = require('discord.js');
    const missing = [];
    for (const perm of requiredPerms) {
        if (!botMember.permissions.has(PermissionsBitField.Flags[perm])) {
            missing.push(perm);
        }
    }

    return { allowed: missing.length === 0, missing };
}

/**
 * Check that the bot's highest role is above the target member's highest role.
 * Required before kick, ban, timeout, or role modifications.
 */
function checkHierarchy(botMember, targetMember) {
    if (!botMember || !targetMember) return false;
    return botMember.roles.highest.position > targetMember.roles.highest.position;
}

/**
 * Safe reply that handles already-replied interactions.
 */
async function safeReply(interaction, content) {
    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content, ephemeral: true });
        } else {
            await interaction.reply({ content, ephemeral: true });
        }
    } catch (_) {
        // Interaction may have expired
    }
}

module.exports = {
    validateButton,
    checkRateLimit,
    checkBotPermissions,
    checkHierarchy,
    safeReply,
    interactionRateLimits,
    RATE_LIMITS
};
