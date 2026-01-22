/**
 * /admin - Destructive Server Actions Command
 * For dangerous operations that require extra care
 * 
 * Structure:
 * /admin lockdown - Lock all channels
 * /admin unlock - Unlock all channels  
 * /admin slowmode <seconds> [scope] - Set slowmode
 * /admin nuke - Clone and delete current channel
 * /admin audit [type] - Audit permissions (perms or roles)
 */

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { serverControlHandlers, rolescanHandlers } = require('../handlers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('⚠️ Destructive server actions - Use with caution')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        
        .addSubcommand(sub => sub
            .setName('lockdown')
            .setDescription('🔒 Lock ALL text channels for @everyone'))
        
        .addSubcommand(sub => sub
            .setName('unlock')
            .setDescription('🔓 Unlock ALL text channels for @everyone'))
        
        .addSubcommand(sub => sub
            .setName('slowmode')
            .setDescription('🐢 Set slowmode on channels')
            .addIntegerOption(opt => opt
                .setName('seconds')
                .setDescription('Slowmode delay (0 to disable)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(21600))
            .addStringOption(opt => opt
                .setName('scope')
                .setDescription('Apply to which channels')
                .addChoices(
                    { name: 'This channel only', value: 'here' },
                    { name: 'All channels', value: 'all' }
                )))
        
        .addSubcommand(sub => sub
            .setName('nuke')
            .setDescription('💣 Clone and delete this channel (clears all messages)'))
        
        .addSubcommand(sub => sub
            .setName('audit')
            .setDescription('🔎 Audit dangerous permissions')
            .addStringOption(opt => opt
                .setName('type')
                .setDescription('What to audit')
                .addChoices(
                    { name: '📋 Quick overview', value: 'overview' },
                    { name: '🎭 Role security scan', value: 'roles' }
                ))
            .addStringOption(opt => opt
                .setName('severity')
                .setDescription('Minimum severity for role scan')
                .addChoices(
                    { name: '🔴 Critical Only', value: 'CRITICAL' },
                    { name: '🟠 High & Above', value: 'HIGH' },
                    { name: '🟡 Medium & Above', value: 'MEDIUM' },
                    { name: '🟢 All', value: 'LOW' }
                ))
            .addBooleanOption(opt => opt
                .setName('include_bots')
                .setDescription('Include bot roles in scan'))),

    async execute(interaction) {
        const bot = interaction.client.bot;
        const sub = interaction.options.getSubcommand();

        switch (sub) {
            case 'lockdown':
                return serverControlHandlers.lockdown(interaction, bot);
            
            case 'unlock':
                return serverControlHandlers.unlock(interaction, bot);
            
            case 'slowmode': {
                const seconds = interaction.options.getInteger('seconds');
                const scope = interaction.options.getString('scope') || 'here';
                return serverControlHandlers.slowmode(interaction, bot, seconds, scope);
            }
            
            case 'nuke':
                return serverControlHandlers.nuke(interaction, bot);
            
            case 'audit': {
                const type = interaction.options.getString('type') || 'overview';
                if (type === 'roles') {
                    const severity = interaction.options.getString('severity') || 'MEDIUM';
                    const includeBots = interaction.options.getBoolean('include_bots') || false;
                    return rolescanHandlers.scan(interaction, bot, severity, includeBots);
                }
                return serverControlHandlers.auditPerms(interaction, bot);
            }
        }
    }
};
