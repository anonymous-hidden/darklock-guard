const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Deploy XP System Commands to Discord
 * Run this script to register the /leaderboard command
 */

const commands = [];

// Load leaderboard command
const commandPath = path.join(__dirname, 'src/bot/commands/leaderboard.js');
if (fs.existsSync(commandPath)) {
    const command = require(commandPath);
    commands.push(command.data.toJSON());
    console.log(`✓ Loaded command: ${command.data.name}`);
} else {
    console.error('❌ Leaderboard command not found!');
    process.exit(1);
}

// Create REST instance
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// Deploy commands
(async () => {
    try {
        console.log(`🚀 Started refreshing ${commands.length} application (/) commands.`);

        // Register commands globally
        const data = await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands },
        );

        console.log(`✅ Successfully reloaded ${data.length} application (/) commands.`);
        console.log('\nCommands registered:');
        data.forEach(cmd => {
            console.log(`  - /${cmd.name}: ${cmd.description}`);
        });

    } catch (error) {
        console.error('❌ Error deploying commands:', error);
    }
})();
