/**
 * SecurityMiddleware - Enterprise-grade security checks for all interactions
 * Enforces permissions, hierarchy, rate limits, and input validation
 */

const { PermissionFlagsBits } = require('discord.js');

class SecurityMiddleware {
    constructor(bot) {
        this.bot = bot;
        this.rateLimits = new Map(); // userId -> { count, windowStart }
        this.blockedUsers = new Set();
        this.suspiciousPatterns = [
            /discord\.gift/i,
            /discord\.com\/gifts/i,
            /free\s*nitro/i,
            /@everyone.*@here/i,
            /eval\s*\(/i,
            /exec\s*\(/i,
            /<script/i
        ];
    }

    /**
     * Main middleware check for commands
     */
    async checkCommand(interaction, command) {
        const checks = [
            () => this.checkBlocked(interaction),
            () => this.checkRateLimit(interaction),
            () => this.checkPermissions(interaction, command),
            () => this.checkHierarchy(interaction),
            () => this.checkInputValidation(interaction),
            () => this.checkGuildOnly(interaction, command)
        ];

        for (const check of checks) {
            const result = await check();
            if (!result.passed) {
                return result;
            }
        }

        return { passed: true };
    }

    /**
     * Check if user is blocked
     */
    checkBlocked(interaction) {
        if (this.blockedUsers.has(interaction.user.id)) {
            return {
                passed: false,
                error: '🚫 You have been blocked from using this bot.',
                code: 'BLOCKED'
            };
        }
        return { passed: true };
    }

    /**
     * Rate limit check
     */
    checkRateLimit(interaction) {
        const userId = interaction.user.id;
        const now = Date.now();
        const windowMs = 60000; // 1 minute window
        const maxRequests = 30; // max 30 commands per minute

        let userData = this.rateLimits.get(userId);
        
        if (!userData || now - userData.windowStart > windowMs) {
            // New window
            userData = { count: 1, windowStart: now };
            this.rateLimits.set(userId, userData);
            return { passed: true };
        }

        userData.count++;
        
        if (userData.count > maxRequests) {
            return {
                passed: false,
                error: '⏰ You are being rate limited. Please slow down.',
                code: 'RATE_LIMITED'
            };
        }

        return { passed: true };
    }

    /**
     * Permission check for commands
     */
    async checkPermissions(interaction, command) {
        if (!interaction.guild) return { passed: true }; // DMs

        const member = interaction.member;
        if (!member) return { passed: false, error: '❌ Could not fetch member.', code: 'NO_MEMBER' };

        // Bot owner always allowed
        if (this.isBotOwner(interaction.user.id)) {
            return { passed: true };
        }

        // Server owner always allowed
        if (interaction.guild.ownerId === interaction.user.id) {
            return { passed: true };
        }

        // Admins always allowed
        if (member.permissions.has(PermissionFlagsBits.Administrator)) {
            return { passed: true };
        }

        // Check command's required permissions
        if (command.data?.default_member_permissions) {
            const requiredPerms = BigInt(command.data.default_member_permissions);
            if (!member.permissions.has(requiredPerms)) {
                return {
                    passed: false,
                    error: '🚫 You do not have the required permissions for this command.',
                    code: 'MISSING_PERMISSIONS'
                };
            }
        }

        // Check custom permission manager
        if (this.bot.permissionManager) {
            const allowed = await this.bot.permissionManager.isAllowed(interaction);
            if (!allowed) {
                return {
                    passed: false,
                    error: '🚫 You do not have permission to use this command. Ask a server admin to grant access.',
                    code: 'PERMISSION_DENIED'
                };
            }
        }

        return { passed: true };
    }

    /**
     * Hierarchy check for moderation commands
     */
    async checkHierarchy(interaction) {
        const moderationCommands = ['ban', 'kick', 'timeout', 'mute', 'warn', 'quarantine'];
        
        if (!moderationCommands.includes(interaction.commandName)) {
            return { passed: true };
        }

        const targetUser = interaction.options?.getUser('user') || interaction.options?.getUser('target');
        if (!targetUser || !interaction.guild) {
            return { passed: true };
        }

        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) {
            return { passed: true }; // User not in guild, allow the command
        }

        const executorMember = interaction.member;
        const botMember = interaction.guild.members.me;

        // Check executor hierarchy
        if (targetMember.roles.highest.position >= executorMember.roles.highest.position) {
            if (interaction.guild.ownerId !== executorMember.id) {
                return {
                    passed: false,
                    error: '❌ You cannot moderate someone with equal or higher roles.',
                    code: 'HIERARCHY_EXECUTOR'
                };
            }
        }

        // Check bot hierarchy
        if (botMember && targetMember.roles.highest.position >= botMember.roles.highest.position) {
            return {
                passed: false,
                error: '❌ I cannot moderate someone with equal or higher roles than me.',
                code: 'HIERARCHY_BOT'
            };
        }

        // Check if target is server owner
        if (targetMember.id === interaction.guild.ownerId) {
            return {
                passed: false,
                error: '❌ You cannot moderate the server owner.',
                code: 'CANNOT_MOD_OWNER'
            };
        }

        // Check protected roles
        const config = await this.bot.database?.getGuildConfig(interaction.guild.id);
        if (config?.protected_roles) {
            let protectedRoles = [];
            try {
                protectedRoles = JSON.parse(config.protected_roles);
            } catch {}

            if (protectedRoles.some(r => targetMember.roles.cache.has(r))) {
                return {
                    passed: false,
                    error: '❌ This user has a protected role and cannot be moderated.',
                    code: 'PROTECTED_ROLE'
                };
            }
        }

        return { passed: true };
    }

    /**
     * Input validation
     */
    checkInputValidation(interaction) {
        // Check all string options for suspicious content
        if (interaction.options && interaction.options.data) {
            const stringOptions = (interaction.options.data || []).filter(o => o && typeof o.value === 'string');
            
            for (const option of stringOptions) {
                const value = option.value;
                
                // Check for suspicious patterns
                for (const pattern of this.suspiciousPatterns) {
                    if (pattern.test(value)) {
                        this.bot.logger?.warn(`[SecurityMiddleware] Suspicious input blocked from ${interaction.user.id}: ${value.slice(0, 100)}`);
                        return {
                            passed: false,
                            error: '❌ Your input contains blocked content.',
                            code: 'SUSPICIOUS_INPUT'
                        };
                    }
                }

                // Check for excessive length
                if (value.length > 4000) {
                    return {
                        passed: false,
                        error: '❌ Input is too long.',
                        code: 'INPUT_TOO_LONG'
                    };
                }
            }
        }

        return { passed: true };
    }

    /**
     * Guild-only check
     */
    checkGuildOnly(interaction, command) {
        if (command.guildOnly !== false && !interaction.guild) {
            return {
                passed: false,
                error: '❌ This command can only be used in a server.',
                code: 'GUILD_ONLY'
            };
        }
        return { passed: true };
    }

    /**
     * Check if user is bot owner
     */
    isBotOwner(userId) {
        const owners = (process.env.BOT_OWNERS || '').split(',').map(s => s.trim());
        return owners.includes(userId);
    }

    /**
     * Block a user
     */
    blockUser(userId) {
        this.blockedUsers.add(userId);
    }

    /**
     * Unblock a user
     */
    unblockUser(userId) {
        this.blockedUsers.delete(userId);
    }

    /**
     * Validate snowflake (Discord ID)
     */
    isValidSnowflake(id) {
        return /^\d{17,20}$/.test(String(id));
    }

    /**
     * Sanitize string input
     */
    sanitize(input) {
        if (typeof input !== 'string') return input;
        return input
            .replace(/@everyone/gi, '@\u200beveryone')
            .replace(/@here/gi, '@\u200bhere')
            .slice(0, 4000);
    }

    /**
     * Audit log for security events
     */
    async logSecurityEvent(type, data) {
        try {
            if (this.bot.forensicsManager) {
                await this.bot.forensicsManager.logAuditEvent({
                    guildId: data.guildId,
                    eventType: `security_${type}`,
                    eventCategory: 'security',
                    executor: data.executor,
                    target: data.target,
                    metadata: data.metadata
                });
            }
        } catch {}
    }

    /**
     * Check button interaction security
     */
    async checkButton(interaction) {
        // Basic checks
        const blockedCheck = this.checkBlocked(interaction);
        if (!blockedCheck.passed) return blockedCheck;

        const rateLimitCheck = this.checkRateLimit(interaction);
        if (!rateLimitCheck.passed) return rateLimitCheck;

        // Custom ID validation
        const customId = interaction.customId;
        if (!customId || customId.length > 100) {
            return {
                passed: false,
                error: '❌ Invalid button.',
                code: 'INVALID_BUTTON'
            };
        }

        // Check for tampering (IDs shouldn't contain certain characters)
        if (/[<>'"`;{}]/.test(customId)) {
            this.bot.logger?.warn(`[SecurityMiddleware] Suspicious button ID: ${customId}`);
            return {
                passed: false,
                error: '❌ Invalid button ID.',
                code: 'SUSPICIOUS_BUTTON'
            };
        }

        return { passed: true };
    }

    /**
     * Check modal submission security
     */
    async checkModal(interaction) {
        const blockedCheck = this.checkBlocked(interaction);
        if (!blockedCheck.passed) return blockedCheck;

        const rateLimitCheck = this.checkRateLimit(interaction);
        if (!rateLimitCheck.passed) return rateLimitCheck;

        // Validate all field inputs
        for (const component of interaction.components) {
            for (const field of component.components) {
                if (field.value) {
                    for (const pattern of this.suspiciousPatterns) {
                        if (pattern.test(field.value)) {
                            return {
                                passed: false,
                                error: '❌ Your input contains blocked content.',
                                code: 'SUSPICIOUS_MODAL_INPUT'
                            };
                        }
                    }
                }
            }
        }

        return { passed: true };
    }

    /**
     * Cleanup old rate limit data
     */
    cleanup() {
        const now = Date.now();
        const windowMs = 60000;

        for (const [userId, data] of this.rateLimits) {
            if (now - data.windowStart > windowMs * 2) {
                this.rateLimits.delete(userId);
            }
        }
    }
}

module.exports = SecurityMiddleware;
