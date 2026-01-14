/**
 * Anti-Nuke Event Handlers v2.0
 * Handles role, channel, ban, webhook, kick, and bot addition events for anti-nuke protection
 */

module.exports = {
    // Role Create
    roleCreate: {
        name: 'roleCreate',
        once: false,
        async execute(role, bot) {
            try {
                await bot.handleRoleCreate(role);
            } catch (error) {
                bot.logger.error('Error handling roleCreate:', error);
            }
        }
    },
    
    // Role Delete
    roleDelete: {
        name: 'roleDelete',
        once: false,
        async execute(role, bot) {
            try {
                await bot.handleRoleDelete(role);
            } catch (error) {
                bot.logger.error('Error handling roleDelete:', error);
            }
        }
    },
    
    // Role Update (permission escalation detection)
    roleUpdate: {
        name: 'roleUpdate',
        once: false,
        async execute(oldRole, newRole, bot) {
            try {
                await bot.handleRoleUpdate(oldRole, newRole);
            } catch (error) {
                bot.logger.error('Error handling roleUpdate:', error);
            }
        }
    },
    
    // Channel Create
    channelCreate: {
        name: 'channelCreate',
        once: false,
        async execute(channel, bot) {
            try {
                await bot.handleChannelCreate(channel);
            } catch (error) {
                bot.logger.error('Error handling channelCreate:', error);
            }
        }
    },
    
    // Channel Delete
    channelDelete: {
        name: 'channelDelete',
        once: false,
        async execute(channel, bot) {
            try {
                await bot.handleChannelDelete(channel);
            } catch (error) {
                bot.logger.error('Error handling channelDelete:', error);
            }
        }
    },
    
    // Channel Update (for snapshot maintenance)
    channelUpdate: {
        name: 'channelUpdate',
        once: false,
        async execute(oldChannel, newChannel, bot) {
            try {
                await bot.handleChannelUpdate(oldChannel, newChannel);
            } catch (error) {
                bot.logger.error('Error handling channelUpdate:', error);
            }
        }
    },
    
    // Guild Ban Add
    guildBanAdd: {
        name: 'guildBanAdd',
        once: false,
        async execute(ban, bot) {
            try {
                await bot.handleBanAdd(ban);
            } catch (error) {
                bot.logger.error('Error handling guildBanAdd:', error);
            }
        }
    },
    
    // Webhook Update
    webhookUpdate: {
        name: 'webhookUpdate',
        once: false,
        async execute(channel, bot) {
            try {
                await bot.handleWebhookUpdate(channel);
            } catch (error) {
                bot.logger.error('Error handling webhookUpdate:', error);
            }
        }
    },
    
    // Guild Member Add (Bot detection)
    guildMemberAddAntiNuke: {
        name: 'guildMemberAdd',
        once: false,
        async execute(member, bot) {
            try {
                // Only process bot additions for anti-nuke
                if (member.user.bot) {
                    await bot.handleBotAdd(member);
                }
            } catch (error) {
                bot.logger.error('Error handling guildMemberAdd (antinuke):', error);
            }
        }
    },
    
    // Guild Member Remove (Kick detection)
    guildMemberRemoveAntiNuke: {
        name: 'guildMemberRemove',
        once: false,
        async execute(member, bot) {
            try {
                await bot.handleMemberRemove(member);
            } catch (error) {
                bot.logger.error('Error handling guildMemberRemove (antinuke):', error);
            }
        }
    }
};
