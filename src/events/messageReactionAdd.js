const { Events } = require('discord.js');

module.exports = {
    name: Events.MessageReactionAdd,
    
    async execute(reaction, user) {
        // Ignore bot reactions
        if (user.bot) return;

        // Handle partial reactions
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('Error fetching reaction:', error);
                return;
            }
        }

        try {
            const client = reaction.client;
            const message = reaction.message;
            const guild = message.guild;
            
            if (!guild) return;

            // ========== VERIFICATION REACTION HANDLER ==========
            // Check if this is a verification reaction challenge
            const verificationChallenge = await client.database.get(
                `SELECT * FROM captcha_challenges 
                 WHERE guild_id = ? AND user_id = ? AND challenge_type = 'emoji_reaction' 
                 AND completed = 0 AND failed = 0 
                 ORDER BY created_at DESC LIMIT 1`,
                [guild.id, user.id]
            );

            if (verificationChallenge) {
                try {
                    const data = JSON.parse(verificationChallenge.challenge_data || '{}');
                    
                    // Check if this is the correct message
                    if (data.messageId === message.id) {
                        const emoji = reaction.emoji.toString();
                        
                        // Check expiry
                        if (verificationChallenge.expires_at && new Date(verificationChallenge.expires_at).getTime() < Date.now()) {
                            await client.database.run(`UPDATE captcha_challenges SET failed = 1 WHERE id = ?`, [verificationChallenge.id]);
                            await client.database.run(
                                `UPDATE verification_queue SET status = 'expired', completed_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND user_id = ? AND status = 'pending'`,
                                [guild.id, user.id]
                            );
                            try {
                                await user.send('❌ Your verification challenge has expired. Please contact staff for a new one.');
                            } catch {}
                            return;
                        }

                        if (emoji === data.correctEmoji) {
                            // Correct emoji! Verify the user
                            await client.database.run(`UPDATE captcha_challenges SET completed = 1 WHERE id = ?`, [verificationChallenge.id]);
                            await client.database.run(
                                `UPDATE verification_queue SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND user_id = ? AND status = 'pending'`,
                                [guild.id, user.id]
                            );

                            const member = await guild.members.fetch(user.id).catch(() => null);
                            if (member) {
                                // Use userVerification if available
                                if (client.userVerification?.markVerified) {
                                    await client.userVerification.markVerified(member, 'emoji_reaction');
                                } else {
                                    // Fallback: directly add role
                                    const config = await client.database.getGuildConfig(guild.id);
                                    if (config?.verified_role_id) {
                                        await member.roles.add(config.verified_role_id).catch(() => {});
                                    }
                                    if (config?.unverified_role_id) {
                                        await member.roles.remove(config.unverified_role_id).catch(() => {});
                                    }
                                }
                            }

                            // Try to delete the verification message
                            try {
                                await message.delete();
                            } catch {}

                            // DM success
                            try {
                                await user.send(`✅ **Verification Complete!**\n\nYou now have access to **${guild.name}**. Welcome!`);
                            } catch {}

                            console.log(`[Verification] User ${user.tag} verified via emoji reaction in ${guild.name}`);
                        } else {
                            // Wrong emoji - increment attempts
                            const newAttempts = (verificationChallenge.attempts || 0) + 1;
                            
                            if (newAttempts >= verificationChallenge.max_attempts) {
                                await client.database.run(`UPDATE captcha_challenges SET failed = 1, attempts = ? WHERE id = ?`, [newAttempts, verificationChallenge.id]);
                                await client.database.run(
                                    `UPDATE verification_queue SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND user_id = ? AND status = 'pending'`,
                                    [guild.id, user.id]
                                );
                                try {
                                    await user.send('❌ Too many wrong attempts. Please contact staff for help.');
                                } catch {}
                            } else {
                                await client.database.run(`UPDATE captcha_challenges SET attempts = ? WHERE id = ?`, [newAttempts, verificationChallenge.id]);
                                const remaining = verificationChallenge.max_attempts - newAttempts;
                                try {
                                    await user.send(`❌ Wrong emoji! ${remaining} attempts remaining. React with the correct one: ${data.correctEmoji}`);
                                } catch {}
                            }

                            // Remove their wrong reaction
                            try {
                                await reaction.users.remove(user.id);
                            } catch {}
                        }
                        return; // Don't process as reaction role
                    }
                } catch (err) {
                    console.error('[Verification] Error handling reaction verification:', err);
                }
            }

            // ========== REACTION ROLE HANDLER ==========
            // Check if this is a reaction role message
            const panel = await client.database.get(
                'SELECT * FROM reaction_role_panels WHERE message_id = ? AND guild_id = ? AND type = ?',
                [message.id, guild.id, 'reaction']
            );

            if (!panel) return;

            // Get the role mapping for this emoji
            const emoji = reaction.emoji.toString();
            const roleMapping = await client.database.get(
                'SELECT * FROM reaction_role_mappings WHERE panel_id = ? AND emoji = ?',
                [panel.panel_id, emoji]
            );

            if (!roleMapping) return;

            const member = await guild.members.fetch(user.id);
            const role = guild.roles.cache.get(roleMapping.role_id);

            if (!role) {
                console.log(`Role ${roleMapping.role_id} not found in guild`);
                return;
            }

            // Check if single mode - remove other roles from this panel
            if (panel.mode === 'single') {
                const allRoles = await client.database.all(
                    'SELECT role_id FROM reaction_role_mappings WHERE panel_id = ?',
                    [panel.panel_id]
                );

                for (const r of allRoles) {
                    if (r.role_id !== role.id && member.roles.cache.has(r.role_id)) {
                        const otherRole = guild.roles.cache.get(r.role_id);
                        if (otherRole) {
                            await member.roles.remove(otherRole).catch(console.error);
                        }
                    }
                }
            }

            // Add the role
            if (!member.roles.cache.has(role.id)) {
                await member.roles.add(role);
                console.log(`Added role ${role.name} to ${user.tag} via reaction roles`);
                
                // Try to DM the user
                try {
                    await user.send(`✅ You've been given the **${role.name}** role in **${guild.name}**!`);
                } catch (err) {
                    // User has DMs disabled
                }
            }
        } catch (error) {
            console.error('Error handling reaction role add:', error);
        }
    }
};
