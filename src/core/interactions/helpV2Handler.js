/**
 * Help System Interaction Handler - REBUILT
 * 
 * This is the SINGLE handler for all /help interactions.
 * It handles:
 * 1. Category button clicks → update embed
 * 2. Back button clicks → return to main menu  
 * 3. Ticket button clicks → show modal (NO defer!)
 * 4. Modal submissions → defer → create ticket → editReply
 * 
 * CRITICAL RULES:
 * - NEVER defer before showModal (Discord will reject)
 * - ALWAYS use update() for navigation (changes existing message)
 * - ALWAYS use reply() or deferReply() for new responses
 * - Modal submit MUST deferReply() immediately
 */

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const helpCommand = require('../../commands/utility/help');

// Import constants from help command
const {
    PREFIX,
    BUTTON_CATEGORY,
    BUTTON_BACK,
    BUTTON_TICKET,
    MODAL_TICKET,
    HELP_CATEGORIES
} = helpCommand;

/**
 * Register help interaction handlers
 * Call this once during bot initialization
 */
function registerHelpHandlers(bot) {
    // Store handler reference on bot for the main interactionCreate to call
    bot.helpV2Handler = handleHelpInteraction;
    bot.logger?.info('[HelpV2] Help interaction handlers registered');
}

/**
 * Main interaction handler
 * Returns true if interaction was handled, false otherwise
 */
async function handleHelpInteraction(interaction, bot) {
    // Check if this is a help v2 interaction
    const customId = interaction.customId || '';
    
    if (!customId.startsWith(PREFIX)) {
        return false; // Not our interaction
    }

    try {
        // BUTTON: Category selection
        if (customId.startsWith(BUTTON_CATEGORY)) {
            await handleCategoryButton(interaction, bot);
            return true;
        }

        // BUTTON: Back to main menu
        if (customId === BUTTON_BACK) {
            await handleBackButton(interaction, bot);
            return true;
        }

        // BUTTON: Create ticket (shows modal)
        if (customId.startsWith(BUTTON_TICKET)) {
            await handleTicketButton(interaction, bot);
            return true;
        }

        // MODAL: Ticket submission
        if (customId.startsWith(MODAL_TICKET)) {
            await handleTicketModal(interaction, bot);
            return true;
        }

        return false;
    } catch (error) {
        bot.logger?.error('[HelpV2] Interaction error:', error);
        
        // Try to respond with error
        const errorMessage = '❌ An error occurred. Please try again.';
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: errorMessage });
            } else if (interaction.isModalSubmit()) {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            } else {
                await interaction.update({ content: errorMessage, embeds: [], components: [] });
            }
        } catch (e) {
            // Can't respond, ignore
        }
        return true;
    }
}

/**
 * Handle category button click
 * Updates the message with category details
 */
async function handleCategoryButton(interaction, bot) {
    const categoryKey = interaction.customId.replace(BUTTON_CATEGORY, '');
    
    if (!HELP_CATEGORIES[categoryKey]) {
        return interaction.update({ 
            content: '❌ Unknown category', 
            embeds: [], 
            components: [] 
        });
    }

    const embed = helpCommand.buildCategoryEmbed(categoryKey);
    const components = helpCommand.buildCategoryComponents(categoryKey);

    // Use update() to modify the existing message
    await interaction.update({ embeds: [embed], components });
}

/**
 * Handle back button click
 * Returns to main help menu
 */
async function handleBackButton(interaction, bot) {
    const embed = helpCommand.buildMainEmbed(interaction.client);
    const components = helpCommand.buildMainComponents();

    // Use update() to modify the existing message
    await interaction.update({ embeds: [embed], components });
}

/**
 * Handle ticket button click
 * Shows the ticket creation modal
 * 
 * CRITICAL: Do NOT defer before showModal!
 */
async function handleTicketButton(interaction, bot) {
    const categoryKey = interaction.customId.replace(BUTTON_TICKET, '');
    const modal = helpCommand.buildTicketModal(categoryKey);

    // showModal() is the acknowledgement - do not defer first!
    await interaction.showModal(modal);
}

/**
 * Handle ticket modal submission
 * Creates the ticket and sends confirmation
 */
