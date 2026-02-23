/**
 * VerificationService - Enterprise-grade verification system
 * Handles all verification methods with persistence across restarts
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const crypto = require('crypto');

class VerificationService {
    constructor(bot) {
        this.bot = bot;
        this.challengeTTL = 10 * 60 * 1000; // 10 minutes
        this.maxAttempts = 5;
        this.maxGlobalAttempts = 15; // Total attempts across ALL sessions before lockout
        this.cooldowns = new Map(); // userId -> lastAttempt timestamp
        this.cooldownMs = 5000; // 5 seconds between attempts
    }

    /**
     * Initialize verification system for a guild
     */
    async initialize(guildId) {
        try {
            // Ensure tables exist
            await this.bot.database?.run(`
                CREATE TABLE IF NOT EXISTS verification_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guild_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    method TEXT NOT NULL,
                    code_hash TEXT,
                    token TEXT UNIQUE,
                    status TEXT DEFAULT 'pending',
                    attempts INTEGER DEFAULT 0,
                    risk_score REAL DEFAULT 0,
                    expires_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    completed_at DATETIME,
                    completed_by TEXT,
                    UNIQUE(guild_id, user_id, status)
                )
            `);

            await this.bot.database?.run(`
                CREATE INDEX IF NOT EXISTS idx_verification_sessions_lookup 
                ON verification_sessions (guild_id, user_id, status)
            `);

            await this.bot.database?.run(`
                CREATE INDEX IF NOT EXISTS idx_verification_sessions_token 
                ON verification_sessions (token) WHERE token IS NOT NULL
            `);

            this.bot.logger?.info(`[VerificationService] Initialized for guild ${guildId}`);
        } catch (err) {
            this.bot.logger?.error(`[VerificationService] Init failed: ${err.message}`);
        }
    }

    /**
     * Check if user is rate-limited
     */
    isRateLimited(userId) {
        const last = this.cooldowns.get(userId);
        if (!last) return false;
        return Date.now() - last < this.cooldownMs;
    }

    /**
     * Record rate limit
     */
    recordAttempt(userId) {
        this.cooldowns.set(userId, Date.now());
        // Cleanup old entries
        if (this.cooldowns.size > 1000) {
            const cutoff = Date.now() - this.cooldownMs * 10;
            for (const [k, v] of this.cooldowns) {
                if (v < cutoff) this.cooldowns.delete(k);
            }
        }
    }

    /**
     * Count total failed/expired verification attempts across ALL sessions for a user+guild.
     * Used to prevent infinite brute-force via session resets.
     * Returns the total number of non-pending, non-completed sessions.
     */
    async getGlobalAttemptCount(guildId, userId) {
        try {
            const row = await this.bot.database?.get(
                `SELECT COUNT(*) as cnt FROM verification_sessions 
                 WHERE guild_id = ? AND user_id = ? AND status IN ('failed', 'expired')`,
                [guildId, userId]
            );
            return row?.cnt || 0;
        } catch {
            return 0;
        }
    }

    /**
     * Check if a user is globally locked out from verification (too many total attempts).
     * After lockout, only staff can approve them.
     */
    async isGloballyLocked(guildId, userId) {
        const count = await this.getGlobalAttemptCount(guildId, userId);
        return count >= this.maxGlobalAttempts;
    }

    /**
     * Handle new member verification intake
     */
    async handleMemberJoin(member) {
        const guildId = member.guild.id;
        const userId = member.id;

        const config = await this.bot.database?.getGuildConfig(guildId);
        if (!config?.verification_enabled) return;

        this.bot.logger?.info(`[VerificationService] Processing join: ${member.user.tag} in ${member.guild.name}`);

        // Check for existing pending session (restart recovery). If found, drop it and start fresh so the member gets a fresh DM.
        const existing = await this.getPendingSession(guildId, userId);
        if (existing) {
            this.bot.logger?.info(`[VerificationService] Found existing session for ${userId} — refreshing session with current config`);
            await this.bot.database?.run(
                `DELETE FROM verification_sessions WHERE guild_id = ? AND user_id = ?`,
                [guildId, userId]
            );
        }

        // Assign unverified role
        await this.assignUnverifiedRole(member, config);

        // Calculate risk score
        const riskScore = this.calculateRiskScore(member);

        // Determine verification method from current config
        const method = this.determineMethod(config, riskScore);

        // Create verification session with current method
        const session = await this.createSession(guildId, userId, method, riskScore);

        // Send verification challenge
        await this.sendChallenge(member, session, config);

        // Notify staff if needed
        await this.notifyStaff(member, session, config);
    }

    /**
     * Calculate risk score for member
     */
    calculateRiskScore(member) {
        let score = 0;

        // Account age
        const accountAgeDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
        if (accountAgeDays < 1) score += 40;
        else if (accountAgeDays < 7) score += 25;
        else if (accountAgeDays < 30) score += 10;

        // No avatar
        if (!member.user.avatar) score += 15;

        // Suspicious username patterns
        if (/discord|admin|mod|official|support|nitro|free/i.test(member.user.username)) {
            score += 25;
        }

        // Username with excessive numbers
        if (/\d{4,}/.test(member.user.username)) score += 10;

        return Math.min(100, score);
    }

    /**
     * Determine verification method based on config and risk
     */
    determineMethod(config, riskScore) {
        const profile = config.verification_profile || 'standard';
        const configuredMethod = (config.verification_method || 'button').toLowerCase();

        // If admin explicitly chose a specific method (not 'auto'), always respect it.
        // Profile-based overrides only apply to auto/button.
        if (configuredMethod === 'web' || configuredMethod === 'reaction') {
            return configuredMethod;
        }

        if (profile === 'ultra') {
            return 'web'; // Ultra always requires web + staff approval
        }

        if (profile === 'high') {
            // High profile can escalate button → captcha based on risk
            if (configuredMethod === 'captcha') return 'captcha';
            return riskScore >= 50 ? 'captcha' : 'button';
        }

        // Standard profile - use configured method
        if (configuredMethod === 'auto') {
            return riskScore >= 60 ? 'captcha' : 'button';
        }

        return configuredMethod;
    }

    /**
     * Create verification session
     */
    async createSession(guildId, userId, method, riskScore) {
        const token = crypto.randomBytes(16).toString('hex');

        // For web method we don't require a code; for others we do.
        let code = null;
        let codeHash = null;
        if (method !== 'web') {
            code = this.generateCode();
            codeHash = this.hashCode(code);
        }

        const expiresAt = new Date(Date.now() + this.challengeTTL).toISOString();

        // Delete any existing pending sessions
        await this.bot.database?.run(
            `DELETE FROM verification_sessions WHERE guild_id = ? AND user_id = ? AND status = 'pending'`,
            [guildId, userId]
        );

        await this.bot.database?.run(
            `INSERT INTO verification_sessions (guild_id, user_id, method, code_hash, token, risk_score, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [guildId, userId, method, codeHash, token, riskScore, expiresAt]
        );

        return { guildId, userId, method, code, token, riskScore, expiresAt };
    }

    /**
     * Generate verification code
     */
    generateCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    /**
     * Hash code for storage
     */
    hashCode(code) {
        return crypto.createHash('sha256').update(code.toLowerCase()).digest('hex');
    }

    /**
     * Get pending session for user
     */
    async getPendingSession(guildId, userId) {
        return this.bot.database?.get(
            `SELECT * FROM verification_sessions 
             WHERE guild_id = ? AND user_id = ? AND status = 'pending'
             ORDER BY created_at DESC LIMIT 1`,
            [guildId, userId]
        );
    }

    /**
     * Get session by token
     */
    async getSessionByToken(token) {
        return this.bot.database?.get(
            `SELECT * FROM verification_sessions WHERE token = ? AND status = 'pending'`,
            [token]
        );
    }

    /**
     * Assign unverified role to member
     */
    async assignUnverifiedRole(member, config) {
        try {
            const guild = member.guild;
            let role = null;

            // 1) By configured ID
            if (config.unverified_role_id) {
                role = guild.roles.cache.get(config.unverified_role_id) || null;
            }

            // 2) By name fallback
            if (!role) {
                role = guild.roles.cache.find(r => r.name.toLowerCase() === 'unverified') || null;
            }

            // 3) Auto-create if still missing
            if (!role) {
                role = await guild.roles.create({
                    name: 'Unverified',
                    color: '#888888',
                    hoist: false,
                    mentionable: false,
                    reason: 'Auto-created unverified role'
                });
                this.bot.logger?.info(`[VerificationService] Auto-created Unverified role in ${guild.name}`);
            }

            if (!role) return;

            // Check hierarchy
            const botMember = guild.members.me;
            if (botMember && role.position >= botMember.roles.highest.position) {
                this.bot.logger?.warn(`[VerificationService] Cannot assign unverified role - hierarchy issue`);
                return;
            }

            await member.roles.add(role).catch(() => {});
        } catch (err) {
            this.bot.logger?.warn(`[VerificationService] Failed to assign unverified role: ${err.message}`);
        }
    }

    /**
     * Send verification challenge to member
     */
    async sendChallenge(member, session, config) {
        const embed = new EmbedBuilder()
            .setTitle('🔐 Verification Required')
            .setColor(0x00d4ff)
            .setTimestamp();

        const components = [];

        switch (session.method) {
            case 'button':
                // Button method - tell them to go to the server, no button in DM
                embed.setDescription(`Welcome to **${member.guild.name}**!\n\nTo verify and gain access, head to the **verification channel** in the server and click the verify button there.`);
                // No components - they need to click in the server, not in DMs
                break;

            case 'captcha':
                embed.setDescription(`Welcome to **${member.guild.name}**!\n\nYour verification code is: **\`${session.code}\`**\n\nClick the button below and enter this code to verify.`);
                components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`verify_button`)
                        .setLabel('🔐 Enter Code')
                        .setStyle(ButtonStyle.Primary)
                ));
                break;

            case 'web': {
                const baseUrl = process.env.BASE_URL || process.env.DASHBOARD_URL || process.env.DASHBOARD_ORIGIN || 'http://localhost:3001';
                const verifyUrl = `${baseUrl}/verify/${session.token}`;
                embed.setDescription(`Welcome to **${member.guild.name}**!\n\nClick the button below to complete verification through our secure portal.`);
                components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('🔗 Verify Now')
                        .setStyle(ButtonStyle.Link)
                        .setURL(verifyUrl)
                ));
                break;
            }

            case 'reaction':
                embed.setDescription(`Welcome to **${member.guild.name}**!\n\nClick the button below to start the emoji verification challenge.`);
                components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`verify_button`)
                        .setLabel('🎯 Start Verification')
                        .setStyle(ButtonStyle.Primary)
                ));
                break;
        }

        // Try DM first
        try {
            await member.send({ embeds: [embed], components });
            this.bot.logger?.info(`[VerificationService] Sent DM challenge to ${member.id}`);
        } catch (err) {
            // Fallback to verification channel
            if (config.verification_channel_id) {
                const channel = member.guild.channels.cache.get(config.verification_channel_id);
                if (channel?.isTextBased()) {
                    await channel.send({ content: `${member}`, embeds: [embed], components });
                    this.bot.logger?.info(`[VerificationService] Sent channel challenge for ${member.id}`);
                }
            }
        }
    }

    /**
     * Handle verify button click
     */
    async handleVerifyButton(interaction) {
        const guildId = interaction.guild?.id;
        const userId = interaction.user.id;

        // Safe reply helper to avoid "already replied" errors
        const safeReply = async (content, ephemeral = true) => {
            try {
                const flags = ephemeral ? [MessageFlags.Ephemeral] : [];
                if (interaction.replied || interaction.deferred) {
                    return interaction.followUp({ content, flags });
                }
                return interaction.reply({ content, flags });
            } catch (err) {
                this.bot.logger?.warn(`[VerificationService] Reply failed: ${err.message}`);
            }
        };

        // For DM interactions, try to find the guild from the session
        let effectiveGuildId = guildId;
        if (!effectiveGuildId) {
            // Check all pending sessions for this user
            const sessions = await this.bot.database?.all(
                `SELECT guild_id FROM verification_sessions WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
                [userId]
            );
            if (sessions && sessions.length > 0) {
                effectiveGuildId = sessions[0].guild_id;
            } else {
                return safeReply('❌ No pending verification found. Please rejoin the server to restart verification.');
            }
        }

        // Rate limit check
        if (this.isRateLimited(userId)) {
            return safeReply('⏰ Please wait a few seconds before trying again.');
        }
        this.recordAttempt(userId);

        try {
            // Global brute-force lockout: check total failed/expired sessions across all time
            if (await this.isGloballyLocked(effectiveGuildId, userId)) {
                this.bot.logger?.warn(`[VerificationService] SECURITY: User ${userId} globally locked out in guild ${effectiveGuildId} — exceeded ${this.maxGlobalAttempts} total attempts`);
                if (this.bot.forensicsManager) {
                    await this.bot.forensicsManager.logAuditEvent({
                        guildId: effectiveGuildId,
                        eventType: 'verification_lockout',
                        eventCategory: 'security',
                        executor: { id: userId },
                        target: { id: userId, type: 'user' },
                        metadata: { reason: 'global_attempt_limit_exceeded', maxGlobalAttempts: this.maxGlobalAttempts }
                    }).catch(() => {});
                }
                return safeReply('🔒 **Verification Locked**\n\nYou have exceeded the maximum number of verification attempts. Please contact a staff member for manual verification.');
            }

            const config = await this.bot.database?.getGuildConfig(effectiveGuildId);
            if (!config?.verification_enabled) {
                return safeReply('❌ Verification is not enabled in this server.');
            }

            // For button method in server, need to fetch member
            let member = null;
            if (guildId) {
                member = await interaction.guild.members.fetch(userId).catch(() => null);
                if (!member) {
                    return safeReply('❌ Could not find you in this server.');
                }
            } else {
                // For DM interactions, fetch the guild and member
                const guild = this.bot.client.guilds.cache.get(effectiveGuildId);
                if (guild) {
                    member = await guild.members.fetch(userId).catch(() => null);
                }
            }

            // Check if already verified
            if (member && config.verified_role_id && member.roles.cache.has(config.verified_role_id)) {
                return safeReply('✅ You are already verified!');
            }

            const session = await this.getPendingSession(effectiveGuildId, userId);
            const method = session?.method || config.verification_method || 'button';

            // Handle based on method
            if (method === 'button' || method === 'auto') {
                // Simple button verification - verify immediately
                try {
                    await this.completeVerification(effectiveGuildId, userId, 'button');
                    return safeReply('✅ **Verification Complete!**\n\nYou now have access to the rest of the server. Welcome!');
                } catch (verifyErr) {
                    this.bot.logger?.error(`[VerificationService] Button verify failed: ${verifyErr.message}`);
                    return safeReply('❌ Verification failed. Please contact staff.');
                }
            }

            if (method === 'captcha' || method === 'code') {
                this.bot.logger?.info(`[VerificationService] Captcha button clicked - session exists: ${!!session}`);
                
                // Check if session exists and has code
                if (!session) {
                    this.bot.logger?.info(`[VerificationService] No session found, creating new one with code`);
                    // Create new session with code
                    const newSession = await this.createSession(effectiveGuildId, userId, 'captcha', 0);
                    
                    // Try to DM the code
                    try {
                        await interaction.user.send({
                            embeds: [{
                                title: '🔐 Verification Code',
                                description: `Your verification code is:\n\n**\`${newSession.code}\`**\n\nClick the verify button again to enter this code.`,
                                color: 0x00d4ff
                            }]
                        });
                        return safeReply('📬 **Check your DMs!**\n\nA verification code has been sent. Click this button again to enter the code.');
                    } catch (dmErr) {
                        this.bot.logger?.warn(`[VerificationService] Could not DM code to ${userId}: ${dmErr.message}`);
                        // SECURITY: Never post code in plaintext in a public channel.
                        // Mark session as failed so user can retry (counts toward global limit).
                        await this.bot.database?.run(
                            `UPDATE verification_sessions SET status = 'failed' WHERE guild_id = ? AND user_id = ? AND status = 'pending'`,
                            [effectiveGuildId, userId]
                        );
                        return safeReply('❌ **Could not send verification code.**\n\nPlease enable **DMs from server members** in your privacy settings, then click verify again.\n\n*Settings → Privacy & Safety → Allow direct messages from server members*');
                    }
                }

                // Check expiry
                if (session.expires_at && new Date(session.expires_at) < new Date()) {
                    this.bot.logger?.info(`[VerificationService] Session expired`);
                    await this.bot.database?.run(
                        `UPDATE verification_sessions SET status = 'expired' WHERE id = ?`,
                        [session.id]
                    );
                    return safeReply('⏰ Your code expired. Click verify again to get a new code.');
                }

                // Show modal for code entry
                this.bot.logger?.info(`[VerificationService] Showing modal for code entry, guildId: ${effectiveGuildId}`);
                
                try {
                    const modal = new ModalBuilder()
                        .setCustomId(`verify_code_modal_${effectiveGuildId}`)
                        .setTitle('🔐 Enter Verification Code');

                    const codeInput = new TextInputBuilder()
                        .setCustomId('verification_code')
                        .setLabel('Enter the code from your DM')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('XXXXXX')
                        .setRequired(true)
                        .setMinLength(4)
                        .setMaxLength(10);

                    modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
                    
                    this.bot.logger?.info(`[VerificationService] About to show modal...`);
                    await interaction.showModal(modal);
                    this.bot.logger?.info(`[VerificationService] Modal shown successfully`);
                    return;
                } catch (modalErr) {
                    this.bot.logger?.error(`[VerificationService] Modal error: ${modalErr.message}`);
                    this.bot.logger?.error(`[VerificationService] Modal stack: ${modalErr.stack}`);
                    return safeReply('❌ Failed to show verification modal. Please try again.');
                }
            }

            // ── Web Portal method ───────────────────────────────────────
            if (method === 'web') {
                this.bot.logger?.info(`[VerificationService] Web portal button clicked by ${userId}`);

                // Create/refresh a session so the user gets a personal token-based URL
                let webSession = session;
                if (!webSession) {
                    webSession = await this.createSession(effectiveGuildId, userId, 'web', 0);
                }

                // If session expired, create a fresh one
                if (webSession.expires_at && new Date(webSession.expires_at) < new Date()) {
                    await this.bot.database?.run(
                        `UPDATE verification_sessions SET status = 'expired' WHERE id = ?`,
                        [webSession.id ?? webSession.token]
                    );
                    webSession = await this.createSession(effectiveGuildId, userId, 'web', 0);
                }

                const baseUrl = process.env.DASHBOARD_URL || process.env.DASHBOARD_ORIGIN || process.env.BASE_URL || 'http://localhost:3001';
                const verifyUrl = `${baseUrl}/verify/${webSession.token}`;

                // Reply ephemerally with the personal verify link
                try {
                    const linkRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('🔗 Open Verification Portal')
                            .setStyle(ButtonStyle.Link)
                            .setURL(verifyUrl)
                    );
                    const flags = [MessageFlags.Ephemeral];
                    if (interaction.replied || interaction.deferred) {
                        return interaction.followUp({
                            content: '🔐 **Web Verification**\n\nClick the button below to open your personal verification portal. This link is unique to you and expires in 10 minutes.',
                            components: [linkRow],
                            flags
                        });
                    }
                    return interaction.reply({
                        content: '🔐 **Web Verification**\n\nClick the button below to open your personal verification portal. This link is unique to you and expires in 10 minutes.',
                        components: [linkRow],
                        flags
                    });
                } catch (webErr) {
                    this.bot.logger?.error(`[VerificationService] Web portal reply error: ${webErr.message}`);
                    return safeReply('❌ Failed to generate verification link. Please try again.');
                }
            }

            // ── Emoji Reaction method ───────────────────────────────────
            if (method === 'reaction') {
                this.bot.logger?.info(`[VerificationService] Reaction button clicked by ${userId}`);

                // Pick a random target emoji and 3 distractors
                const allEmoji = ['🍎', '🍊', '🍋', '🍇', '🍓', '🍒', '🫐', '🍑', '🥝', '🍌', '🌽', '🥕', '🍕', '🎸', '🎮', '⚽', '🏀', '🎯', '🚀', '🌟', '🔔', '🎵', '🎲', '🧩'];
                const shuffled = allEmoji.sort(() => Math.random() - 0.5);
                const targetEmoji = shuffled[0];
                const options = shuffled.slice(0, 4).sort(() => Math.random() - 0.5);

                // Store the correct answer in the session
                // Re-use code_hash to store the target emoji (hashed)
                const emojiHash = this.hashCode(targetEmoji);
                if (!session) {
                    await this.createSession(effectiveGuildId, userId, 'reaction', 0);
                }
                await this.bot.database?.run(
                    `UPDATE verification_sessions SET code_hash = ?, attempts = 0 WHERE guild_id = ? AND user_id = ? AND status = 'pending'`,
                    [emojiHash, effectiveGuildId, userId]
                );

                const emojiRow = new ActionRowBuilder().addComponents(
                    ...options.map((emoji, i) =>
                        new ButtonBuilder()
                            .setCustomId(`verify_emoji_${effectiveGuildId}_${i}_${emoji}`)
                            .setLabel(emoji)
                            .setStyle(ButtonStyle.Secondary)
                    )
                );

                try {
                    const flags = [MessageFlags.Ephemeral];
                    const content = `🎯 **Emoji Verification**\n\nSelect the emoji: **${targetEmoji}**`;
                    if (interaction.replied || interaction.deferred) {
                        return interaction.followUp({ content, components: [emojiRow], flags });
                    }
                    return interaction.reply({ content, components: [emojiRow], flags });
                } catch (emojiErr) {
                    this.bot.logger?.error(`[VerificationService] Emoji reply error: ${emojiErr.message}`);
                    return safeReply('❌ Failed to start emoji challenge. Please try again.');
                }
            }

            // Fallback
            return safeReply('❌ Unknown verification method. Please contact staff.');
        } catch (err) {
            this.bot.logger?.error(`[VerificationService] handleVerifyButton error: ${err.message}`);
            return safeReply('❌ An error occurred. Please try again or contact staff.');
        }
    }

    /**
     * Handle emoji verification button click
     */
    async handleEmojiVerify(interaction) {
        const userId = interaction.user.id;
        // customId format: verify_emoji_{guildId}_{index}_{emoji}
        const parts = interaction.customId.split('_');
        const guildId = parts[2];
        const selectedEmoji = parts.slice(4).join('_'); // emoji might contain underscores in edge cases

        const safeReply = async (content, ephemeral = true) => {
            try {
                const flags = ephemeral ? [MessageFlags.Ephemeral] : [];
                if (interaction.replied || interaction.deferred) {
                    return interaction.followUp({ content, flags });
                }
                return interaction.reply({ content, flags });
            } catch (err) {
                this.bot.logger?.warn(`[VerificationService] Emoji reply failed: ${err.message}`);
            }
        };

        try {
            const session = await this.getPendingSession(guildId, userId);
            if (!session) {
                return safeReply('❌ No pending verification found. Please click the verify button to start again.');
            }

            // Check the selected emoji against stored hash
            const selectedHash = this.hashCode(selectedEmoji);
            if (selectedHash === session.code_hash) {
                // Correct!
                await this.completeVerification(guildId, userId, 'reaction');
                // Disable the buttons on the original message
                try {
                    await interaction.update({
                        content: '✅ **Verification Complete!**\n\nYou now have access to the rest of the server. Welcome!',
                        components: []
                    });
                } catch {
                    return safeReply('✅ **Verification Complete!**\n\nYou now have access to the rest of the server. Welcome!');
                }
                return;
            } else {
                // Wrong emoji
                await this.bot.database?.run(
                    `UPDATE verification_sessions SET attempts = attempts + 1 WHERE id = ?`,
                    [session.id]
                );
                const updated = await this.bot.database?.get(`SELECT attempts FROM verification_sessions WHERE id = ?`, [session.id]);
                if (updated?.attempts >= this.maxAttempts) {
                    await this.bot.database?.run(
                        `UPDATE verification_sessions SET status = 'failed' WHERE id = ?`,
                        [session.id]
                    );
                    try {
                        await interaction.update({
                            content: '❌ **Too many wrong attempts.** Please click the verify button to try again.',
                            components: []
                        });
                    } catch {
                        return safeReply('❌ Too many wrong attempts. Please click the verify button to try again.');
                    }
                    return;
                }
                const remaining = this.maxAttempts - (updated?.attempts || 0);
                return safeReply(`❌ Wrong emoji! ${remaining} attempts remaining. Try again by clicking the verify button.`);
            }
        } catch (err) {
            this.bot.logger?.error(`[VerificationService] handleEmojiVerify error: ${err.message}`);
            return safeReply('❌ An error occurred. Please try again.');
        }
    }

    /**
     * Handle verification code modal submit
     */
    async handleCodeModalSubmit(interaction) {
        const guildId = interaction.guild?.id;
        const userId = interaction.user.id;

        // Safe reply helper
        const safeReply = async (content, ephemeral = true) => {
            try {
                const flags = ephemeral ? [MessageFlags.Ephemeral] : [];
                if (interaction.replied || interaction.deferred) {
                    return interaction.followUp({ content, flags });
                }
                return interaction.reply({ content, flags });
            } catch (err) {
                this.bot.logger?.warn(`[VerificationService] Modal reply failed: ${err.message}`);
            }
        };

        // For DM interactions, extract guild ID from modal customId
        let effectiveGuildId = guildId;
        if (!effectiveGuildId) {
            // Modal customId format: verify_code_modal_{guildId}
            const customIdParts = interaction.customId.split('_');
            if (customIdParts.length >= 4) {
                const extractedId = customIdParts[3];
                // Validate: Discord snowflakes are 17-20 digit numeric strings
                if (/^\d{17,20}$/.test(extractedId)) {
                    effectiveGuildId = extractedId;
                }
            }
            
            if (!effectiveGuildId) {
                return safeReply('❌ Could not determine server. Please try again.');
            }
        }

        const code = interaction.fields.getTextInputValue('verification_code')?.trim()?.toUpperCase();
        if (!code) {
            return safeReply('❌ No code provided.');
        }

        try {
            // Global brute-force lockout check
            if (await this.isGloballyLocked(effectiveGuildId, userId)) {
                this.bot.logger?.warn(`[VerificationService] SECURITY: Modal submit blocked — user ${userId} globally locked in guild ${effectiveGuildId}`);
                return safeReply('🔒 **Verification Locked**\n\nYou have exceeded the maximum number of verification attempts. Please contact a staff member for manual verification.');
            }

            const session = await this.getPendingSession(effectiveGuildId, userId);
            if (!session) {
                return safeReply('❌ No pending verification found. Click verify to start again.');
            }

            // Check expiry
            if (session.expires_at && new Date(session.expires_at) < new Date()) {
                await this.bot.database?.run(
                    `UPDATE verification_sessions SET status = 'expired' WHERE id = ?`,
                    [session.id]
                );
                return safeReply('⏰ Your code expired. Click verify again to get a new code.');
            }

            // Verify code
            const codeHash = this.hashCode(code);
            if (codeHash !== session.code_hash) {
                // Increment attempts
                await this.bot.database?.run(
                    `UPDATE verification_sessions SET attempts = attempts + 1 WHERE id = ?`,
                    [session.id]
                );

                const updated = await this.bot.database?.get(`SELECT attempts FROM verification_sessions WHERE id = ?`, [session.id]);
                
                if (updated?.attempts >= this.maxAttempts) {
                    await this.bot.database?.run(
                        `UPDATE verification_sessions SET status = 'failed' WHERE id = ?`,
                        [session.id]
                    );
                    return safeReply('❌ Too many failed attempts. Please contact staff.');
                }

                const remaining = this.maxAttempts - (updated?.attempts || 0);
                return safeReply(`❌ Incorrect code. ${remaining} attempts remaining.`);
            }

            // Code is correct - verify user
            await this.completeVerification(effectiveGuildId, userId, 'captcha');
            return safeReply('✅ **Verification Complete!**\n\nYou now have access to the rest of the server. Welcome!');
        } catch (err) {
            this.bot.logger?.error(`[VerificationService] handleCodeModalSubmit error: ${err.message}`);
            return safeReply('❌ An error occurred during verification. Please try again.');
        }
    }

    /**
     * Complete verification process
     */
    async completeVerification(guildId, userId, method, completedBy = null) {
        const guild = this.bot.client.guilds.cache.get(guildId);
        if (!guild) {
            this.bot.logger?.error(`[VerificationService] completeVerification failed: Guild ${guildId} not found`);
            throw new Error('Verification failed - server not found');
        }

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) throw new Error('Member not found');

        const config = await this.bot.database?.getGuildConfig(guildId);

        // Add verified role
        if (config?.verified_role_id) {
            const role = guild.roles.cache.get(config.verified_role_id);
            if (role) {
                await member.roles.add(role).catch(() => {});
            }
        }

        // Remove unverified role
        if (config?.unverified_role_id) {
            const role = guild.roles.cache.get(config.unverified_role_id);
            if (role) {
                await member.roles.remove(role).catch(() => {});
            }
        }

        // Update session status
        await this.bot.database?.run(
            `UPDATE verification_sessions 
             SET status = 'completed', completed_at = CURRENT_TIMESTAMP, completed_by = ?
             WHERE guild_id = ? AND user_id = ? AND status = 'pending'`,
            [completedBy || userId, guildId, userId]
        );

        // Update verification_queue for compatibility
        await this.bot.database?.run(
            `UPDATE verification_queue SET status = 'completed', completed_at = CURRENT_TIMESTAMP 
             WHERE guild_id = ? AND user_id = ? AND status = 'pending'`,
            [guildId, userId]
        );

        // Log to forensics
        if (this.bot.forensicsManager) {
            await this.bot.forensicsManager.logAuditEvent({
                guildId,
                eventType: 'verification_complete',
                eventCategory: 'verification',
                executor: { id: completedBy || userId },
                target: { id: userId, type: 'user' },
                metadata: { method }
            });
        }

        // Send welcome message if configured
        await this.sendWelcomeMessage(member, config);

        this.bot.logger?.info(`[VerificationService] Verified ${userId} in ${guildId} via ${method}`);
    }

    /**
     * Send welcome message after verification
     */
    async sendWelcomeMessage(member, config) {
        if (!config?.welcome_enabled || !config?.welcome_channel) return;

        try {
            const channel = member.guild.channels.cache.get(config.welcome_channel);
            if (!channel?.isTextBased()) return;

            let message = config.welcome_message || 'Welcome {user} to **{server}**!';
            message = message
                .replace(/{user}/g, member.toString())
                .replace(/{username}/g, member.user.username)
                .replace(/{server}/g, member.guild.name)
                .replace(/{memberCount}/g, member.guild.memberCount.toString());

            await channel.send({ content: message });
        } catch (err) {
            this.bot.logger?.warn(`[VerificationService] Welcome message failed: ${err.message}`);
        }
    }

    /**
     * Notify staff about pending verification
     */
    async notifyStaff(member, session, config) {
        if (session.method !== 'web' && config.verification_profile !== 'ultra') {
            return; // Only notify for web/ultra
        }

        const channelId = config.mod_log_channel;
        if (!channelId) return;

        try {
            const channel = member.guild.channels.cache.get(channelId);
            if (!channel?.isTextBased()) return;

            const embed = new EmbedBuilder()
                .setTitle('🔔 Verification Pending (Staff Review)')
                .setDescription(`${member} requires manual verification.`)
                .addFields(
                    { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
                    { name: 'Risk Score', value: `${session.riskScore}/100`, inline: true },
                    { name: 'Method', value: session.method, inline: true }
                )
                .setColor(session.riskScore >= 60 ? 0xff0000 : 0xffcc00)
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`verify_allow_${member.id}`)
                    .setLabel('✅ Approve')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`verify_deny_${member.id}`)
                    .setLabel('❌ Deny & Kick')
                    .setStyle(ButtonStyle.Danger)
            );

            await channel.send({ embeds: [embed], components: [row] });
        } catch (err) {
            this.bot.logger?.warn(`[VerificationService] Staff notify failed: ${err.message}`);
        }
    }

    /**
     * Handle staff approval button
     */
    async handleStaffApproval(interaction, targetId, approve) {
        if (!interaction.member.permissions.has('ManageGuild') && 
            !interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const member = await interaction.guild.members.fetch(targetId).catch(() => null);
        if (!member) {
            return interaction.editReply({ content: '❌ User not found.' });
        }

        if (approve) {
            await this.completeVerification(interaction.guild.id, targetId, 'staff_approval', interaction.user.id);
            await interaction.message.edit({ components: [] });
            return interaction.editReply({ content: `✅ Approved ${member.user.tag}.` });
        } else {
            await member.kick(`Verification denied by ${interaction.user.tag}`);
            await this.bot.database?.run(
                `UPDATE verification_sessions SET status = 'rejected', completed_by = ? 
                 WHERE guild_id = ? AND user_id = ? AND status = 'pending'`,
                [interaction.user.id, interaction.guild.id, targetId]
            );
            await interaction.message.edit({ components: [] });
            return interaction.editReply({ content: `❌ Denied and kicked ${member.user.tag}.` });
        }
    }

    /**
     * Cleanup expired sessions
     */
    async cleanupExpired() {
        try {
            await this.bot.database?.run(
                `UPDATE verification_sessions SET status = 'expired' 
                 WHERE status = 'pending' AND expires_at < CURRENT_TIMESTAMP`
            );
        } catch {}
    }
}

module.exports = VerificationService;
