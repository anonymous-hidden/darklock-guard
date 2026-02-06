const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Import XP system components
const XPDatabase = require('./src/db/xpDatabase');
const XPTracker = require('./src/bot/xpTracker');
const WebDashboard = require('./src/web/server');

/**
 * Main bot initialization with XP system integration
 */
async function initializeBot() {
    console.log('🚀 Starting Discord bot with XP system...');

    // Create Discord client with required intents
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildMembers,
        ]
    });

    // Initialize commands collection
    client.commands = new Collection();

    try {
        // Initialize XP Database
        console.log('📊 Initializing XP database...');
        const xpDatabase = new XPDatabase('./data/xp.db');
        await xpDatabase.initialize();

        // Initialize XP Tracker
        console.log('⚡ Initializing XP tracker...');
        const xpTracker = new XPTracker(client, xpDatabase);
        client.xpTracker = xpTracker;
        client.xpDatabase = xpDatabase;

        // Load commands
        console.log('📂 Loading commands...');
        await loadCommands(client);

        // Initialize Web Dashboard
        console.log('🌐 Starting web dashboard...');
        const webDashboard = new WebDashboard(
            xpDatabase,
            client,
            parseInt(process.env.DASHBOARD_PORT || '3005')
        );
        client.webDashboard = webDashboard;

        // Bot ready event
        client.once('ready', async () => {
            console.log(`✅ Bot logged in as ${client.user.tag}`);
            console.log(`📊 Serving ${client.guilds.cache.size} guilds`);

            // Start web dashboard
            await webDashboard.start();
        });

        // Interaction handler
        client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;

            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error('Error executing command:', error);
                const reply = {
                    content: '❌ There was an error executing this command.',
                    ephemeral: true
                };
                
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(reply);
                } else {
                    await interaction.reply(reply);
                }
            }
        });

        // Error handling
        client.on('error', (error) => {
            console.error('Discord client error:', error);
        });

        process.on('unhandledRejection', (error) => {
            console.error('Unhandled promise rejection:', error);
        });

        // Graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\n🛑 Shutting down gracefully...');
            
            if (client.webDashboard) {
                await client.webDashboard.stop();
            }
            
            if (client.xpDatabase) {
                client.xpDatabase.close();
            }
            
            client.destroy();
            process.exit(0);
        });

        // Login to Discord
        await client.login(process.env.DISCORD_TOKEN);

    } catch (error) {
        console.error('❌ Failed to initialize bot:', error);
        process.exit(1);
    }
}

/**
 * Load all commands from commands directory
 */
async function loadCommands(client) {
    const commandsPath = path.join(__dirname, 'src/bot/commands');
    
    if (!fs.existsSync(commandsPath)) {
        console.warn('⚠️  Commands directory not found, creating...');
        fs.mkdirSync(commandsPath, { recursive: true });
        return;
    }

    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);

        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            console.log(`  ✓ Loaded command: ${command.data.name}`);
        } else {
            console.warn(`  ⚠️  Command ${file} is missing required properties`);
        }
    }
}

// Start the bot
initializeBot();