async function handleTicketModal(interaction, bot) {
    // IMMEDIATELY defer - this is required for modal submissions
    await interaction.deferReply({ ephemeral: true });

    const categoryKey = interaction.customId.replace(MODAL_TICKET, '');
    const cat = HELP_CATEGORIES[categoryKey] || { label: 'General', emoji: '📋' };

    // Extract form values
    const subject = interaction.fields.getTextInputValue('ticket_subject');
    const category = interaction.fields.getTextInputValue('ticket_category');
    const description = interaction.fields.getTextInputValue('ticket_description');

    // Generate ticket ID
    const ticketId = `TKT-${Date.now().toString(36).toUpperCase()}`;

    // Build full description
    const fullDescription = `**Category:** ${category}\n**Subject:** ${subject}\n\n**Description:**\n${description}`;

    // Try to create ticket using ticket manager
    let ticketCreated = false;
    let ticketChannel = null;

    if (bot.ticketManager && typeof bot.ticketManager.createTicket === 'function') {
        try {
            const result = await bot.ticketManager.createTicketChannel(
                interaction.guild,
                interaction.user,
                subject,
                fullDescription
            );
            if (result?.channel) {
                ticketChannel = result.channel;
                ticketCreated = true;
            }
        } catch (e) {
            bot.logger?.warn('[HelpV2] TicketManager failed, using fallback:', e.message);
        }
    }

    // Fallback: Store ticket in database
    if (!ticketCreated) {
        try {
            await bot.database.run(`
                INSERT INTO support_tickets (
                    ticket_id, guild_id, user_id, category, subject, description, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP)
            `, [ticketId, interaction.guildId, interaction.user.id, category, subject, description]);
            ticketCreated = true;
        } catch (dbError) {
            bot.logger?.error('[HelpV2] Failed to save ticket to DB:', dbError);
        }
    }

    // Build confirmation embed
    const confirmEmbed = new EmbedBuilder()
        .setTitle(ticketCreated ? '✅ Ticket Created' : '⚠️ Ticket Received')
        .setColor(ticketCreated ? 0x00ff00 : 0xffaa00)
        .addFields(
            { name: 'Ticket ID', value: `\`${ticketId}\``, inline: true },
            { name: 'Category', value: `${cat.emoji} ${category}`, inline: true },
            { name: 'Status', value: '🔄 Open', inline: true },
            { name: 'Subject', value: subject, inline: false },
            { name: 'Description', value: description.slice(0, 500) + (description.length > 500 ? '...' : ''), inline: false }
        )
        .setFooter({ text: ticketCreated 
            ? 'A staff member will respond shortly.' 
            : 'Your request has been logged. Staff will follow up.' 
        })
        .setTimestamp();

    if (ticketChannel) {
        confirmEmbed.addFields({ 
            name: 'Ticket Channel', 
            value: `${ticketChannel}`, 
            inline: false 
        });
    }

    await interaction.editReply({ embeds: [confirmEmbed] });

    // Notify staff in support channel (if configured)
    try {
        await notifyStaff(interaction, bot, ticketId, category, subject, description, cat);
    } catch (e) {
        bot.logger?.warn('[HelpV2] Failed to notify staff:', e.message);
    }

    // Try to DM user confirmation
    try {
        await interaction.user.send({ embeds: [confirmEmbed] });
    } catch (e) {
        // Can't DM user, that's okay
    }
}

/**
 * Notify staff about new ticket
 */
async function notifyStaff(interaction, bot, ticketId, category, subject, description, cat) {
    // Try to find support channel
    let supportChannel = null;

    // Check config for support channel
    try {
        const config = await bot.database.get(
            'SELECT support_channel_id, mod_log_channel FROM guild_configs WHERE guild_id = ?',
            [interaction.guildId]
        );
        
        if (config?.support_channel_id) {
            supportChannel = interaction.guild.channels.cache.get(config.support_channel_id);
        }
        if (!supportChannel && config?.mod_log_channel) {
            supportChannel = interaction.guild.channels.cache.get(config.mod_log_channel);
        }
    } catch (e) {}

    // Fallback: Look for channel by name
    if (!supportChannel) {
        supportChannel = interaction.guild.channels.cache.find(c => 
            c.isTextBased() && 
            (c.name.includes('support') || c.name.includes('ticket') || c.name.includes('help'))
        );
    }

    if (!supportChannel?.isTextBased()) return;

    const staffEmbed = new EmbedBuilder()
        .setTitle(`🆘 New Support Ticket: ${ticketId}`)
        .setColor(0xff9900)
        .addFields(
            { name: 'User', value: `${interaction.user.tag} (${interaction.user.id})`, inline: false },
            { name: 'Category', value: `${cat.emoji} ${category}`, inline: true },
            { name: 'Status', value: '🔄 Open', inline: true },
            { name: 'Subject', value: subject, inline: false },
            { name: 'Description', value: description.slice(0, 800) + (description.length > 800 ? '...' : ''), inline: false }
        )
        .setThumbnail(interaction.user.displayAvatarURL())
        .setTimestamp()
        .setFooter({ text: ticketId });

    await supportChannel.send({ embeds: [staffEmbed] });
}

module.exports = {
    registerHelpHandlers,
    handleHelpInteraction,
    PREFIX
};
