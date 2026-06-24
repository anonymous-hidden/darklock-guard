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
        this.bot.logger?.info('[WebVerifyTrace] VerificationService loaded with public verify URL hardening', {
            webVerifyBaseUrl: process.env.WEB_VERIFY_BASE_URL || null,
            dashboardOrigin: process.env.DASHBOARD_ORIGIN || null,
            baseUrl: process.env.BASE_URL || null,
            domain: process.env.DOMAIN || null,
            dashboardUrl: process.env.DASHBOARD_URL || null
        });
    }

    normalizeMethod(method) {
        const value = String(method || 'button').toLowerCase();
        if (value === 'code') return 'captcha';
        if (value === 'emoji') return 'reaction';
        if (value === 'emoji_sequence') return 'sequence';
        if (['button', 'captcha', 'reaction', 'sequence', 'web', 'auto'].includes(value)) {
            return value;
        }
        return 'button';
    }

    methodFromCustomId(customId) {
        if (!customId?.startsWith('verify_method_')) return null;
        return this.normalizeMethod(customId.slice('verify_method_'.length));
    }

    getVerificationBaseUrl() {
        const candidates = [
            process.env.WEB_VERIFY_BASE_URL,
            process.env.VERIFICATION_BASE_URL,
            process.env.DASHBOARD_ORIGIN,
            process.env.BASE_URL,
            process.env.DOMAIN,
            process.env.DASHBOARD_URL
        ];

        for (const raw of candidates) {
            const value = String(raw || '').trim();
            if (!value) continue;

            try {
                const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
                const url = new URL(withProtocol);
                const hostname = url.hostname.toLowerCase();
                if (hostname === 'admin.darklock.net' || hostname.startsWith('admin.')) {
                    this.bot.logger?.warn('[WebVerifyTrace] skipping admin host for public verification links', {
                        candidate: url.origin
                    });
                    continue;
                }
                return url.origin;
            } catch (_) {
                // Try the next configured URL.
            }
        }

        return process.env.NODE_ENV === 'production' ? 'https://darklock.net' : 'http://localhost:3001';
    }

    buildWebVerifyUrl(token) {
        const cacheBust = Date.now().toString(36);
        return `${this.getVerificationBaseUrl()}/verify/${encodeURIComponent(token)}?v=${cacheBust}`;
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

        this.bot.logger?.info(`[VerificationService] Processing join: ${member.user.username} in ${member.guild.name}`);

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
        const configuredMethod = this.normalizeMethod(config.verification_method);

        if (profile === 'ultra') {
            return 'captcha'; // Ultra uses captcha + staff approval
        }

        if (profile === 'high') {
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

    buildSequenceChallenge() {
        const emojis = ['🍎', '🍊', '🍋', '🍇', '🍒', '🌟', '🎯', '🔵'];
        const sequence = Array.from({ length: 4 }, () => emojis[Math.floor(Math.random() * emojis.length)]);
        return { emojis, sequence, progress: 0 };
    }

    async startSequenceChallenge(interaction, effectiveGuildId, userId, session) {
        const challenge = this.buildSequenceChallenge();
        if (!session) {
            await this.createSession(effectiveGuildId, userId, 'sequence', 0);
        }

        await this.bot.database?.run(
            `UPDATE verification_sessions SET method = 'sequence', code_hash = ? WHERE guild_id = ? AND user_id = ? AND status = 'pending'`,
            [JSON.stringify(challenge), effectiveGuildId, userId]
        );

        const makeButton = (emoji, index) => new ButtonBuilder()
            .setCustomId(`verify_sequence_${effectiveGuildId}_${index}`)
            .setLabel(emoji)
            .setStyle(ButtonStyle.Secondary);

        const rows = [
            new ActionRowBuilder().addComponents(...challenge.emojis.slice(0, 5).map(makeButton)),
            new ActionRowBuilder().addComponents(...challenge.emojis.slice(5).map((emoji, index) => makeButton(emoji, index + 5)))
        ];

        const payload = {
            content: `🎯 **Emoji Sequence Verification**\n\nClick this sequence in order:\n**${challenge.sequence.join('  ')}**`,
            components: rows,
            flags: [MessageFlags.Ephemeral]
        };

        if (interaction.replied || interaction.deferred) return interaction.followUp(payload);
        return interaction.reply(payload);
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

    async setSessionStatus(session, status, completedBy = null) {
        if (!session?.id) return;
        const guildId = session.guild_id || session.guildId;
        const userId = session.user_id || session.userId;

        if (guildId && userId) {
            await this.bot.database?.run(
                `DELETE FROM verification_sessions
                 WHERE guild_id = ? AND user_id = ? AND status = ? AND id != ?`,
                [guildId, userId, status, session.id]
            );
        }

        if (completedBy !== null) {
            await this.bot.database?.run(
                `UPDATE verification_sessions
                 SET status = ?, completed_at = CURRENT_TIMESTAMP, completed_by = ?
                 WHERE id = ?`,
                [status, completedBy, session.id]
            );
            return;
        }

        await this.bot.database?.run(
            `UPDATE verification_sessions SET status = ? WHERE id = ?`,
            [status, session.id]
        );
    }

    async setPendingSessionsStatus(guildId, userId, status, completedBy = null) {
        const sessions = await this.bot.database?.all(
            `SELECT * FROM verification_sessions
             WHERE guild_id = ? AND user_id = ? AND status = 'pending'
             ORDER BY created_at DESC`,
            [guildId, userId]
        );

        for (const session of sessions || []) {
            await this.setSessionStatus(session, status, completedBy);
        }
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
                        .setCustomId('verify_method_captcha')
                        .setLabel('🔐 Enter Code')
                        .setStyle(ButtonStyle.Primary)
                ));
                break;

            case 'web': {
                const verifyUrl = this.buildWebVerifyUrl(session.token);
                this.bot.logger?.info('[WebVerifyTrace] DM web verification link generated', {
                    guildId: member.guild.id,
                    userId: member.id,
                    method: session.method,
                    tokenTail: session.token ? String(session.token).slice(-8) : null,
                    verifyUrl
                });
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
                        .setCustomId('verify_method_reaction')
                        .setLabel('🎯 Start Verification')
                        .setStyle(ButtonStyle.Primary)
                ));
                break;

            case 'sequence':
                embed.setDescription(`Welcome to **${member.guild.name}**!\n\nClick the button below to start the emoji sequence challenge.`);
                components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('verify_method_sequence')
                        .setLabel('🎯 Start Sequence')
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

            let session = await this.getPendingSession(effectiveGuildId, userId);
            const requestedMethod = this.methodFromCustomId(interaction.customId);
            const riskScore = session?.risk_score ?? (member ? this.calculateRiskScore(member) : 0);
            const configuredMethod = this.normalizeMethod(this.determineMethod(config, riskScore));
            const configuredRawMethod = this.normalizeMethod(config.verification_method);
            const method = requestedMethod && requestedMethod !== 'auto' && requestedMethod === configuredRawMethod
                ? requestedMethod
                : configuredMethod;

            // Method changes used to leave users stuck on stale pending sessions.
            // Keep the current guild config authoritative and rebuild sessions when needed.
            if (session && this.normalizeMethod(session.method) !== method) {
                await this.bot.database?.run(
                    `DELETE FROM verification_sessions WHERE id = ?`,
                    [session.id]
                );
                session = null;
            }

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
                        await this.setPendingSessionsStatus(effectiveGuildId, userId, 'failed');
                        return safeReply('❌ **Could not send verification code.**\n\nPlease enable **DMs from server members** in your privacy settings, then click verify again.\n\n*Settings → Privacy & Safety → Allow direct messages from server members*');
                    }
                }

                // Check expiry
                if (session.expires_at && new Date(session.expires_at) < new Date()) {
                    this.bot.logger?.info(`[VerificationService] Session expired`);
                    await this.setSessionStatus(session, 'expired');
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

            if (method === 'web') {
                const webSession = session || await this.createSession(effectiveGuildId, userId, 'web', 0);
                const verifyUrl = this.buildWebVerifyUrl(webSession.token);
                this.bot.logger?.info('[WebVerifyTrace] Interaction web verification link generated', {
                    guildId: effectiveGuildId,
                    userId,
                    method,
                    tokenTail: webSession.token ? String(webSession.token).slice(-8) : null,
                    verifyUrl
                });
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('Open Verification Portal')
                        .setStyle(ButtonStyle.Link)
                        .setURL(verifyUrl)
                );
                if (interaction.replied || interaction.deferred) {
                    return interaction.followUp({
                        content: '🌐 **Web Verification Required**\n\nOpen the secure portal to complete verification.',
                        components: [row],
                        flags: [MessageFlags.Ephemeral]
                    });
                }
                return interaction.reply({
                    content: '🌐 **Web Verification Required**\n\nOpen the secure portal to complete verification.',
                    components: [row],
                    flags: [MessageFlags.Ephemeral]
                });
            }

            if (method === 'sequence' || method === 'emoji_sequence') {
                return this.startSequenceChallenge(interaction, effectiveGuildId, userId, session);
            }

            if (method === 'reaction' || method === 'emoji') {
                // Emoji challenge verification
                const emojis = ['🍎', '🍊', '🍋', '🍇', '🍒', '🌟', '🎯', '🔵', '🟢', '🔴', '🟡', '🟣'];
                // Pick 4 random emojis
                const shuffled = emojis.sort(() => 0.5 - Math.random());
                const choices = shuffled.slice(0, 4);
                const correctEmoji = choices[Math.floor(Math.random() * choices.length)];

                // Store the correct answer in the session
                const hashedAnswer = crypto.createHash('sha256').update(correctEmoji).digest('hex');
                if (session) {
                    await this.bot.database?.run(
                        `UPDATE verification_sessions SET code_hash = ? WHERE id = ?`,
                        [hashedAnswer, session.id]
                    );
                } else {
                    await this.createSession(effectiveGuildId, userId, 'reaction', 0);
                    const newSession = await this.getPendingSession(effectiveGuildId, userId);
                    if (newSession) {
                        await this.bot.database?.run(
                            `UPDATE verification_sessions SET code_hash = ? WHERE id = ?`,
                            [hashedAnswer, newSession.id]
                        );
                    }
                }

                const emojiButtons = new ActionRowBuilder().addComponents(
                    ...choices.map(emoji =>
                        new ButtonBuilder()
                            .setCustomId(`verify_emoji_${effectiveGuildId}_${emoji}`)
                            .setLabel(emoji)
                            .setStyle(ButtonStyle.Secondary)
                    )
                );

                try {
                    const flags = [MessageFlags.Ephemeral];
                    if (interaction.replied || interaction.deferred) {
                        return interaction.followUp({
                            content: `🎯 **Emoji Verification**\n\nClick the **${correctEmoji}** emoji below to verify!`,
                            components: [emojiButtons],
                            flags
                        });
                    }
                    return interaction.reply({
                        content: `🎯 **Emoji Verification**\n\nClick the **${correctEmoji}** emoji below to verify!`,
                        components: [emojiButtons],
                        flags
                    });
                } catch (err) {
                    this.bot.logger?.warn(`[VerificationService] Emoji reply failed: ${err.message}`);
                    return safeReply('❌ Failed to show emoji challenge. Please try again.');
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
        const customId = interaction.customId; // verify_emoji_{guildId}_{emoji}
        const parts = customId.split('_');
        // parts: ['verify', 'emoji', guildId, emoji]
        const guildId = parts[2];
        const selectedEmoji = parts.slice(3).join('_'); // emoji may contain underscores

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

        if (this.isRateLimited(userId)) {
            return safeReply('⏰ Please wait a few seconds before trying again.');
        }
        this.recordAttempt(userId);

        try {
            const session = await this.getPendingSession(guildId, userId);
            if (!session) {
                return safeReply('❌ No pending verification found. Please click the main verify button to start over.');
            }

            // Check if correct emoji
            const hashedSelection = crypto.createHash('sha256').update(selectedEmoji).digest('hex');
            if (hashedSelection === session.code_hash) {
                // Correct!
                await this.completeVerification(guildId, userId, 'emoji');
                return safeReply('✅ **Verification Complete!**\n\nYou now have access to the rest of the server. Welcome!');
            } else {
                // Wrong emoji
                const attempts = (session.attempts || 0) + 1;
                await this.bot.database?.run(
                    `UPDATE verification_sessions SET attempts = ? WHERE id = ?`,
                    [attempts, session.id]
                );

                if (attempts >= this.maxAttempts) {
                    await this.setSessionStatus(session, 'failed');
                    return safeReply('❌ **Verification Failed**\n\nToo many incorrect attempts. Please click the main verify button to try again.');
                }

                return safeReply(`❌ Wrong emoji! You have **${this.maxAttempts - attempts}** attempts remaining. Click the main verify button to get a new challenge.`);
            }
        } catch (err) {
            this.bot.logger?.error(`[VerificationService] Emoji verify error: ${err.message}`);
            return safeReply('❌ An error occurred. Please try again.');
        }
    }

    async handleSequenceVerify(interaction) {
        const userId = interaction.user.id;
        const parts = interaction.customId.split('_');
        const guildId = parts[2];
        const index = Number(parts[3]);

        const safeReply = async (content) => {
            try {
                if (interaction.replied || interaction.deferred) {
                    return interaction.followUp({ content, flags: [MessageFlags.Ephemeral] });
                }
                return interaction.reply({ content, flags: [MessageFlags.Ephemeral] });
            } catch (err) {
                this.bot.logger?.warn(`[VerificationService] Sequence reply failed: ${err.message}`);
            }
        };

        if (!Number.isInteger(index)) return safeReply('❌ Invalid sequence button.');
        if (this.isRateLimited(userId)) return safeReply('⏰ Please wait a few seconds before trying again.');
        this.recordAttempt(userId);

        try {
            const session = await this.getPendingSession(guildId, userId);
            if (!session) return safeReply('❌ No pending verification found. Please click the main verify button to start over.');

            let challenge = null;
            try {
                challenge = JSON.parse(session.code_hash || '{}');
            } catch {}
            if (!challenge?.sequence || !challenge?.emojis) {
                return safeReply('❌ Sequence expired. Click the main verify button to start again.');
            }

            const selected = challenge.emojis[index];
            const expected = challenge.sequence[challenge.progress || 0];
            if (selected !== expected) {
                const attempts = (session.attempts || 0) + 1;
                await this.bot.database?.run(
                    `UPDATE verification_sessions SET attempts = ? WHERE id = ?`,
                    [attempts, session.id]
                );
                if (attempts >= this.maxAttempts) {
                    await this.setSessionStatus(session, 'failed');
                    return safeReply('❌ Verification failed. Click the main verify button to try again.');
                }
                return safeReply(`❌ Wrong emoji. ${this.maxAttempts - attempts} attempt(s) remaining.`);
            }

            challenge.progress = (challenge.progress || 0) + 1;
            if (challenge.progress >= challenge.sequence.length) {
                await this.completeVerification(guildId, userId, 'sequence');
                return safeReply('✅ **Verification Complete!**\n\nYou completed the emoji sequence. Welcome!');
            }

            await this.bot.database?.run(
                `UPDATE verification_sessions SET code_hash = ? WHERE id = ?`,
                [JSON.stringify(challenge), session.id]
            );
            return safeReply(`✅ Correct. Next emoji: **${challenge.sequence[challenge.progress]}**`);
        } catch (err) {
            this.bot.logger?.error(`[VerificationService] Sequence verify failed: ${err.message}`);
            return safeReply('❌ An error occurred. Please try again or contact staff.');
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
                await this.setSessionStatus(session, 'expired');
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
                    await this.setSessionStatus(session, 'failed');
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

        await this.setPendingSessionsStatus(guildId, userId, 'completed', completedBy || userId);

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
                    { name: 'User', value: `${member.user.username} (${member.id})`, inline: true },
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
            return interaction.editReply({ content: `✅ Approved ${member.user.username}.` });
        } else {
            await member.kick(`Verification denied by ${interaction.user.username}`);
            await this.setPendingSessionsStatus(interaction.guild.id, targetId, 'rejected', interaction.user.id);
            await interaction.message.edit({ components: [] });
            return interaction.editReply({ content: `❌ Denied and kicked ${member.user.username}.` });
        }
    }

    /**
     * Cleanup expired sessions
     */
    async cleanupExpired() {
        try {
            const expired = await this.bot.database?.all(
                `SELECT * FROM verification_sessions
                 WHERE status = 'pending' AND expires_at < CURRENT_TIMESTAMP`
            );
            for (const session of expired || []) {
                await this.setSessionStatus(session, 'expired');
            }
        } catch {}
    }
}

module.exports = VerificationService;
