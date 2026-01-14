const { EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const verificationButtons = require('./guildMemberAdd-verification');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, bot) {
        // Handle dynamic verification button (verify_<memberId>) from VerificationSystem
        if (interaction.isButton() && interaction.customId.match(/^verify_[0-9]+$/)) {
            try {
                const memberId = interaction.customId.replace('verify_', '');
                
                // Only the target user can click their verification button
                if (interaction.user.id !== memberId) {
                    return interaction.reply({ 
                        content: '❌ This verification button is not for you.', 
                        ephemeral: true 
                    });
                }

                const guildId = interaction.guild?.id || interaction.guildId;
                const guild = bot.client.guilds.cache.get(guildId);
                if (!guild) {
                    return interaction.reply({ content: '❌ Guild not found.', ephemeral: true });
                }

                const member = await guild.members.fetch(memberId).catch(() => null);
                if (!member) {
                    return interaction.reply({ content: '❌ You are no longer in this server.', ephemeral: true });
                }

                // Check for pending verification challenge
                const pending = await bot.database.get(
                    `SELECT * FROM verification_queue WHERE guild_id = ? AND user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
                    [guildId, memberId]
                );

                if (pending) {
                    const isExpired = pending.expires_at && new Date(pending.expires_at).getTime() < Date.now();
                    if (isExpired) {
                        await bot.database.run(`UPDATE verification_queue SET status = 'expired', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pending.id]);
                        return interaction.reply({ content: '❌ Verification challenge expired. Please ask staff to resend.', ephemeral: true });
                    }
                    // Mark completed
                    await bot.database.run(`UPDATE verification_queue SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pending.id]);
                }

                // Also check captcha_challenges table
                await bot.database.run(
                    `UPDATE captcha_challenges SET completed = 1 WHERE guild_id = ? AND user_id = ? AND challenge_type = 'button_click' AND completed = 0`,
                    [guildId, memberId]
                ).catch(() => {});

                // Mark verified
                if (bot.userVerification?.markVerified) {
                    await bot.userVerification.markVerified(member, 'button');
                } else {
                    // Fallback: directly add role
                    const config = await bot.database.getGuildConfig(guildId);
                    if (config?.verified_role_id) {
                        await member.roles.add(config.verified_role_id).catch(() => {});
                    }
                    if (config?.unverified_role_id) {
                        await member.roles.remove(config.unverified_role_id).catch(() => {});
                    }
                }

                return interaction.reply({ 
                    content: '✅ **Verification Complete!**\n\nYou now have access to the rest of the server. Welcome!', 
                    ephemeral: true 
                });
            } catch (err) {
                bot.logger?.error?.('[InteractionHandler] Dynamic verify button error:', err);
                if (!interaction.replied && !interaction.deferred) {
                    return interaction.reply({ content: '❌ An error occurred during verification.', ephemeral: true });
                }
            }
            return;
        }

        // Handle emoji sequence verification buttons (verify_seq_<memberId>_<emoji>)
        if (interaction.isButton() && interaction.customId.startsWith('verify_seq_')) {
            try {
                const parts = interaction.customId.split('_'); // verify_seq_<memberId>_<emoji>
                const memberId = parts[2];
                const clickedEmoji = parts.slice(3).join('_'); // Emoji might have underscores

                // Only the target user can click
                if (interaction.user.id !== memberId) {
                    return interaction.reply({ 
                        content: '❌ This verification is not for you.', 
                        ephemeral: true 
                    });
                }

                const guildId = interaction.guild?.id;
                
                // Get the challenge data
                const challenge = await bot.database.get(
                    `SELECT * FROM captcha_challenges WHERE guild_id = ? AND user_id = ? AND challenge_type = 'emoji_sequence' AND completed = 0 AND failed = 0 ORDER BY created_at DESC LIMIT 1`,
                    [guildId, memberId]
                );

                if (!challenge) {
                    return interaction.reply({ content: '❌ No active sequence verification found.', ephemeral: true });
                }

                // Check expiry
                if (challenge.expires_at && new Date(challenge.expires_at).getTime() < Date.now()) {
                    await bot.database.run(`UPDATE captcha_challenges SET failed = 1 WHERE id = ?`, [challenge.id]);
                    return interaction.reply({ content: '❌ Verification expired. Please ask staff for a new challenge.', ephemeral: true });
                }

                const data = JSON.parse(challenge.challenge_data || '{}');
                const correctSequence = data.correctSequence || [];
                const currentIndex = data.currentIndex || 0;

                // Check if clicked emoji matches the expected position
                if (correctSequence[currentIndex] === clickedEmoji) {
                    const newIndex = currentIndex + 1;
                    
                    if (newIndex >= correctSequence.length) {
                        // Sequence complete!
                        await bot.database.run(`UPDATE captcha_challenges SET completed = 1 WHERE id = ?`, [challenge.id]);
                        await bot.database.run(
                            `UPDATE verification_queue SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND user_id = ? AND status = 'pending'`,
                            [guildId, memberId]
                        );

                        const member = await interaction.guild.members.fetch(memberId).catch(() => null);
                        if (member && bot.userVerification?.markVerified) {
                            await bot.userVerification.markVerified(member, 'emoji_sequence');
                        }

                        return interaction.reply({ 
                            content: '✅ **Verification Complete!**\n\nYou successfully completed the sequence. Welcome!', 
                            ephemeral: true 
                        });
                    } else {
                        // Update progress
                        data.currentIndex = newIndex;
                        await bot.database.run(
                            `UPDATE captcha_challenges SET challenge_data = ? WHERE id = ?`,
                            [JSON.stringify(data), challenge.id]
                        );
                        return interaction.reply({ 
                            content: `✅ Correct! ${newIndex}/${correctSequence.length} - Keep going!`, 
                            ephemeral: true 
                        });
                    }
                } else {
                    // Wrong emoji - increment attempts
                    const newAttempts = (challenge.attempts || 0) + 1;
                    if (newAttempts >= challenge.max_attempts) {
                        await bot.database.run(`UPDATE captcha_challenges SET failed = 1, attempts = ? WHERE id = ?`, [newAttempts, challenge.id]);
                        await bot.database.run(
                            `UPDATE verification_queue SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND user_id = ? AND status = 'pending'`,
                            [guildId, memberId]
                        );
                        return interaction.reply({ content: '❌ Too many wrong attempts. Please contact staff.', ephemeral: true });
                    }

                    // Reset sequence progress
                    data.currentIndex = 0;
                    await bot.database.run(
                        `UPDATE captcha_challenges SET challenge_data = ?, attempts = ? WHERE id = ?`,
                        [JSON.stringify(data), newAttempts, challenge.id]
                    );
                    return interaction.reply({ 
                        content: `❌ Wrong! Start over. ${challenge.max_attempts - newAttempts} attempts remaining.`, 
                        ephemeral: true 
                    });
                }
            } catch (err) {
                bot.logger?.error?.('[InteractionHandler] Emoji sequence error:', err);
                if (!interaction.replied && !interaction.deferred) {
                    return interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
                }
            }
            return;
        }

        // Handle button interactions for self-roles
        if (interaction.isButton() && interaction.customId.startsWith('selfrole_')) {
            const roleId = interaction.customId.replace('selfrole_', '');
            const role = interaction.guild.roles.cache.get(roleId);

            if (!role) {
                return interaction.reply({
                    content: '❌ This role no longer exists!',
                    ephemeral: true
                });
            }

            const member = interaction.member;
            const hasRole = member.roles.cache.has(roleId);

            try {
                if (hasRole) {
                    await member.roles.remove(role);
                    await interaction.reply({
                        content: `✅ Removed the **${role.name}** role!`,
                        ephemeral: true
                    });
                } else {
                    await member.roles.add(role);
                    await interaction.reply({
                        content: `✅ You now have the **${role.name}** role!`,
                        ephemeral: true
                    });
                }
            } catch (error) {
                bot.logger.error('Error toggling self-role:', error);
                await interaction.reply({
                    content: '❌ Failed to toggle role. Please contact an administrator.',
                    ephemeral: true
                });
            }
        }

        // Handle verification staff buttons (approve/deny)
        if (interaction.isButton() && (interaction.customId.startsWith('verify_allow_') || interaction.customId.startsWith('verify_deny_'))) {
            // delegate to guildMemberAdd-verification handler which contains permission checks
            try {
                await verificationButtons.handleVerificationButtons(interaction, bot);
            } catch (err) {
                bot.logger?.error && bot.logger.error('Error handling verification staff button:', err);
            }
            return;
        }

        // Handle main verification button in verification channel
        if (interaction.isButton() && interaction.customId === 'verify_button') {
            try {
                const guildId = interaction.guild.id;
                const member = interaction.member;

                // Get guild config
                const config = await bot.database.get(
                    `SELECT verified_role_id, unverified_role_id, verification_method FROM guild_configs WHERE guild_id = ?`,
                    [guildId]
                );

                if (!config || !config.verified_role_id) {
                    return interaction.reply({ content: '❌ Verification system is not properly configured.', ephemeral: true });
                }

                // Check if already verified
                if (member.roles.cache.has(config.verified_role_id)) {
                    return interaction.reply({ content: '✅ You are already verified!', ephemeral: true });
                }

                const method = (config.verification_method || 'button').toLowerCase();
                bot.logger?.info(`[Verification] Guild ${guildId} using method: ${method} (raw: ${config.verification_method})`);

                // For 'button' or 'auto' method, verify directly
                if (method === 'button' || method === 'auto') {
                    // Add verified role
                    await member.roles.add(config.verified_role_id).catch(() => {});
                    
                    // Remove unverified role if exists
                    if (config.unverified_role_id) {
                        await member.roles.remove(config.unverified_role_id).catch(() => {});
                    }

                    // Log verification if userVerification system exists
                    if (bot.userVerification && typeof bot.userVerification.markVerified === 'function') {
                        await bot.userVerification.markVerified(member, 'button').catch(() => {});
                    }

                    return interaction.reply({ 
                        content: '✅ **Verification Complete!**\n\nYou now have access to the rest of the server. Welcome!', 
                        ephemeral: true 
                    });
                } else if (method === 'captcha' || method === 'code') {
                    // For captcha method, check if there's a pending challenge
                    const pending = await bot.database.get(
                        `SELECT * FROM verification_queue WHERE guild_id = ? AND user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
                        [guildId, member.id]
                    );

                    if (!pending) {
                        // Generate and send a new captcha code
                        const crypto = require('crypto');
                        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                        let captchaCode = '';
                        for (let i = 0; i < 6; i++) {
                            captchaCode += chars.charAt(Math.floor(Math.random() * chars.length));
                        }
                        const codeHash = crypto.createHash('sha256').update(captchaCode.toLowerCase()).digest('hex');
                        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

                        // Store in database
                        await bot.database.run(
                            `INSERT INTO verification_queue (guild_id, user_id, verification_type, verification_data, status, expires_at, attempts) 
                             VALUES (?, ?, 'captcha', ?, 'pending', ?, 0)`,
                            [guildId, member.id, JSON.stringify({ displayCode: captchaCode, codeHash }), expiresAt]
                        );

                        // DM the code to the user
                        try {
                            await member.send({
                                embeds: [{
                                    title: '🔐 Verification Code',
                                    description: `Your verification code for **${interaction.guild.name}** is:\n\n**\`${captchaCode}\`**\n\nReturn to the server and click the Verify button, then enter this code.\n\n*This code expires in 10 minutes.*`,
                                    color: 0x00d4ff,
                                    timestamp: new Date().toISOString()
                                }]
                            });
                        } catch (dmErr) {
                            // If DM fails, show the code in the ephemeral reply
                            return interaction.reply({ 
                                content: `📬 **Your Verification Code**\n\nYour code is: **\`${captchaCode}\`**\n\n*We couldn't DM you, so here's your code. Click verify again to enter it.*`,
                                ephemeral: true 
                            });
                        }

                        return interaction.reply({ 
                            content: '📬 **Check your DMs!**\n\nA verification code has been sent to you. Click the verify button again to enter the code.',
                            ephemeral: true 
                        });
                    }

                    // Check if pending challenge is expired
                    if (pending.expires_at && new Date(pending.expires_at).getTime() < Date.now()) {
                        // Delete expired and create new
                        await bot.database.run(`DELETE FROM verification_queue WHERE id = ?`, [pending.id]);
                        return interaction.reply({ 
                            content: '⏰ Your previous code expired. Click verify again to get a new code.',
                            ephemeral: true 
                        });
                    }

                    // Show modal to enter the code
                    const modal = new ModalBuilder()
                        .setCustomId(`verify_modal_${guildId}_${member.id}`)
                        .setTitle('🔐 CAPTCHA Verification');

                    const codeInput = new TextInputBuilder()
                        .setCustomId('verification_code')
                        .setLabel('Enter the verification code from your DM')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Enter code...')
                        .setRequired(true)
                        .setMinLength(4)
                        .setMaxLength(10);

                    const row = new ActionRowBuilder().addComponents(codeInput);
                    modal.addComponents(row);

                    return interaction.showModal(modal);
                } else if (method === 'reaction') {
                    // For reaction method, use the VerificationSystem's emoji reaction
                    if (bot.verificationSystem) {
                        const result = await bot.verificationSystem.emojiReactionVerification(interaction.guild, member);
                        if (result.success) {
                            return interaction.reply({ 
                                content: '📨 **Reaction Verification Started!**\n\nReact to the verification message with the correct emoji to complete verification.',
                                ephemeral: true 
                            });
                        }
                    }
                    // Fallback: verify directly
                    await member.roles.add(config.verified_role_id).catch(() => {});
                    if (config.unverified_role_id) {
                        await member.roles.remove(config.unverified_role_id).catch(() => {});
                    }
                    return interaction.reply({ 
                        content: '✅ **Verification Complete!**\n\nYou now have access to the rest of the server. Welcome!', 
                        ephemeral: true 
                    });
                } else if (method === 'web') {
                    // For web verification, redirect to web portal
                    const dashboardUrl = process.env.DASHBOARD_URL || 'https://discord-security-bot-uyx6.onrender.com';
                    const verifyUrl = `${dashboardUrl}/verify/${guildId}/${member.id}`;
                    
                    // Create a clickable button for easy access
                    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                    const row = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setLabel('Open Verification Portal')
                                .setStyle(ButtonStyle.Link)
                                .setURL(verifyUrl)
                                .setEmoji('🔗')
                        );
                    
                    return interaction.reply({ 
                        content: `🌐 **Web Verification Required**\n\nClick the button below to complete your verification:`,
                        components: [row],
                        ephemeral: true 
                    });
                } else {
                    // Default fallback - direct verification
                    await member.roles.add(config.verified_role_id).catch(() => {});
                    if (config.unverified_role_id) {
                        await member.roles.remove(config.unverified_role_id).catch(() => {});
                    }
                    return interaction.reply({ 
                        content: '✅ **Verification Complete!**\n\nYou now have access to the rest of the server. Welcome!', 
                        ephemeral: true 
                    });
                }
            } catch (err) {
                bot.logger?.error && bot.logger.error('[InteractionHandler] verify_button error:', err);
                if (!interaction.replied && !interaction.deferred) {
                    return interaction.reply({ content: '❌ An error occurred during verification. Please contact staff.', ephemeral: true });
                }
            }
            return;
        }

        // Handle user verification button (direct verify; code flow deprecated)
        if (interaction.isButton() && interaction.customId.startsWith('verify_user_')) {
            try {
                const parts = interaction.customId.split('_'); // verify_user_<guildId>_<userId>
                if (parts.length < 4) {
                    return interaction.reply({ content: 'Invalid button format.', ephemeral: true });
                }
                const guildId = parts[2];
                const targetUserId = parts[3];
                if (interaction.user.id !== targetUserId) {
                    return interaction.reply({ content: 'This verification button is not for you.', ephemeral: true });
                }
                // Fetch pending verification
                const pending = await bot.database.get(
                    `SELECT * FROM verification_queue WHERE guild_id = ? AND user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
                    [guildId, targetUserId]
                );
                if (!pending) {
                    return interaction.reply({ content: 'No active verification challenge found.', ephemeral: true });
                }
                const isExpired = pending.expires_at && new Date(pending.expires_at).getTime() < Date.now();
                if (isExpired) {
                    await bot.database.run(`UPDATE verification_queue SET status = 'expired', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pending.id]);
                    return interaction.reply({ content: 'Verification challenge expired. Ask staff to resend.', ephemeral: true });
                }
                const guild = bot.client.guilds.cache.get(guildId);
                if (!guild) return interaction.reply({ content: 'Guild not found for verification.', ephemeral: true });
                const member = await guild.members.fetch(targetUserId).catch(() => null);
                if (!member) return interaction.reply({ content: 'You are no longer in the server.', ephemeral: true });
                await bot.userVerification.markVerified(member, 'button');
                await bot.database.run(`UPDATE verification_queue SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pending.id]);
                return interaction.reply({ content: '✅ You are now verified. Welcome!', ephemeral: true });
            } catch (err) {
                bot.logger?.error && bot.logger.error('[InteractionHandler] verify_user button error:', err);
                if (!interaction.replied && !interaction.deferred) {
                    return interaction.reply({ content: 'An error occurred during verification.', ephemeral: true });
                }
            }
        }

        // Handle modal submissions (verification code)
        if (interaction.isModalSubmit() && interaction.customId && interaction.customId.startsWith('verify_modal_')) {
            try {
                if (bot && bot.userVerification && typeof bot.userVerification.handleModalSubmit === 'function') {
                    await bot.userVerification.handleModalSubmit(interaction);
                } else {
                    await interaction.reply({ content: 'Verification handler is unavailable.', ephemeral: true });
                }
            } catch (err) {
                bot.logger?.error && bot.logger.error('Error processing verification modal submit:', err);
                try { await interaction.reply({ content: 'An error occurred handling your verification.', ephemeral: true }); } catch {};
            }
            return;
        }
    }
};
