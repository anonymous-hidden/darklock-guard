const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const crypto = require('crypto');

/**
 * Enhanced Verification System
 * Supports: Image Captcha, Emoji Verification, Web Captcha, Adaptive Difficulty
 */
class VerificationSystem {
    constructor(database, client) {
        this.db = database;
        this.client = client;
        this.activeChallenges = new Map();
    }

    /**
     * Determine verification type based on risk score
     */
    async getVerificationType(guild, member, riskScore) {
        if (riskScore >= 80) {
            return 'web_captcha'; // Hardest
        } else if (riskScore >= 60) {
            return 'emoji_sequence'; // Medium
        } else if (riskScore >= 40) {
            return 'emoji_reaction'; // Easy
        } else {
            return 'button_click'; // Simplest
        }
    }

    /**
     * Start verification process for a member
     */
    async startVerification(guild, member, riskScore = 50) {
        const verificationType = await this.getVerificationType(guild, member, riskScore);
        
        switch (verificationType) {
            case 'button_click':
                return await this.buttonVerification(guild, member);
            case 'emoji_reaction':
                return await this.emojiReactionVerification(guild, member);
            case 'emoji_sequence':
                return await this.emojiSequenceVerification(guild, member);
            case 'web_captcha':
                return await this.webCaptchaVerification(guild, member);
            default:
                return await this.buttonVerification(guild, member);
        }
    }

    /**
     * Simple button click verification
     */
    async buttonVerification(guild, member) {
        try {
            const embed = new EmbedBuilder()
                .setTitle('🔒 Verification Required')
                .setDescription(`Welcome to ${guild.name}!\n\nPlease click the button below to verify you're human.`)
                .setColor(0x00FF00)
                .setTimestamp();

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`verify_${member.id}`)
                        .setLabel('✅ Verify Me')
                        .setStyle(ButtonStyle.Success)
                );

            const channel = await this.getVerificationChannel(guild);
            if (!channel) {
                await member.send({ embeds: [embed], components: [row] });
            } else {
                await channel.send({ content: `${member}`, embeds: [embed], components: [row] });
            }

            // Store challenge
            await this.storeChallenge(guild.id, member.id, 'button_click', null, null);

