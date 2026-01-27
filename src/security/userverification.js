const crypto = require('crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const RiskEngine = require('../utils/RiskEngine');
const { t } = require('../../locale');

class UserVerification {
    constructor(bot) {
        this.bot = bot;
        this.riskEngine = new RiskEngine(bot);
        this.challengeTTL = 10 * 60 * 1000; // 10 minutes
        this.maxAttempts = 5; // attempt threshold before lockout
        
        // Risk alert cooldown cache: Map<`${guildId}_${userId}`, { lastAlertTime, lastRiskLevel }>
        this.alertCooldowns = new Map();
        this.alertCooldownMs = 15 * 60 * 1000; // 15 minutes cooldown
        
        // Button click rate-limit cache: Map<`${guildId}_${userId}_${action}`, timestamp>
        this.buttonCooldowns = new Map();
        this.buttonCooldownMs = 10 * 1000; // 10 seconds between same action
    }
    
    /**
     * Check if a button action is rate-limited
     * @returns {boolean} true if action should be blocked
     */
    isButtonRateLimited(guildId, userId, action) {
        const key = `${guildId}_${userId}_${action}`;
        const lastClick = this.buttonCooldowns.get(key);
        const now = Date.now();
        
        if (lastClick && (now - lastClick) < this.buttonCooldownMs) {
            return true; // Rate limited
        }
        
        // Record this click
        this.buttonCooldowns.set(key, now);
        
        // Clean old entries periodically
        if (this.buttonCooldowns.size > 500) {
            const cutoff = now - this.buttonCooldownMs;
            for (const [k, v] of this.buttonCooldowns) {
                if (v < cutoff) this.buttonCooldowns.delete(k);
            }
        }
        
        return false;
    }

    async initializeGuild(guildId) {
        this.bot.logger?.debug(`[Verification] Initialized for guild ${guildId}`);
        // Normalize legacy verified role key to unified verified_role_id
        try {
            const cfg = await this.bot.database.getGuildConfig(guildId);
            if (cfg?.verification_role && !cfg?.verified_role_id) {
                await this.bot.database.updateGuildConfig(guildId, { verified_role_id: cfg.verification_role });
                this.bot.logger?.info(`[Verification] Migrated legacy verification_role to verified_role_id for guild ${guildId}`);
            }
            // Ensure helpful indexes (SQLite supports IF NOT EXISTS for indexes)
            await this.bot.database.run(`CREATE INDEX IF NOT EXISTS idx_verification_queue_guild_user_status ON verification_queue (guild_id, user_id, status)`);
            await this.bot.database.run(`CREATE INDEX IF NOT EXISTS idx_verification_queue_expires ON verification_queue (expires_at)`);
        } catch (e) {
            this.bot.logger?.warn && this.bot.logger.warn('[Verification] Initialization normalization failed', e.message || e);
        }
    }

    async verifyNewMember(member) {
        this.bot.logger?.info(`[Verification] Intake start for ${member.user.tag} (${member.id}) in guild ${member.guild.id}`);
        const config = await this.bot.database.getGuildConfig(member.guild.id);
        if (!config?.verification_enabled) {
            this.bot.logger?.info(`[Verification] Skipped: verification_disabled for guild ${member.guild.id}`);
            return;
        }

        // Whitelist bypass
        if (await this.isWhitelisted(member)) {
            await this.markVerified(member, 'whitelist');
            return;
        }

        // Check verification profile settings
        const profile = config?.verification_profile || 'standard';
        const minAccountAgeDays = parseInt(config?.verification_min_account_age_days) || 0;
        
        // Validate minimum account age if configured
        if (minAccountAgeDays > 0) {
            const accountCreated = member.user.createdAt;
            const accountAgeDays = (Date.now() - accountCreated.getTime()) / (1000 * 60 * 60 * 24);
            
            if (accountAgeDays < minAccountAgeDays) {
                this.bot.logger?.info(`[Verification] Account too young: ${accountAgeDays.toFixed(1)} days (min: ${minAccountAgeDays}) for ${member.id}`);
                
                // Kick if auto_kick_on_timeout is enabled
                if (config?.auto_kick_unverified) {
                    try {
                        await member.send(`Your account is too young to join **${member.guild.name}**. Minimum account age: ${minAccountAgeDays} days.`).catch(() => {});
                        await member.kick('Account does not meet minimum age requirement');
                        this.bot.logger?.info(`[Verification] Kicked ${member.id} for young account`);
                        return;
                    } catch (err) {
                        this.bot.logger?.warn(`[Verification] Failed to kick ${member.id}:`, err.message);
                    }
                }
            }
        }

        // CRASH SAFETY: Wrap entire risk assessment in fail-safe
        // Principle: Fail OPEN (allow join) rather than CLOSED (block join)
        let trustScore = 80; // Safe default
        let maxThreatSeverity = 0; // Safe default
        let globalThreatReasons = [];
        let riskAssessmentFailed = false;
        
        // Fetch trust_score from user_records (default 80 for unknown users - neutral/trusted)
        try {
            const userRecord = await this.bot.database.get(
                `SELECT trust_score FROM user_records WHERE guild_id = ? AND user_id = ?`,
                [member.guild.id, member.id]
            ).catch(() => null); // DB timeout → return null
            if (userRecord?.trust_score !== undefined && userRecord?.trust_score !== null) {
                trustScore = userRecord.trust_score;
            }
            this.bot.logger?.debug(`[Verification] Trust score for ${member.id}: ${trustScore}`);
        } catch (err) {
            this.bot.logger?.warn(`[Verification] Failed to fetch trust_score (defaulting to 80): ${err.message}`);
            riskAssessmentFailed = true;
            // Continue with safe default - do not block join
        }

        // Load global threat entries if global_enabled is set for this guild
        // CRASH SAFETY: DB timeout or error → skip global data, allow join
        if (config?.global_enabled && !riskAssessmentFailed) {
            try {
                const threats = await this.bot.database.all(
                    `SELECT severity, threat_type, evidence FROM global_threats WHERE target_id = ? AND active = 1`,
                    [member.id]
                ).catch(() => []); // DB timeout → empty array
                if (threats && threats.length > 0) {
                    // Map severity to numeric values: critical=10, high=8, medium=5, low=2
                    const severityMap = { critical: 10, high: 8, medium: 5, low: 2 };
                    for (const threat of threats) {
                        const severityValue = severityMap[threat.severity?.toLowerCase()] || 2;
                        if (severityValue > maxThreatSeverity) {
                            maxThreatSeverity = severityValue;
                        }
                        globalThreatReasons.push(`global_threat:${threat.threat_type}`);
                    }
                    this.bot.logger?.info(`[Verification] Global threats found for ${member.id}: ${threats.length} entries, max severity=${maxThreatSeverity}`);
                }
            } catch (err) {
                this.bot.logger?.warn(`[Verification] Failed to fetch global threats (skipping): ${err.message}`);
                // Continue with maxThreatSeverity=0 - do not block join
            }
        }

        // Risk score - enable AI scan based on profile
        const enableAiScan = config?.enable_ai_scan || (profile === 'high' || profile === 'ultra');
        const baseRisk = enableAiScan ? this.riskEngine.scoreMember(member) : { score: 30, riskLevel: 'low', reasons: [], accountAgeDays: 0, joinVelocity: 0 };
        
        // Compute finalRiskScore: clamp(baseRiskScore - (trustScore-50)*0.4 + maxThreatSeverity*10)
        // Trust bonus: trustScore > 50 reduces risk, trustScore < 50 increases risk
        // Threat penalty: each severity point adds 10 to risk
        const trustAdjustment = (trustScore - 50) * 0.4;
        const threatPenalty = maxThreatSeverity * 10;
        const finalRiskScore = Math.max(0, Math.min(100, baseRisk.score - trustAdjustment + threatPenalty));
        
        // Determine risk level from final score using existing thresholds
        let finalRiskLevel;
        if (finalRiskScore >= 80) finalRiskLevel = 'high';
        else if (finalRiskScore >= 60) finalRiskLevel = 'medium';
        else if (finalRiskScore >= 40) finalRiskLevel = 'elevated';
        else finalRiskLevel = 'low';
        
        // Merge reasons
        const allReasons = [...(baseRisk.reasons || []), ...globalThreatReasons];
        if (trustScore < 30) allReasons.push('low_trust_score');
        if (maxThreatSeverity > 0) allReasons.push(`threat_severity_${maxThreatSeverity}`);
        
        // Create final risk object
        const risk = {
            ...baseRisk,
            score: finalRiskScore,
            riskLevel: finalRiskLevel,
            reasons: allReasons,
            trustScore: trustScore,
            maxThreatSeverity: maxThreatSeverity,
            baseScore: baseRisk.score
        };
        
        this.bot.logger?.info(`[Verification] Risk computed for ${member.id}: base=${baseRisk.score}, trust=${trustScore}, threat=${maxThreatSeverity}, final=${finalRiskScore} (${finalRiskLevel})`);
        
        if (enableAiScan) {
            // Persist final risk score to user_risk_scores
            await this.riskEngine.persistScore(member.guild.id, member.id, risk);

            if (risk.riskLevel === 'high' && risk.reasons.includes('very_new_account')) {
                await this.riskEngine.flagAlt(member.guild.id, member.id, 'age_velocity', 0.8, {
                    accountAgeDays: risk.accountAgeDays,
                    joinVelocity: risk.joinVelocity
                });
            }
            
            // Send risk alert for medium/high risk users
            if (finalRiskLevel === 'medium' || finalRiskLevel === 'high') {
                try {
                    await this.sendRiskAlert(member, risk, config);
                } catch (err) {
                    this.bot.logger?.warn(`[Verification] Failed to send risk alert: ${err.message}`);
                }
            }
        }

        // Determine verification mode based on profile
        let mode;
        if (profile === 'ultra') {
            mode = 'web'; // Ultra requires staff approval via web interface
        } else if (profile === 'high') {
            mode = risk.riskLevel === 'high' ? 'web' : 'button';
        } else {
            // Standard profile - respect configured verification method
            let configuredMethod = (config?.verification_method || config?.verification_mode || 'auto').toLowerCase();
            if (configuredMethod === 'code') configuredMethod = 'button';
            mode = configuredMethod === 'auto' ? this.chooseMode(risk) : configuredMethod;
        }
        
        this.bot.logger?.info(`[Verification] Mode decided: ${mode} (profile=${profile}, configured=${config?.verification_method}, risk=${risk.riskLevel}) for ${member.id}`);

        // If verification is not auto, assign the unverified role to restrict access immediately
        if (mode !== 'auto') {
            try {
                const unverifiedRoleId = config?.unverified_role_id || config?.unverified_role;
                if (unverifiedRoleId) {
                    const role = member.guild.roles.cache.get(unverifiedRoleId);
                    if (role) {
                        await member.roles.add(role).catch(() => {});
                    }
                }
            } catch (err) {
                this.bot.logger?.warn && this.bot.logger.warn('[Verification] Failed to assign unverified role', err.message || err);
            }
        }

        if (mode === 'auto') {
            await this.markVerified(member, 'low_risk');
            return;
        }

        // Create challenge (DM or in-guild) and notify staff
        const challengeResult = await this.createChallenge(member, mode, risk, profile);
        this.bot.logger?.info(`[Verification] Challenge created: ${JSON.stringify(challengeResult)} for ${member.id}`);
        try {
            await this.notifyStaff(member, mode, risk, challengeResult, profile);
        } catch (e) {
            this.bot.logger?.warn && this.bot.logger.warn('[Verification] notifyStaff failed', e.message || e);
        }
    }

    chooseMode(risk) {
        if (risk.riskLevel === 'high') return 'web';
        if (risk.riskLevel === 'medium') return 'button';
        if (risk.riskLevel === 'elevated') return 'button';
        return 'auto';
    }

    async isWhitelisted(member) {
        try {
            const guildId = member.guild.id;
            const userId = member.id;

            const direct = await this.bot.database.get(
                `
                SELECT 1 FROM whitelists
                WHERE guild_id = ? AND whitelist_type = 'user' AND target_id = ? AND active = 1
                    AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
            `,
                [guildId, userId]
            );
            if (direct) return true;

            const roleIds = member.roles.cache.map((r) => r.id);
            if (!roleIds.length) return false;

            const placeholders = roleIds.map(() => '?').join(',');
            const roleRow = await this.bot.database.get(
                `
                SELECT 1 FROM whitelists
                WHERE guild_id = ? AND whitelist_type = 'role'
                    AND target_id IN (${placeholders})
                    AND active = 1
                    AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
                LIMIT 1
            `,
                [guildId, ...roleIds]
            );
            return !!roleRow;
        } catch (error) {
            this.bot.logger?.error('[Verification] Whitelist check failed', error);
            return false;
        }
    }

    async createChallenge(member, mode, risk, profile = 'standard') {
        this.bot.logger?.info(`[Verification] createChallenge start: user=${member.id}, mode=${mode}, risk=${risk?.riskLevel}, profile=${profile}`);
        // For 'code' mode, generate a 4-6 digit numeric code. Otherwise fallback to hex string.
        let code;
        if (mode === 'code') {
            const digits = 4 + Math.floor(Math.random() * 3); // 4..6
            const min = Math.pow(10, digits - 1);
            const max = Math.pow(10, digits) - 1;
            code = String(Math.floor(Math.random() * (max - min + 1)) + min);
        } else {
            code = crypto.randomBytes(3).toString('hex');
        }
        const codeHash = this.hash(code);
        const expiresAt = new Date(Date.now() + this.challengeTTL).toISOString();

        // Persist challenge
        await this.bot.database.run(
            `DELETE FROM verification_queue WHERE guild_id = ? AND user_id = ?`,
            [member.guild.id, member.id]
        );

        await this.bot.database.run(
            `
            INSERT INTO verification_queue (
                guild_id, user_id, verification_type, verification_data, status,
                risk_score, attempts, expires_at, created_at
            ) VALUES (?, ?, ?, ?, 'pending', ?, 0, ?, CURRENT_TIMESTAMP)
        `,
            [
                member.guild.id,
                member.id,
                mode,
                JSON.stringify({ codeHash, mode, issuedAt: Date.now(), token: mode === 'web' ? crypto.randomBytes(16).toString('hex') : null }),
                risk.score,
                expiresAt
            ]
        );

        const guildLang = (await this.bot.database.getGuildConfig(member.guild.id))?.language || 'en';
        const embed = new EmbedBuilder()
            .setTitle(t(guildLang, 'verification.challenge.title'))
            .setDescription(
                mode === 'code'
                    ? t(guildLang, 'verification.challenge.desc.code')
                    : mode === 'web'
                        ? t(guildLang, 'verification.challenge.desc.web')
                        : t(guildLang, 'verification.challenge.desc.button')
            )
            .addFields(
                { name: t(guildLang, 'verification.challenge.field.server'), value: member.guild.name, inline: true },
                { name: t(guildLang, 'verification.challenge.field.risk'), value: risk.riskLevel, inline: true }
            )
            .setColor('#00d4ff')
            .setTimestamp();

        const actions = [];
        // Only include button for explicit button mode
        if (mode === 'button') {
            actions.push(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`verify_user_${member.guild.id}_${member.id}`)
                        .setLabel('Verify')
                        .setStyle(ButtonStyle.Success)
                )
            );
        }

        if (mode === 'code') {
            embed.addFields({ name: t(guildLang, 'verification.challenge.field.code'), value: `\`${code}\``, inline: false });
        }

        if (mode === 'web') {
            const token = crypto.randomBytes(8).toString('hex');
            const tokenExpiresAt = new Date(Date.now() + this.challengeTTL).toISOString();
            await this.bot.database.run(
                `
                UPDATE verification_queue
                SET verification_data = ?
                WHERE guild_id = ? AND user_id = ?
            `,
                [JSON.stringify({ codeHash, mode, token, issuedAt: Date.now(), tokenExpiresAt }), member.guild.id, member.id]
            );
            const backend = process.env.BACKEND_URL || 'http://localhost:3001';
            embed.addFields({
                name: t(guildLang, 'verification.challenge.web.field'),
                value: `Open: ${backend}/verify/${token}\n${t(guildLang,'verification.challenge.desc.web')}`
            });
        }

        // Set timeout for verification if configured
        try {
            const cfg = await this.bot.database.getGuildConfig(member.guild.id);
            const minutes = parseInt(cfg.verification_timeout_minutes || cfg.verification_timeout || 0) || 0;
            if (minutes > 0) {
                const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
                await this.bot.database.run(
                    `UPDATE verification_queue SET expires_at = ? WHERE guild_id = ? AND user_id = ? AND status = 'pending'`,
                    [expiresAt, member.guild.id, member.id]
                );
            }
        } catch (e) {
            this.bot.logger?.warn && this.bot.logger.warn('[Verification] Failed to set timeout', e?.message || e);
        }

        try {
            if (this.bot.dmQueue) {
                this.bot.dmQueue.enqueueDM(member, { embeds: [embed], components: actions });
                this.bot.logger?.info(`[Verification] DM enqueued to ${member.id}`);
            } else {
                await member.send({ embeds: [embed], components: actions });
                this.bot.logger?.info(`[Verification] DM sent directly to ${member.id}`);
            }
        } catch (error) {
            this.bot.logger?.warn(`[Verification] Could not DM ${member.id}, attempting in guild`, error.message);
            const fallbackChannel = member.guild.systemChannel || member.guild.channels.cache.find((c) => c.isTextBased?.() && c.permissionsFor(member.guild.members.me).has('SendMessages'));
            if (fallbackChannel) {
                await fallbackChannel.send({ content: `${member}`, embeds: [embed], components: actions });
                this.bot.logger?.info(`[Verification] Sent challenge in guild channel #${fallbackChannel.name} for ${member.id}`);
            } else {
                this.bot.logger?.warn(`[Verification] No suitable fallback channel found to send challenge for ${member.id}`);
            }
        }

        // Log challenge issued to log_channel
        try {
            const cfg = await this.bot.database.getGuildConfig(member.guild.id);
            const logChannelId = cfg.mod_log_channel || cfg.log_channel_id;
            if (logChannelId) {
                const logChannel = member.guild.channels.cache.get(logChannelId);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('🔐 Verification Challenge Issued')
                        .setDescription(`${member} (${member.user.tag})\nMethod: **${mode}**\nRisk: ${risk.riskLevel}`)
                        .setColor('#FFA500')
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                }
            }
        } catch (e) {
            this.bot.logger?.warn && this.bot.logger.warn('[Verification] Failed to log challenge issued', e?.message || e);
        }

        // Return lightweight result for callers (used to notify staff)
        return { success: true, type: mode };
    }

    /**
     * Handle a modal submit interaction containing a verification code.
     * @param {import('discord.js').ModalSubmitInteraction} interaction
     */
    async handleModalSubmit(interaction) {
        try {
            const userId = interaction.user.id;
            const pending = await this.bot.database.get(
                `
            SELECT * FROM verification_queue
            WHERE user_id = ? AND status = 'pending'
            ORDER BY created_at DESC
            LIMIT 1
        `,
                [userId]
            );

            if (!pending) {
                await interaction.reply({ content: 'No pending verification found.', ephemeral: true });
                return;
            }

            // Get guild language setting
            const guildLang = (await this.bot.database.getGuildConfig(pending.guild_id))?.language || 'en';

            const data = this.safeParse(pending.verification_data);
            const isExpired = pending.expires_at && new Date(pending.expires_at).getTime() < Date.now();
            if (isExpired) {
                await this.bot.database.run(
                    `UPDATE verification_queue SET status = 'expired', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
                    [pending.id]
                );
                await interaction.reply({ content: t(guildLang, 'verification.message.expired') || 'Verification expired. Please request a new code.', ephemeral: true });
                return;
            }

            const code = (interaction.fields.getTextInputValue && interaction.fields.getTextInputValue('verification_code')) || '';
            if (!code) {
                await interaction.reply({ content: 'No code provided.', ephemeral: true });
                return;
            }

            // Check both hash and direct code comparison (for web captcha compatibility)
            const codeHash = this.hash(code.toLowerCase());
            const matches = codeHash === data?.codeHash || code.toLowerCase() === data?.displayCode?.toLowerCase();
            
            if (!matches) {
                await this.bot.database.run(`UPDATE verification_queue SET attempts = attempts + 1 WHERE id = ?`, [pending.id]);
                const updated = await this.bot.database.get(`SELECT attempts FROM verification_queue WHERE id = ?`, [pending.id]);
                if (updated?.attempts >= this.maxAttempts) {
                    await this.bot.database.run(`UPDATE verification_queue SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pending.id]);
                    await interaction.reply({ content: t(guildLang, 'verification.message.lockout') || 'Too many failed attempts. Please contact staff.', ephemeral: true });
                } else {
                    const remaining = this.maxAttempts - updated.attempts;
                    await interaction.reply({ content: t(guildLang, 'verification.message.incorrect.remaining', { remaining }) || `Incorrect code. ${remaining} attempts remaining.`, ephemeral: true });
                }
                return;
            }

            const guild = this.bot.client.guilds.cache.get(pending.guild_id);
            if (!guild) {
                await interaction.reply({ content: 'Could not find the server for this verification. Please try again later.', ephemeral: true });
                return;
            }

            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                await interaction.reply({ content: 'You are no longer in that server.', ephemeral: true });
                return;
            }

            await this.markVerified(member, 'modal_code');
            await this.bot.database.run(`UPDATE verification_queue SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pending.id]);

            await interaction.reply({ content: t(guildLang, 'verification.message.complete') || '✅ **Verification Complete!** You now have access to the server.', ephemeral: true });
        } catch (error) {
            this.bot.logger?.error && this.bot.logger.error('[Verification] handleModalSubmit error:', error);
            try {
                await interaction.reply({ content: 'An error occurred while processing your verification.', ephemeral: true });
            } catch {};
        }
    }

    /**
     * Notify staff/mod-log channel about a pending verification so staff can approve/deny
     */
    async notifyStaff(member, mode, risk, challengeResult = {}, profile = 'standard') {
        try {
            const guild = member.guild;
            const config = await this.bot.database.getGuildConfig(guild.id);
            
            // Only send staff DM notifications if enabled and in Ultra profile
            const enableStaffDm = config?.enable_staff_dm;
            if (!enableStaffDm && profile !== 'ultra') {
                return false;
            }
            
            const channelId = config?.mod_log_channel || config?.log_channel_id || config?.logs_channel_id || config?.verified_welcome_channel_id;
            const channel = channelId ? guild.channels.cache.get(channelId) : guild.systemChannel;

            if (!channel || !channel.isTextBased?.()) return false;

            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            const embed = new EmbedBuilder()
                .setTitle('🔔 Verification Pending')
                .setDescription(`${member} has a pending verification challenge.`)
                .addFields(
                    { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
                    { name: 'Type', value: `${mode}`, inline: true },
                    { name: 'Risk', value: `${risk.riskLevel || risk.score || 'unknown'}`, inline: true },
                    { name: 'Profile', value: profile.toUpperCase(), inline: true }
                )
                .setColor('#ffcc00')
                .setTimestamp();

            // Only add action buttons if dashboard buttons are enabled
            const enableDashboardButtons = config?.enable_dashboard_buttons !== false;
            const components = [];
            
            if (enableDashboardButtons) {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`verify_allow_${member.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`verify_deny_${member.id}`).setLabel('Deny & Kick').setStyle(ButtonStyle.Danger)
                );
                components.push(row);
            }

            await channel.send({ embeds: [embed], components }).catch(() => {});
            return true;
        } catch (error) {
            this.bot.logger?.error && this.bot.logger.error('[Verification] notifyStaff error:', error);
            return false;
        }
    }

    /**
     * Send risk alert to log channel for medium/high risk users
     * Includes cooldown to prevent spam and respects manual_override flag
     * @param {import('discord.js').GuildMember} member
     * @param {Object} riskData - The computed risk data
     * @param {Object} config - Guild config
     */
    async sendRiskAlert(member, riskData, config) {
        const guild = member.guild;
        const guildId = guild.id;
        const userId = member.id;
        const cooldownKey = `${guildId}_${userId}`;
        
        // Check for manual_override (user was marked safe)
        try {
            const userRecord = await this.bot.database.get(
                `SELECT manual_override, trust_score FROM user_records WHERE guild_id = ? AND user_id = ?`,
                [guildId, userId]
            );
            
            // Skip alert if user was manually marked safe and trust is high
            if (userRecord?.manual_override && userRecord?.trust_score >= 70) {
                this.bot.logger?.info(`[Verification] Skipping risk alert for ${userId} - manual_override active with trust ${userRecord.trust_score}`);
                return;
            }
        } catch (err) {
            this.bot.logger?.debug(`[Verification] Could not check manual_override: ${err.message}`);
        }
        
        // Check cooldown - don't spam alerts for the same user
        const now = Date.now();
        const cooldownData = this.alertCooldowns.get(cooldownKey);
        if (cooldownData) {
            const timeSinceLastAlert = now - cooldownData.lastAlertTime;
            const riskLevelValue = { low: 1, elevated: 2, medium: 3, high: 4 };
            const currentRiskValue = riskLevelValue[riskData.riskLevel] || 0;
            const lastRiskValue = riskLevelValue[cooldownData.lastRiskLevel] || 0;
            
            // Only send new alert if cooldown expired OR risk increased
            if (timeSinceLastAlert < this.alertCooldownMs && currentRiskValue <= lastRiskValue) {
                const remainingMs = this.alertCooldownMs - timeSinceLastAlert;
                this.bot.logger?.info(`[Verification] Skipping risk alert for ${userId} - cooldown active (${Math.round(remainingMs/60000)}m remaining), risk not increased`);
                return;
            }
        }
        
        const channelId = config?.log_channel_id || config?.mod_log_channel || config?.logs_channel_id;
        if (!channelId) return;

        const channel = guild.channels.cache.get(channelId);
        if (!channel || !channel.isTextBased?.()) return;

        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        
        // Determine embed color based on risk level
        const colorMap = {
            high: 0xFF0000,     // Red
            medium: 0xFFA500,   // Orange
            elevated: 0xFFFF00, // Yellow
            low: 0x00FF00      // Green
        };
        
        const embed = new EmbedBuilder()
            .setTitle(`⚠️ ${riskData.riskLevel === 'high' ? 'High' : 'Medium'} Risk Member Joined`)
            .setColor(colorMap[riskData.riskLevel] || 0xFFA500)
            .setDescription(`A potentially risky user has joined the server.`)
            .addFields(
                { name: '👤 User', value: `${member.user.tag}\n${member} (${member.id})`, inline: true },
                { name: '🎯 Risk Level', value: riskData.riskLevel.toUpperCase(), inline: true },
                { name: '📊 Final Score', value: `${Math.round(riskData.score)}/100`, inline: true }
            )
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .setTimestamp();

        // Add score breakdown
        const breakdown = [
            `• Base Risk: ${riskData.baseScore || riskData.score}`,
            `• Trust Score: ${riskData.trustScore || 80} (adjustment: ${riskData.trustScore ? ((riskData.trustScore - 50) * 0.4).toFixed(1) : '0'})`,
            `• Threat Severity: ${riskData.maxThreatSeverity || 0} (penalty: +${(riskData.maxThreatSeverity || 0) * 10})`
        ].join('\n');
        embed.addFields({ name: '📈 Score Breakdown', value: breakdown, inline: false });

        // Add reasons if any
        if (riskData.reasons && riskData.reasons.length > 0) {
            const reasonsText = riskData.reasons.map(r => `• ${r.replace(/_/g, ' ')}`).join('\n');
            embed.addFields({ name: '🚩 Risk Factors', value: reasonsText.substring(0, 1024), inline: false });
        }

        // Add account age info
        const accountAgeDays = riskData.accountAgeDays || Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
        embed.addFields({ name: '📅 Account Age', value: `${accountAgeDays} days`, inline: true });

        // Add action buttons for staff (only if auto_action not enabled - warn-only mode)
        const components = [];
        if (!config?.auto_action_enabled) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`risk_action_kick_${member.id}`)
                    .setLabel('Kick')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`risk_action_ban_${member.id}`)
                    .setLabel('Ban')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`risk_action_clear_${member.id}`)
                    .setLabel('Mark Safe')
                    .setStyle(ButtonStyle.Success)
            );
            components.push(row);
        } else {
            embed.addFields({ name: '⚡ Auto-Action', value: 'Automatic actions are enabled for this guild.', inline: false });
        }

        await channel.send({ embeds: [embed], components }).catch((err) => {
            this.bot.logger?.warn(`[Verification] Failed to send risk alert: ${err.message}`);
        });
        
        // Record cooldown to prevent spam
        this.alertCooldowns.set(cooldownKey, {
            lastAlertTime: now,
            lastRiskLevel: riskData.riskLevel
        });
        
        // Clean up old cooldowns periodically (keep memory tidy)
        if (this.alertCooldowns.size > 1000) {
            const cutoff = now - this.alertCooldownMs;
            for (const [key, data] of this.alertCooldowns) {
                if (data.lastAlertTime < cutoff) {
                    this.alertCooldowns.delete(key);
                }
            }
        }
        
        this.bot.logger?.info(`[Verification] Risk alert sent for ${member.id} (${riskData.riskLevel})`);
    }

    async handleDirectMessage(message) {
        const { author } = message;
        this.bot.logger?.info(`[Verification] DM received from ${author.id}: "${message.content}"`);
        const pending = await this.bot.database.get(
            `
            SELECT * FROM verification_queue
            WHERE user_id = ? AND status = 'pending'
            ORDER BY created_at DESC
            LIMIT 1
        `,
            [author.id]
        );

        if (!pending) {
            this.bot.logger?.info(`[Verification] No pending challenge for user ${author.id}`);
            return false;
        }

        const data = this.safeParse(pending.verification_data);
        const isExpired = pending.expires_at && new Date(pending.expires_at).getTime() < Date.now();
        const guildLang = (await this.bot.database.getGuildConfig(pending.guild_id))?.language || 'en';
        if (isExpired) {
            this.bot.logger?.info(`[Verification] Challenge expired for user ${author.id}`);
            await this.bot.database.run(
                `UPDATE verification_queue SET status = 'expired', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [pending.id]
            );
            await message.reply(t(guildLang,'verification.message.expired'));
            return true;
        }

        // Button flow is handled via interaction, so DM responses are only for code/web
        const content = (message.content || '').trim();
        if (!content) {
            this.bot.logger?.info(`[Verification] Empty DM content from user ${author.id}`);
            return false;
        }

        this.bot.logger?.info(`[Verification] Checking code for user ${author.id}`);
        const matches = this.hash(content.toLowerCase()) === data?.codeHash;
        if (!matches) {
            this.bot.logger?.info(`[Verification] Incorrect code for user ${author.id}`);
            await this.bot.database.run(`UPDATE verification_queue SET attempts = attempts + 1 WHERE id = ?`, [pending.id]);
            const updated = await this.bot.database.get(`SELECT attempts FROM verification_queue WHERE id = ?`, [pending.id]);
            if (updated?.attempts >= this.maxAttempts) {
                this.bot.logger?.info(`[Verification] User ${author.id} locked out after too many attempts`);
                await this.bot.database.run(`UPDATE verification_queue SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pending.id]);
                await message.reply(t(guildLang,'verification.message.lockout'));
            } else {
                const remaining = this.maxAttempts - updated.attempts;
                await message.reply(t(guildLang,'verification.message.incorrect.remaining',{ remaining }));
            }
            return true;
        }

        this.bot.logger?.info(`[Verification] Code matched for user ${author.id}`);
        const guild = this.bot.client.guilds.cache.get(pending.guild_id);
        if (!guild) {
            this.bot.logger?.warn(`[Verification] Could not find guild ${pending.guild_id} for user ${author.id}`);
            await message.reply('Could not find the server for this verification. Please try again later.');
            return true;
        }

        const member = await guild.members.fetch(author.id).catch(() => null);
        if (!member) {
            this.bot.logger?.warn(`[Verification] User ${author.id} not found in guild ${pending.guild_id}`);
            await message.reply('You are no longer in that server.');
            return true;
        }

        await this.markVerified(member, 'dm_code');
        await this.bot.database.run(
            `UPDATE verification_queue SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [pending.id]
        );

        // Log verification success to log_channel
        try {
            const cfg = await this.bot.database.getGuildConfig(guild.id);
            const logChannelId = cfg.mod_log_channel || cfg.log_channel_id;
            if (logChannelId) {
                const logChannel = guild.channels.cache.get(logChannelId);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('✅ Verification Completed')
                        .setDescription(`${member} (${member.user.tag})\nMethod: DM Code`)
                        .setColor('#00FF00')
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                }
            }
        } catch (e) {
            this.bot.logger?.warn && this.bot.logger.warn('[Verification] Failed to log success', e?.message || e);
        }

        await message.reply(t(guildLang,'verification.message.complete'));
        this.bot.logger?.info(`[Verification] User ${author.id} successfully verified via DM code.`);
        return true;
    }

    async markVerified(member, reason) {
        try {
            const config = await this.bot.database.getGuildConfig(member.guild.id);
            // Unified key preference
            const roleId = config?.verified_role_id || config?.verification_role || config?.verification_role_id;
            if (roleId) {
                const role = member.guild.roles.cache.get(roleId);
                if (role) {
                    await member.roles.add(role).catch(() => {});
                    // Remove unverified role if present
                    const unverifiedRoleId = config?.unverified_role_id || config?.unverified_role;
                    if (unverifiedRoleId) {
                        const unRole = member.guild.roles.cache.get(unverifiedRoleId);
                        if (unRole) await member.roles.remove(unRole).catch(() => {});
                    }
                }
            }

            await this.bot.database.createOrUpdateUserRecord(member.guild.id, member.id, {
                verification_status: 'verified',
                verified_at: new Date().toISOString(),
                verification_reason: reason
            });

            // Log verification completion to log_channel
            try {
                const logChannelId = config.mod_log_channel || config.log_channel_id;
                if (logChannelId) {
                    const logChannel = member.guild.channels.cache.get(logChannelId);
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('✅ Member Verified')
                            .setDescription(`${member} (${member.user.tag})\nReason: ${reason}`)
                            .setColor('#00FF00')
                            .setTimestamp();
                        await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                    }
                }
            } catch (e) {
                this.bot.logger?.warn && this.bot.logger.warn('[Verification] Failed to log markVerified', e?.message || e);
            }

            if (this.bot.eventEmitter) {
                await this.bot.eventEmitter.emitSecurityEvent(member.guild.id, 'verification_complete', {
                    executorId: member.id,
                    details: reason
                });
            }
        } catch (error) {
            this.bot.logger?.error('[Verification] Failed to mark verified', error);
        }
    }

    // Fallback: verify code supplied via slash command instead of DM
    async verifyCodeEntry(userId, guildId, code) {
        try {
            const pending = await this.bot.database.get(
                `SELECT * FROM verification_queue WHERE guild_id = ? AND user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
                [guildId, userId]
            );
            if (!pending) {
                return { success: false, reason: 'no_pending' };
            }
            const data = this.safeParse(pending.verification_data);
            if (!data?.codeHash) {
                return { success: false, reason: 'no_code_hash' };
            }
            const isExpired = pending.expires_at && new Date(pending.expires_at).getTime() < Date.now();
            if (isExpired) {
                await this.bot.database.run(`UPDATE verification_queue SET status = 'expired', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pending.id]);
                return { success: false, reason: 'expired' };
            }
            const matches = this.hash(String(code).trim().toLowerCase()) === data.codeHash;
            if (!matches) {
                await this.bot.database.run(`UPDATE verification_queue SET attempts = attempts + 1 WHERE id = ?`, [pending.id]);
                const updated = await this.bot.database.get(`SELECT attempts FROM verification_queue WHERE id = ?`, [pending.id]);
                if (updated?.attempts >= this.maxAttempts) {
                    await this.bot.database.run(`UPDATE verification_queue SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pending.id]);
                    return { success: false, reason: 'lockout' };
                }
                return { success: false, reason: 'incorrect', remaining: this.maxAttempts - updated.attempts };
            }
            const guild = this.bot.client.guilds.cache.get(guildId);
            if (!guild) return { success: false, reason: 'guild_missing' };
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) return { success: false, reason: 'member_missing' };
            await this.markVerified(member, 'slash_code');
            await this.bot.database.run(`UPDATE verification_queue SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pending.id]);
            return { success: true };
        } catch (e) {
            this.bot.logger?.error && this.bot.logger.error('[Verification] verifyCodeEntry error', e);
            return { success: false, reason: 'error' };
        }
    }

    // Handle messages in guild verification channel when DM failed or user prefers channel
    async handleGuildChannelMessage(message) {
        try {
            const guildId = message.guild.id;
            this.bot.logger?.info(`[Verification] Channel message received in #${message.channel.name} from ${message.author.id}: "${message.content}"`);
            // Fast filter: channel name includes verify
            if (!/verify|verification/i.test(message.channel.name)) {
                this.bot.logger?.info(`[Verification] Channel name does not match verification pattern: #${message.channel.name}`);
                return false;
            }
            const pending = await this.bot.database.get(
                `SELECT * FROM verification_queue WHERE guild_id = ? AND user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
                [guildId, message.author.id]
            );
            if (!pending) {
                this.bot.logger?.info(`[Verification] No pending challenge for user ${message.author.id} in guild ${guildId}`);
                return false;
            }
            const data = this.safeParse(pending.verification_data);
            if (!data?.codeHash) {
                this.bot.logger?.info(`[Verification] No codeHash in challenge data for user ${message.author.id}`);
                return false; // Not code/web challenge
            }
            const isExpired = pending.expires_at && new Date(pending.expires_at).getTime() < Date.now();
            const guildLang = (await this.bot.database.getGuildConfig(guildId))?.language || 'en';
            if (isExpired) {
                this.bot.logger?.info(`[Verification] Challenge expired for user ${message.author.id} in guild ${guildId}`);
                await this.bot.database.run(`UPDATE verification_queue SET status = 'expired', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pending.id]);
                await message.reply(t(guildLang,'verification.message.expired'));
                return true;
            }
            const content = (message.content || '').trim();
            if (!content) {
                this.bot.logger?.info(`[Verification] Empty channel message from user ${message.author.id}`);
                return false;
            }
            this.bot.logger?.info(`[Verification] Checking code for user ${message.author.id} in channel #${message.channel.name}`);
            const matches = this.hash(content.toLowerCase()) === data.codeHash;
            if (!matches) {
                this.bot.logger?.info(`[Verification] Incorrect code for user ${message.author.id} in channel #${message.channel.name}`);
                await this.bot.database.run(`UPDATE verification_queue SET attempts = attempts + 1 WHERE id = ?`, [pending.id]);
                const updated = await this.bot.database.get(`SELECT attempts FROM verification_queue WHERE id = ?`, [pending.id]);
                if (updated?.attempts >= this.maxAttempts) {
                    this.bot.logger?.info(`[Verification] User ${message.author.id} locked out after too many attempts in channel #${message.channel.name}`);
                    await this.bot.database.run(`UPDATE verification_queue SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pending.id]);
                    await message.reply(t(guildLang,'verification.message.lockout'));
                } else {
                    const remaining = this.maxAttempts - updated.attempts;
                    await message.reply(t(guildLang,'verification.message.incorrect.remaining',{ remaining }));
                }
                return true;
            }
            this.bot.logger?.info(`[Verification] Code matched for user ${message.author.id} in channel #${message.channel.name}`);
            const member = await message.guild.members.fetch(message.author.id).catch(() => null);
            if (!member) {
                this.bot.logger?.warn(`[Verification] User ${message.author.id} not found in guild ${guildId}`);
                return true;
            }
            await this.markVerified(member, 'channel_code');
            await this.bot.database.run(`UPDATE verification_queue SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pending.id]);
            await message.reply('✅ ' + t(guildLang,'verification.message.complete'));
            // Log success
            try {
                const cfg = await this.bot.database.getGuildConfig(guildId);
                const logChannelId = cfg.mod_log_channel || cfg.log_channel_id;
                if (logChannelId) {
                    const logChannel = message.guild.channels.cache.get(logChannelId);
                    if (logChannel) {
                        const { EmbedBuilder } = require('discord.js');
                        const logEmbed = new EmbedBuilder()
                            .setTitle('✅ Verification Completed')
                            .setDescription(`${member} (${member.user.tag})\nMethod: Channel Code`)
                            .setColor('#00FF00')
                            .setTimestamp();
                        await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                    }
                }
            } catch {}
            this.bot.logger?.info(`[Verification] User ${message.author.id} successfully verified via channel code.`);
            return true;
        } catch (e) {
            this.bot.logger?.warn && this.bot.logger.warn('[Verification] handleGuildChannelMessage error', e.message || e);
            return false;
        }
    }

    hash(value) {
        return crypto.createHash('sha256').update(value).digest('hex');
    }

    safeParse(value) {
        if (!value) return null;
        try {
            return JSON.parse(value);
        } catch (e) {
            return null;
        }
    }
}

module.exports = UserVerification;
