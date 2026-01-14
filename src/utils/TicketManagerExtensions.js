// Continuation of EnhancedTicketManager.js - Additional Methods

    // Handle ticket interactions (claim, close, add user, etc.)
    async handleTicketInteraction(interaction) {
        if (!interaction.isButton()) return;

        const customId = interaction.customId;
        const guild = interaction.guild;
        const user = interaction.user;
        
        try {
            if (customId.startsWith('close_ticket_')) {
                const ticketId = customId.replace('close_ticket_', '');
                await this.closeTicket(interaction, ticketId);
            } else if (customId.startsWith('claim_ticket_')) {
                const ticketId = customId.replace('claim_ticket_', '');
                await this.claimTicket(interaction, ticketId);
            } else if (customId.startsWith('add_user_')) {
                const ticketId = customId.replace('add_user_', '');
                await this.promptAddUser(interaction, ticketId);
            } else if (customId.startsWith('confirm_close_')) {
                const ticketId = customId.replace('confirm_close_', '');
                await this.confirmCloseTicket(interaction, ticketId);
            } else if (customId.startsWith('cancel_close_')) {
                await this.cancelCloseTicket(interaction);
            } else if (customId.startsWith('rate_ticket_')) {
                const [, rating, ticketId] = customId.split('_');
                await this.rateTicket(interaction, ticketId, parseInt(rating));
            }
        } catch (error) {
            this.bot.logger.error('Error handling ticket interaction:', error);
            await interaction.reply({
                content: '❌ An error occurred while processing your request.',
                ephemeral: true
            });
        }
    }

    // Close a ticket
    async closeTicket(interaction, ticketId) {
        const ticket = this.activeTickets.get(interaction.channel.id);
        if (!ticket) {
            await interaction.reply({
                content: '❌ This is not a valid ticket channel.',
                ephemeral: true
            });
            return;
        }

        // Check permissions
        const config = await this.getConfig(interaction.guild.id);
        const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
                            (config.staff_role_id && interaction.member.roles.cache.has(config.staff_role_id)) ||
                            ticket.user_id === interaction.user.id;

        if (!hasPermission) {
            await interaction.reply({
                content: '❌ You do not have permission to close this ticket.',
                ephemeral: true
            });
            return;
        }

        // Show confirmation dialog
        const embed = new EmbedBuilder()
            .setTitle('🔒 Confirm Ticket Closure')
            .setDescription('Are you sure you want to close this ticket?\nThis action will create a transcript and delete the channel.')
            .setColor(0xff0000);

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_close_${ticketId}`)
                    .setLabel('Yes, Close Ticket')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`cancel_close_${ticketId}`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.reply({
            embeds: [embed],
            components: [buttons],
            ephemeral: true
        });
    }

    // Confirm ticket closure
    async confirmCloseTicket(interaction, ticketId) {
        const ticket = this.activeTickets.get(interaction.channel.id);
        if (!ticket) {
            await interaction.reply({
                content: '❌ Ticket not found.',
                ephemeral: true
            });
            return;
        }

        await interaction.reply({
            content: '🔄 Creating transcript and closing ticket...',
            ephemeral: true
        });

        try {
            // Generate transcript
            const transcript = await this.generateTranscript(interaction.channel, ticket);
            
            // Save transcript to database
            await this.bot.database.run(`
                INSERT INTO ticket_transcripts (
                    guild_id, original_channel_id, user_id, category, priority,
                    closed_by, closed_at, message_count, transcript_html, rating
                ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, NULL)
            `, [
                ticket.guild_id, ticket.channel_id, ticket.user_id, ticket.category,
                ticket.priority, interaction.user.id, transcript.messageCount, transcript.html
            ]);

            // Remove from active tickets
            await this.bot.database.run('DELETE FROM active_tickets WHERE id = ?', [ticket.id]);
            this.activeTickets.delete(interaction.channel.id);

            // Send transcript to configured channel
            const config = await this.getConfig(interaction.guild.id);
            if (config.transcript_channel_id) {
                await this.sendTranscriptMessage(interaction.guild, transcript, ticket, interaction.user);
            }

            // Send closing message with rating option
            const user = await interaction.guild.members.fetch(ticket.user_id).catch(() => null);
            if (user) {
                await this.sendRatingMessage(user, ticket, transcript.transcriptId);
            }

            // Log closure
            if (config.log_channel_id) {
                await this.logTicketAction(interaction.guild, 'closed', {
                    user: interaction.user,
                    channel: interaction.channel,
                    ticket,
                    transcript: transcript.transcriptId
                });
            }

            // Delete channel after delay
            setTimeout(async () => {
                try {
                    await interaction.channel.delete();
                } catch (error) {
                    this.bot.logger.error('Error deleting ticket channel:', error);
                }
            }, 5000);

        } catch (error) {
            this.bot.logger.error('Error closing ticket:', error);
            await interaction.followUp({
                content: '❌ Error occurred while closing ticket.',
                ephemeral: true
            });
        }
    }

    // Cancel ticket closure
    async cancelCloseTicket(interaction) {
        await interaction.update({
            content: '✅ Ticket closure cancelled.',
            embeds: [],
            components: []
        });
    }

    // Claim a ticket
    async claimTicket(interaction, ticketId) {
        const ticket = this.activeTickets.get(interaction.channel.id);
        if (!ticket) {
            await interaction.reply({
                content: '❌ This is not a valid ticket channel.',
                ephemeral: true
            });
            return;
        }

        // Check if user has staff permissions
        const config = await this.getConfig(interaction.guild.id);
        const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
                            (config.staff_role_id && interaction.member.roles.cache.has(config.staff_role_id));

        if (!hasPermission) {
            await interaction.reply({
                content: '❌ You do not have permission to claim tickets.',
                ephemeral: true
            });
            return;
        }

        try {
            // Update ticket in database
            await this.bot.database.run(`
                UPDATE active_tickets SET claimed_by = ?, claimed_at = CURRENT_TIMESTAMP WHERE id = ?
            `, [interaction.user.id, ticket.id]);

            // Update local cache
            ticket.claimed_by = interaction.user.id;
            ticket.claimed_at = new Date().toISOString();

            const embed = new EmbedBuilder()
                .setTitle('✋ Ticket Claimed')
                .setDescription(`This ticket has been claimed by ${interaction.user}`)
                .setColor(0x00ff00)
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

            // Log claim
            if (config.log_channel_id) {
                await this.logTicketAction(interaction.guild, 'claimed', {
                    user: interaction.user,
                    channel: interaction.channel,
                    ticket
                });
            }
        } catch (error) {
            this.bot.logger.error('Error claiming ticket:', error);
            await interaction.reply({
                content: '❌ Error occurred while claiming ticket.',
                ephemeral: true
            });
        }
    }

    // Generate HTML transcript
    async generateTranscript(channel, ticket) {
        try {
            const messages = await channel.messages.fetch({ limit: 100 });
            const sortedMessages = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

            let html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Ticket Transcript #${ticket.id}</title>
    <style>
        body { font-family: 'Segoe UI', sans-serif; background: #36393f; color: #dcddde; margin: 0; padding: 20px; }
        .header { background: #2f3136; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .message { background: #40444b; margin: 5px 0; padding: 10px; border-radius: 5px; border-left: 3px solid #7289da; }
        .author { color: #7289da; font-weight: bold; }
        .timestamp { color: #72767d; font-size: 12px; }
        .content { margin: 5px 0; }
        .attachment { background: #2f3136; padding: 10px; border-radius: 5px; margin: 5px 0; }
        .embed { background: #2f3136; border-left: 4px solid #7289da; padding: 10px; margin: 5px 0; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Ticket Transcript #${ticket.id}</h1>
        <p><strong>Category:</strong> ${ticket.category}</p>
        <p><strong>Created by:</strong> ${await this.getUsername(ticket.user_id)}</p>
        <p><strong>Channel:</strong> #${channel.name}</p>
        <p><strong>Created:</strong> ${new Date(ticket.created_at).toLocaleString()}</p>
        <p><strong>Closed:</strong> ${new Date().toLocaleString()}</p>
    </div>
    <div class="messages">
`;

            for (const message of sortedMessages.values()) {
                const author = message.author;
                const timestamp = message.createdAt.toLocaleString();
                const content = message.content || '';

                html += `
        <div class="message">
            <div class="author">${author.displayName || author.username}</div>
            <div class="timestamp">${timestamp}</div>
            <div class="content">${this.escapeHtml(content)}</div>
`;

                // Add attachments
                if (message.attachments.size > 0) {
                    for (const attachment of message.attachments.values()) {
                        html += `
            <div class="attachment">
                📎 <a href="${attachment.url}" target="_blank">${attachment.name}</a>
            </div>
`;
                    }
                }

                // Add embeds
                if (message.embeds.length > 0) {
                    for (const embed of message.embeds) {
                        html += `
            <div class="embed">
                ${embed.title ? `<h3>${this.escapeHtml(embed.title)}</h3>` : ''}
                ${embed.description ? `<p>${this.escapeHtml(embed.description)}</p>` : ''}
            </div>
`;
                    }
                }

                html += `        </div>\n`;
            }

            html += `
    </div>
</body>
</html>
`;

            return {
                html,
                messageCount: sortedMessages.size,
                transcriptId: `${ticket.guild_id}-${ticket.id}-${Date.now()}`
            };
        } catch (error) {
            this.bot.logger.error('Error generating transcript:', error);
            throw error;
        }
    }

    // Send transcript message
    async sendTranscriptMessage(guild, transcript, ticket, closedBy) {
        const config = await this.getConfig(guild.id);
        if (!config.transcript_channel_id) return;

        const channel = guild.channels.cache.get(config.transcript_channel_id);
        if (!channel) return;

        try {
            const embed = new EmbedBuilder()
                .setTitle(`📋 Ticket Transcript #${ticket.id}`)
                .addFields([
                    { name: 'Category', value: ticket.category, inline: true },
                    { name: 'User', value: `<@${ticket.user_id}>`, inline: true },
                    { name: 'Closed by', value: closedBy.toString(), inline: true },
                    { name: 'Messages', value: transcript.messageCount.toString(), inline: true },
                    { name: 'Priority', value: ticket.priority, inline: true },
                    { name: 'Duration', value: this.calculateDuration(ticket.created_at), inline: true }
                ])
                .setColor(this.getPriorityColor(ticket.priority))
                .setTimestamp();

            // Create transcript file
            const Buffer = require('buffer').Buffer;
            const attachment = {
                attachment: Buffer.from(transcript.html, 'utf8'),
                name: `ticket-${ticket.id}-transcript.html`
            };

            await channel.send({
                embeds: [embed],
                files: [attachment]
            });
        } catch (error) {
            this.bot.logger.error('Error sending transcript message:', error);
        }
    }

    // Send rating message to user
    async sendRatingMessage(user, ticket, transcriptId) {
        try {
            const embed = new EmbedBuilder()
                .setTitle('📝 Rate Your Support Experience')
                .setDescription(`How was your support experience with ticket #${ticket.id}?`)
                .addFields([
                    { name: 'Category', value: ticket.category, inline: true },
                    { name: 'Server', value: `${user.guild.name}`, inline: true }
                ])
                .setColor(0x00ff00);

            const buttons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`rate_ticket_5_${transcriptId}`)
                        .setLabel('Excellent')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('⭐'),
                    new ButtonBuilder()
                        .setCustomId(`rate_ticket_4_${transcriptId}`)
                        .setLabel('Good')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('👍'),
                    new ButtonBuilder()
                        .setCustomId(`rate_ticket_3_${transcriptId}`)
                        .setLabel('Average')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('👌'),
                    new ButtonBuilder()
                        .setCustomId(`rate_ticket_2_${transcriptId}`)
                        .setLabel('Poor')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('👎')
                );

            await user.send({ embeds: [embed], components: [buttons] });
        } catch (error) {
            this.bot.logger.error('Error sending rating message:', error);
        }
    }

    // Handle ticket rating
    async rateTicket(interaction, transcriptId, rating) {
        try {
            await this.bot.database.run(`
                UPDATE ticket_transcripts SET rating = ? WHERE 
                guild_id || '-' || original_channel_id || '-' || strftime('%s', closed_at) || '000' = ?
            `, [rating, transcriptId]);

            const ratingText = ['', '', 'Poor', 'Average', 'Good', 'Excellent'][rating];
            
            await interaction.reply({
                content: `✅ Thank you for rating your support experience: ${ratingText} (${rating}/5)`,
                embeds: [],
                components: []
            });
        } catch (error) {
            this.bot.logger.error('Error saving ticket rating:', error);
            await interaction.reply('❌ Error saving rating.');
        }
    }

    // Log ticket actions
    async logTicketAction(guild, action, data) {
        const config = await this.getConfig(guild.id);
        if (!config.log_channel_id) return;

        const channel = guild.channels.cache.get(config.log_channel_id);
        if (!channel) return;

        try {
            const embed = new EmbedBuilder()
                .setTitle(`🎫 Ticket ${action.charAt(0).toUpperCase() + action.slice(1)}`)
                .addFields([
                    { name: 'User', value: data.user.toString(), inline: true },
                    { name: 'Channel', value: data.channel.toString(), inline: true }
                ])
                .setColor(action === 'created' ? 0x00ff00 : action === 'closed' ? 0xff0000 : 0xffaa00)
                .setTimestamp();

            if (data.category) embed.addFields({ name: 'Category', value: data.category, inline: true });
            if (data.priority) embed.addFields({ name: 'Priority', value: data.priority, inline: true });
            if (data.transcript) embed.addFields({ name: 'Transcript ID', value: data.transcript, inline: true });

            await channel.send({ embeds: [embed] });
        } catch (error) {
            this.bot.logger.error('Error logging ticket action:', error);
        }
    }

    // Utility functions
    async getUsername(userId) {
        try {
            const user = await this.bot.users.fetch(userId);
            return user.username;
        } catch {
            return 'Unknown User';
        }
    }

    escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    calculateDuration(startTime) {
        const start = new Date(startTime);
        const end = new Date();
        const diffMs = end - start;
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        
        if (diffHours > 24) {
            const days = Math.floor(diffHours / 24);
            const hours = diffHours % 24;
            return `${days}d ${hours}h`;
        } else if (diffHours > 0) {
            return `${diffHours}h ${diffMinutes}m`;
        } else {
            return `${diffMinutes}m`;
        }
    }
}