            return { success: true, type: 'button_click' };
        } catch (error) {
            console.error('Button verification error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Emoji reaction verification
     */
    async emojiReactionVerification(guild, member) {
        try {
            const emojis = ['✅', '🔒', '🛡️', '✔️', '☑️'];
            const correctEmoji = emojis[Math.floor(Math.random() * emojis.length)];

            const embed = new EmbedBuilder()
                .setTitle('🔒 Verification Required')
                .setDescription(`Welcome to ${guild.name}!\n\nPlease react with ${correctEmoji} to verify you're human.`)
                .setColor(0x00FF00)
                .setFooter({ text: 'You have 2 minutes to complete verification' })
                .setTimestamp();

            const channel = await this.getVerificationChannel(guild);
            if (!channel) return { success: false, error: 'No verification channel' };

            const message = await channel.send({ content: `${member}`, embeds: [embed] });

            // Add all emoji options
            for (const emoji of emojis) {
                await message.react(emoji);
            }

            // Store challenge
            await this.storeChallenge(guild.id, member.id, 'emoji_reaction', { correctEmoji, messageId: message.id }, null, 120);

            return { success: true, type: 'emoji_reaction', messageId: message.id };
        } catch (error) {
            console.error('Emoji reaction verification error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Emoji sequence verification (harder)
     */
    async emojiSequenceVerification(guild, member) {
        try {
            const emojiSets = {
                easy: ['🔵', '🔴', '🟢', '🟡'],
                medium: ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'],
                hard: ['🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐']
            };

            const difficulty = 'medium';
            const emojis = emojiSets[difficulty];
            const sequenceLength = 4;
            const correctSequence = [];

            for (let i = 0; i < sequenceLength; i++) {
                correctSequence.push(emojis[Math.floor(Math.random() * emojis.length)]);
            }

            const embed = new EmbedBuilder()
                .setTitle('🔒 Enhanced Verification Required')
                .setDescription(
                    `Welcome to ${guild.name}!\n\n` +
                    `**Please click the following sequence in order:**\n` +
                    `${correctSequence.join(' → ')}\n\n` +
                    `Click the buttons below in the correct order.`
                )
                .setColor(0xFFA500)
                .setFooter({ text: 'You have 3 minutes and 3 attempts' })
                .setTimestamp();

            const rows = [];
            const buttonsPerRow = 4;
            for (let i = 0; i < emojis.length; i += buttonsPerRow) {
                const row = new ActionRowBuilder();
                for (let j = i; j < Math.min(i + buttonsPerRow, emojis.length); j++) {
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`verify_seq_${member.id}_${emojis[j]}`)
                            .setLabel(emojis[j])
                            .setStyle(ButtonStyle.Primary)
                    );
                }
                rows.push(row);
            }

            const channel = await this.getVerificationChannel(guild);
            if (!channel) return { success: false, error: 'No verification channel' };

            const message = await channel.send({ content: `${member}`, embeds: [embed], components: rows });

            // Store challenge
            await this.storeChallenge(
                guild.id,
                member.id,
                'emoji_sequence',
                { correctSequence, messageId: message.id, currentIndex: 0 },
                null,
                180,
                3
            );

            return { success: true, type: 'emoji_sequence', messageId: message.id };
        } catch (error) {
            console.error('Emoji sequence verification error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Web-based captcha verification (most secure)
     */
    async webCaptchaVerification(guild, member) {
        try {
            // Generate unique verification token
            const token = crypto.randomBytes(32).toString('hex');
            const verifyUrl = `${process.env.BACKEND_URL || 'http://localhost:3001'}/verify/${token}`;

            const embed = new EmbedBuilder()
                .setTitle('🔒 Advanced Verification Required')
                .setDescription(
                    `Welcome to ${guild.name}!\n\n` +
                    `Due to your account's risk profile, we require advanced verification.\n\n` +
                    `**Please complete verification at:**\n${verifyUrl}\n\n` +
                    `This link will expire in 10 minutes.`
                )
                .setColor(0xFF0000)
                .setFooter({ text: 'Check your DMs for the verification link' })
                .setTimestamp();

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Open Verification')
                        .setStyle(ButtonStyle.Link)
                        .setURL(verifyUrl)
                );

            try {
                await member.send({ embeds: [embed], components: [row] });
            } catch (dmError) {
                const channel = await this.getVerificationChannel(guild);
                if (channel) {
                    await channel.send({ content: `${member}`, embeds: [embed], components: [row] });
                }
            }

            // Store challenge
            await this.storeChallenge(
                guild.id,
                member.id,
                'web_captcha',
                { token, verifyUrl },
                crypto.createHash('sha256').update(token).digest('hex'),
                600
            );

            return { success: true, type: 'web_captcha', token };
        } catch (error) {
            console.error('Web captcha verification error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Store challenge in database
     */
    async storeChallenge(guildId, userId, type, data, answerHash, expiresInSeconds = 300, maxAttempts = 3) {
        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

        await this.db.run(`
            INSERT INTO captcha_challenges (
                guild_id, user_id, challenge_type, challenge_data,
                answer_hash, max_attempts, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            guildId,
            userId,
            type,
            JSON.stringify(data),
            answerHash,
            maxAttempts,
            expiresAt
        ]);

        // Also store in verification_queue
        await this.db.run(`
            INSERT INTO verification_queue (
                guild_id, user_id, verification_type, verification_data,
                status, expires_at
            ) VALUES (?, ?, ?, ?, 'pending', ?)
        `, [guildId, userId, type, JSON.stringify(data), expiresAt]);
    }

    /**
     * Verify challenge completion
     */
    async verifyChallenge(guildId, userId, answer) {
        const challenge = await this.db.get(`
            SELECT * FROM captcha_challenges
            WHERE guild_id = ? AND user_id = ? AND completed = 0 AND expires_at > datetime('now')
            ORDER BY created_at DESC LIMIT 1
        `, [guildId, userId]);

        if (!challenge) {
            return { success: false, error: 'No active challenge found' };
        }

        // Increment attempts
        await this.db.run(`
            UPDATE captcha_challenges
            SET attempts = attempts + 1
            WHERE id = ?
        `, [challenge.id]);

        if (challenge.attempts >= challenge.max_attempts) {
            await this.markChallengeFailed(challenge.id);
            return { success: false, error: 'Maximum attempts exceeded' };
        }

        // Verify answer based on type
        const data = JSON.parse(challenge.challenge_data);
        let isCorrect = false;

        switch (challenge.challenge_type) {
            case 'button_click':
                isCorrect = true; // Just clicking is enough
                break;
            case 'emoji_reaction':
                isCorrect = answer === data.correctEmoji;
                break;
            case 'emoji_sequence':
                isCorrect = JSON.stringify(answer) === JSON.stringify(data.correctSequence);
                break;
            case 'web_captcha':
                const hash = crypto.createHash('sha256').update(answer).digest('hex');
                isCorrect = hash === challenge.answer_hash;
                break;
        }

        if (isCorrect) {
            await this.markChallengeCompleted(challenge.id);
            await this.grantVerifiedRole(guildId, userId);
            return { success: true };
        } else {
            return { success: false, error: 'Incorrect answer', attemptsLeft: challenge.max_attempts - challenge.attempts - 1 };
        }
    }

    /**
     * Mark challenge as completed
     */
    async markChallengeCompleted(challengeId) {
        await this.db.run(`
            UPDATE captcha_challenges
            SET completed = 1
            WHERE id = ?
        `, [challengeId]);

        const challenge = await this.db.get('SELECT * FROM captcha_challenges WHERE id = ?', [challengeId]);
        
        await this.db.run(`
            UPDATE verification_queue
            SET status = 'completed', completed_at = datetime('now')
            WHERE guild_id = ? AND user_id = ?
        `, [challenge.guild_id, challenge.user_id]);
    }

    /**
     * Mark challenge as failed
     */
    async markChallengeFailed(challengeId) {
        await this.db.run(`
            UPDATE captcha_challenges
            SET failed = 1
            WHERE id = ?
        `, [challengeId]);
    }

    /**
     * Grant verified role to member
     */
    async grantVerifiedRole(guildId, userId) {
        try {
            const guild = this.client.guilds.cache.get(guildId);
            if (!guild) return;

            const member = await guild.members.fetch(userId);
            if (!member) return;

            const config = await this.db.getGuildConfig(guildId);
            // Check multiple possible role field names
            const roleId = config?.verified_role_id || config?.verification_role;
            if (!roleId) return;

            const verifiedRole = guild.roles.cache.get(roleId);
            if (!verifiedRole) return;

            await member.roles.add(verifiedRole);
            
            // Also remove unverified role if exists
            const unverifiedRoleId = config?.unverified_role_id;
            if (unverifiedRoleId) {
                const unverifiedRole = guild.roles.cache.get(unverifiedRoleId);
                if (unverifiedRole) {
                    await member.roles.remove(unverifiedRole).catch(() => {});
                }
            }
            
            console.log(`✅ Granted verified role to ${member.user.tag} in ${guild.name}`);
        } catch (error) {
            console.error('Failed to grant verified role:', error);
        }
    }

    /**
     * Get verification channel
     */
    async getVerificationChannel(guild) {
        const config = await this.db.getGuildConfig(guild.id);
        // Check multiple possible channel fields
        const channelId = config?.verification_channel_id || config?.verification_channel || config?.welcome_channel;
        if (!channelId) return null;

        return guild.channels.cache.get(channelId);
    }

    /**
     * Clean up expired challenges
     */
    async cleanupExpiredChallenges() {
        await this.db.run(`
            UPDATE captcha_challenges
            SET failed = 1
            WHERE expires_at < datetime('now') AND completed = 0 AND failed = 0
        `);

        await this.db.run(`
            UPDATE verification_queue
            SET status = 'expired'
            WHERE expires_at < datetime('now') AND status = 'pending'
        `);
    }
}

module.exports = VerificationSystem;
