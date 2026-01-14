const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const os = require('os');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('console')
        .setDescription('🖥️ Bot console with system commands')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('help')
                .setDescription('Show all console commands')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Show detailed bot status')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('diagnostics')
                .setDescription('Run system diagnostics')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('incidents')
                .setDescription('View recent security incidents')
                .addIntegerOption(option =>
                    option
                        .setName('limit')
                        .setDescription('Number of incidents to show (default: 10)')
                        .setMinValue(1)
                        .setMaxValue(50)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('reload')
                .setDescription('Reload a specific module')
                .addStringOption(option =>
                    option
                        .setName('module')
                        .setDescription('Module to reload')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Commands', value: 'commands' },
                            { name: 'Events', value: 'events' },
                            { name: 'Database', value: 'database' },
                            { name: 'Config', value: 'config' }
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription('Show detailed statistics')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('health')
                .setDescription('Check system health metrics')
        ),

    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand();

        // Owner-only check
        const botOwnerIds = process.env.BOT_OWNER_IDS?.split(',') || [];
        if (!botOwnerIds.includes(interaction.user.id)) {
            return interaction.reply({
                content: '❌ This command is restricted to bot owners only.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            switch (subcommand) {
                case 'help':
                    await handleHelp(interaction);
                    break;
                case 'status':
                    await handleStatus(interaction, client);
                    break;
                case 'diagnostics':
                    await handleDiagnostics(interaction, client);
                    break;
                case 'incidents':
                    await handleIncidents(interaction, client);
                    break;
                case 'reload':
                    await handleReload(interaction, client);
                    break;
                case 'stats':
                    await handleStats(interaction, client);
                    break;
                case 'health':
                    await handleHealth(interaction, client);
                    break;
                default:
                    await interaction.editReply('❌ Unknown subcommand.');
            }
        } catch (error) {
            client.logger?.error('Console command error:', error);
            await interaction.editReply('❌ An error occurred while executing the command.');
        }
    }
};

async function handleHelp(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('🖥️ Bot Console - Command Reference')
        .setColor('#6366f1')
        .setDescription('**Available Console Commands:**')
        .addFields(
            { 
                name: '📋 /console help', 
                value: 'Show this help menu', 
                inline: false 
            },
            { 
                name: '📊 /console status', 
                value: 'Show detailed bot status (uptime, memory, guilds, users)', 
                inline: false 
            },
            { 
                name: '🔍 /console diagnostics', 
                value: 'Run system diagnostics (CPU, memory, latency, database)', 
                inline: false 
            },
            { 
                name: '🚨 /console incidents', 
                value: 'View recent security incidents with filters', 
                inline: false 
            },
            { 
                name: '🔄 /console reload', 
                value: 'Reload specific modules (commands, events, database, config)', 
                inline: false 
            },
            { 
                name: '📈 /console stats', 
                value: 'Show detailed bot statistics and performance metrics', 
                inline: false 
            },
            { 
                name: '💚 /console health', 
                value: 'Check system health (API status, database, WebSocket)', 
                inline: false 
            }
        )
        .setFooter({ text: '🔒 Owner-only command' })
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}

async function handleStatus(interaction, client) {
    const uptime = formatUptime(client.uptime);
    const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
    const totalMemory = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
    const usedMemory = ((os.totalmem() - os.freemem()) / 1024 / 1024 / 1024).toFixed(2);
    
    const guilds = client.guilds.cache.size;
    const users = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
    const channels = client.channels.cache.size;
    
    const embed = new EmbedBuilder()
        .setTitle('📊 Bot Status')
        .setColor('#4ade80')
        .addFields(
            { name: '⏰ Uptime', value: uptime, inline: true },
            { name: '📝 Commands Loaded', value: `${client.commands?.size || 0}`, inline: true },
            { name: '🌐 Guilds', value: `${guilds}`, inline: true },
            { name: '👥 Total Users', value: `${users.toLocaleString()}`, inline: true },
            { name: '📺 Channels', value: `${channels}`, inline: true },
            { name: '🏓 Latency', value: `${client.ws.ping}ms`, inline: true },
            { name: '💾 Bot Memory', value: `${memoryUsage} MB`, inline: true },
            { name: '🖥️ System Memory', value: `${usedMemory} GB / ${totalMemory} GB`, inline: true },
            { name: '⚙️ Node.js', value: process.version, inline: true }
        )
        .setFooter({ text: `Bot ID: ${client.user.id}` })
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}

