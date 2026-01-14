/**
 * Help System Handlers
 * Extracted from bot.js - handles help modals and ticket creation
 */

const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle
} = require('discord.js');

/**
 * Handle help modal interaction
 * @param {ModalSubmitInteraction} interaction 
 * @param {SecurityBot} bot 
 */
async function handleHelpModal(interaction, bot) {
    try {
        // Get the topic the user selected
        const topic = interaction.fields.getTextInputValue('help-description') || 'General';

        const helpCategories = {
            'Moderation': {
                emoji: '🔨',
                color: '#ff6b6b',
                commands: ['kick', 'ban', 'timeout', 'warn', 'purge', 'unban'],
                description: 'Manage and moderate your community with powerful tools'
            },
            'Security': {
                emoji: '🛡️',
                color: '#00d4ff',
                commands: ['status', 'lockdown', 'antispam', 'antiraid'],
                description: 'Advanced protection against raids, spam, and attacks'
            },
            'Verification': {
                emoji: '✅',
                color: '#51cf66',
                commands: ['verify', 'verify-approve', 'verify-reject'],
                description: 'Verify users with captcha and approval workflows'
            },
            'Admin': {
                emoji: '⚙️',
                color: '#ffd43b',
                commands: ['setup', 'config', 'backup', 'logs'],
                description: 'Configure and manage bot settings'
            },
            'Leveling': {
                emoji: '📈',
                color: '#a78bfa',
                commands: ['rank'],
                description: 'XP system with ranks and level roles'
            },
            'Utility': {
                emoji: '🔧',
                color: '#1f2937',
                commands: ['help', 'ping', 'serverinfo', 'userinfo'],
                description: 'General utility and information commands'
            }
        };

        const helpEmbed = new EmbedBuilder()
            .setTitle('🛡️ DarkLock - Help Center')
            .setDescription('Select a category from the buttons below to learn more')
            .setColor('#00d4ff')
            .setThumbnail(interaction.client.user.displayAvatarURL({ size: 256 }))
            .setTimestamp()
            .setFooter({ text: 'Use /help <command> for detailed info on specific commands' });

        // Add category information
        let categoryText = '';
        for (const [category, info] of Object.entries(helpCategories)) {
            categoryText += `${info.emoji} **${category}**: ${info.description}\n`;
        }
        helpEmbed.addFields({ name: 'Available Categories', value: categoryText, inline: false });

        // Create buttons for each category
        const buttons = [];
        const categoryNames = Object.keys(helpCategories);
        
        for (let i = 0; i < categoryNames.length; i += 5) {
            const row = new ActionRowBuilder();
            const slice = categoryNames.slice(i, i + 5);
            
            slice.forEach(category => {
                const info = helpCategories[category];
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`help-category-${category.toLowerCase()}`)
                        .setLabel(category)
                        .setEmoji(info.emoji)
                        .setStyle(ButtonStyle.Secondary)
                );
            });
            
            buttons.push(row);
        }

        // Add admin panel button
        const dashboardUrl = process.env.DASHBOARD_URL || 'https://DarkLock.xyz/dashboard';
        const adminRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Admin Panel')
                    .setStyle(ButtonStyle.Link)
                    .setURL(dashboardUrl)
                    .setEmoji('📊'),
                new ButtonBuilder()
                    .setLabel('Support Server')
                    .setStyle(ButtonStyle.Link)
                    .setURL('https://discord.gg/r8dvnad9c9')
                    .setEmoji('🤝')
            );

        buttons.push(adminRow);

        await interaction.reply({
            embeds: [helpEmbed],
            components: buttons,
            ephemeral: true
        });

    } catch (error) {
        console.error('Error handling help modal:', error);
        if (!interaction.replied) {
            await interaction.reply({
                content: '❌ An error occurred while processing your request.',
                ephemeral: true
            }).catch(() => {});
        }
    }
}

/**
 * Handle help ticket modal submission
 * @param {ModalSubmitInteraction} interaction 
 * @param {SecurityBot} bot 
 */
async function handleHelpTicketModal(interaction, bot) {
    const category = interaction.customId.replace('help-ticket-modal-', '');

    try {
        const subject = interaction.fields.getTextInputValue('help-subject');
        const reason = interaction.fields.getTextInputValue('help-reason');
        const description = interaction.fields.getTextInputValue('help-description');

        // Create the ticket using ticketManager (combining reason and description)
        const fullDescription = `**Category:** ${reason}\n\n**Details:**\n${description}`;
        
        // Use ticketManager if available, otherwise provide a graceful fallback
        if (bot.ticketManager) {
            // ticketManager.createTicket handles deferReply internally
            await bot.ticketManager.createTicket(interaction, subject, fullDescription);
        } else {
            // Fallback: Just send a confirmation message
            await interaction.deferReply({ ephemeral: true });
            
            const fallbackEmbed = new EmbedBuilder()
                .setTitle('✅ Support Request Received')
                .setColor('#00ff00')
                .addFields(
                    { name: 'Category', value: getCategoryLabel(category), inline: true },
                    { name: 'Subject', value: subject, inline: false },
                    { name: 'Description', value: description.slice(0, 400) + (description.length > 400 ? '...' : ''), inline: false },
                )
                .setFooter({ text: 'A staff member will review your request.' })
                .setTimestamp();

            await interaction.editReply({ embeds: [fallbackEmbed] });
            
            // Try to notify admins
            try {
                const config = await bot.configManager.getGuildConfig(interaction.guildId);
                const supportChannelId = config?.supportChannelId || config?.modLogChannel;

                if (supportChannelId) {
                    const adminChannel = await interaction.guild.channels.fetch(supportChannelId);
                    if (adminChannel) {
                        const adminEmbed = new EmbedBuilder()
                            .setTitle(`🆘 New Support Request`)
                            .setColor('#ff9900')
                            .addFields(
                                { name: 'User', value: `${interaction.user.tag} (${interaction.user.id})`, inline: false },
                                { name: 'Category', value: getCategoryLabel(category), inline: true },
                                { name: 'Subject', value: subject, inline: false },
                                { name: 'Description', value: description.slice(0, 800) + (description.length > 800 ? '...' : ''), inline: false },
                            )
                            .setThumbnail(interaction.user.displayAvatarURL())
                            .setTimestamp();

                        await adminChannel.send({ embeds: [adminEmbed] });
                    }
                }
            } catch (e) {
                console.error('Failed to notify admins:', e);
            }
        }

    } catch (error) {
        bot.logger?.error('Error processing help ticket modal:', error);
        console.error('Error processing help ticket modal:', error);
        
        // Send error response
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    content: '❌ An error occurred while creating your ticket. Please try again.',
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: '❌ An error occurred while creating your ticket. Please try again.',
                    ephemeral: true
                });
            }
        } catch (replyError) {
            console.error('Failed to send error response:', replyError);
        }
    }
}

/**
 * Helper function to get category label
 */
function getCategoryLabel(category) {
    const labels = {
        'moderation': '🔨 Moderation',
        'security': '🛡️ Security',
        'verification': '✅ Verification',
        'admin': '⚙️ Admin',
        'leveling': '📈 Leveling',
        'utility': '🔧 Utility',
        'other': '📋 Other'
    };
    return labels[category] || `📋 ${category.charAt(0).toUpperCase() + category.slice(1)}`;
}

module.exports = {
    handleHelpModal,
    handleHelpTicketModal
};