async function handleDiagnostics(interaction, client) {
    const startTime = Date.now();
    
    // CPU Usage
    const cpuUsage = process.cpuUsage();
    const cpuPercent = ((cpuUsage.user + cpuUsage.system) / 1000000).toFixed(2);
    
    // Memory
    const mem = process.memoryUsage();
    const heapUsed = (mem.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotal = (mem.heapTotal / 1024 / 1024).toFixed(2);
    const external = (mem.external / 1024 / 1024).toFixed(2);
    
    // Database test
    let dbStatus = '✅ Connected';
    let dbLatency = 0;
    try {
        const dbStart = Date.now();
        await client.database.get('SELECT 1');
        dbLatency = Date.now() - dbStart;
    } catch (error) {
        dbStatus = '❌ Error: ' + error.message;
    }
    
    // WebSocket
    const wsStatus = client.ws.status === 0 ? '✅ Ready' : `⚠️ Status: ${client.ws.status}`;
    const wsPing = client.ws.ping;
    
    const diagnosticTime = Date.now() - startTime;
    
    const embed = new EmbedBuilder()
        .setTitle('🔍 System Diagnostics')
        .setColor('#6366f1')
        .addFields(
            { name: '🖥️ CPU Usage', value: `${cpuPercent}%`, inline: true },
            { name: '💾 Heap Used/Total', value: `${heapUsed} MB / ${heapTotal} MB`, inline: true },
            { name: '📦 External Memory', value: `${external} MB`, inline: true },
            { name: '🗄️ Database', value: dbStatus, inline: true },
            { name: '⚡ DB Latency', value: `${dbLatency}ms`, inline: true },
            { name: '🌐 WebSocket', value: wsStatus, inline: true },
            { name: '🏓 WS Ping', value: `${wsPing}ms`, inline: true },
            { name: '⏱️ Diagnostic Time', value: `${diagnosticTime}ms`, inline: true },
            { name: '🔄 Event Loop Lag', value: 'Not implemented', inline: true }
        )
        .setFooter({ text: 'Run /console health for detailed health checks' })
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}

async function handleIncidents(interaction, client) {
    const limit = interaction.options.getInteger('limit') || 10;
    
    try {
        const incidents = await client.database.all(
            `SELECT * FROM security_incidents 
             WHERE guild_id = ? 
             ORDER BY created_at DESC 
             LIMIT ?`,
            [interaction.guild.id, limit]
        );

        if (!incidents || incidents.length === 0) {
            return interaction.editReply('✅ No recent security incidents found.');
        }

        const embed = new EmbedBuilder()
            .setTitle('🚨 Recent Security Incidents')
            .setColor('#ef4444')
            .setDescription(`Showing ${incidents.length} most recent incidents:`)
            .setTimestamp();

        for (const incident of incidents.slice(0, 10)) {
            const severityEmoji = {
                'critical': '🔴',
                'high': '🟠',
                'medium': '🟡',
                'low': '🟢'
            }[incident.severity] || '⚪';

            const statusEmoji = incident.resolved ? '✅' : '⏳';
            
            embed.addFields({
                name: `${severityEmoji} ${incident.incident_type} ${statusEmoji}`,
                value: `**Description:** ${incident.description}\n` +
                       `**Time:** <t:${Math.floor(new Date(incident.created_at).getTime() / 1000)}:R>\n` +
                       `**User:** <@${incident.user_id}>`,
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        client.logger?.error('Incidents fetch error:', error);
        await interaction.editReply('❌ Failed to fetch incidents.');
    }
}

async function handleReload(interaction, client) {
    const module = interaction.options.getString('module');
    
    await interaction.editReply(`🔄 Reloading ${module}...`);
    
    try {
        switch (module) {
            case 'commands':
                // Reload command files
                const commandFiles = require('fs').readdirSync('./src/commands').filter(file => file.endsWith('.js'));
                for (const file of commandFiles) {
                    delete require.cache[require.resolve(`../${file}`)];
                }
                await interaction.editReply('✅ Commands reloaded successfully!');
                break;
                
            case 'events':
                await interaction.editReply('⚠️ Event reloading requires bot restart.');
                break;
                
            case 'database':
                // Reconnect to database
                await client.database.initialize();
                await interaction.editReply('✅ Database connection refreshed!');
                break;
                
            case 'config':
                // Reload config
                delete require.cache[require.resolve('../../../config.json')];
                await interaction.editReply('✅ Configuration reloaded!');
                break;
                
            default:
                await interaction.editReply('❌ Unknown module.');
        }
    } catch (error) {
        client.logger?.error('Reload error:', error);
        await interaction.editReply(`❌ Reload failed: ${error.message}`);
    }
}

async function handleStats(interaction, client) {
    try {
        const guildId = interaction.guild.id;
        
        // Fetch various statistics
        const [
            totalMessages,
            totalCommands,
            activeTickets,
            modActions,
            securityLogs
        ] = await Promise.all([
            client.database.get('SELECT COUNT(*) as count FROM message_analytics WHERE guild_id = ?', [guildId]),
            client.database.get('SELECT COUNT(*) as count FROM command_analytics WHERE guild_id = ?', [guildId]),
            client.database.get('SELECT COUNT(*) as count FROM active_tickets WHERE guild_id = ? AND status = "open"', [guildId]),
            client.database.get('SELECT COUNT(*) as count FROM mod_actions WHERE guild_id = ? AND created_at > datetime("now", "-7 days")', [guildId]),
            client.database.get('SELECT COUNT(*) as count FROM security_logs WHERE guild_id = ? AND timestamp > datetime("now", "-7 days")', [guildId])
        ]);

        const embed = new EmbedBuilder()
            .setTitle('📈 Bot Statistics')
            .setColor('#8b5cf6')
            .addFields(
                { name: '💬 Total Messages Tracked', value: `${totalMessages?.count || 0}`, inline: true },
                { name: '⚡ Total Commands Used', value: `${totalCommands?.count || 0}`, inline: true },
                { name: '🎫 Active Tickets', value: `${activeTickets?.count || 0}`, inline: true },
                { name: '🛡️ Mod Actions (7d)', value: `${modActions?.count || 0}`, inline: true },
                { name: '🔒 Security Logs (7d)', value: `${securityLogs?.count || 0}`, inline: true },
                { name: '🌐 Total Guilds', value: `${client.guilds.cache.size}`, inline: true }
            )
            .setFooter({ text: 'Statistics for this server' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        client.logger?.error('Stats error:', error);
        await interaction.editReply('❌ Failed to fetch statistics.');
    }
}

async function handleHealth(interaction, client) {
    const checks = [];
    
    // Discord API
    const apiStart = Date.now();
    try {
        await client.guilds.fetch(interaction.guild.id);
        checks.push({
            name: '🌐 Discord API',
            status: '✅ Healthy',
            latency: `${Date.now() - apiStart}ms`
        });
    } catch (error) {
        checks.push({
            name: '🌐 Discord API',
            status: '❌ Error',
            latency: error.message
        });
    }
    
    // Database
    const dbStart = Date.now();
    try {
        await client.database.get('SELECT 1');
        checks.push({
            name: '🗄️ Database',
            status: '✅ Healthy',
            latency: `${Date.now() - dbStart}ms`
        });
    } catch (error) {
        checks.push({
            name: '🗄️ Database',
            status: '❌ Error',
            latency: error.message
        });
    }
    
    // WebSocket
    if (client.ws.status === 0) {
        checks.push({
            name: '🔌 WebSocket',
            status: '✅ Connected',
            latency: `${client.ws.ping}ms`
        });
    } else {
        checks.push({
            name: '🔌 WebSocket',
            status: `⚠️ Status: ${client.ws.status}`,
            latency: 'N/A'
        });
    }
    
    // Memory
    const memPercent = ((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100).toFixed(1);
    checks.push({
        name: '💾 Memory',
        status: memPercent < 80 ? '✅ Healthy' : '⚠️ High Usage',
        latency: `${memPercent}% used`
    });
    
    const embed = new EmbedBuilder()
        .setTitle('💚 System Health Check')
        .setColor('#10b981')
        .setDescription('Current health status of all systems:')
        .setTimestamp();
    
    for (const check of checks) {
        embed.addFields({
            name: check.name,
            value: `${check.status}\n**Latency:** ${check.latency}`,
            inline: true
        });
    }
    
    const overallStatus = checks.every(c => c.status.includes('✅')) ? '✅ All Systems Operational' : '⚠️ Some Issues Detected';
    embed.setFooter({ text: overallStatus });
    
    await interaction.editReply({ embeds: [embed] });
}

function formatUptime(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0) parts.push(`${seconds}s`);
    
    return parts.join(' ') || '0s';
}
