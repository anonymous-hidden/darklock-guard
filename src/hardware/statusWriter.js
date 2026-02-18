const fs = require('fs').promises;
const path = require('path');

/**
 * Hardware Status Writer
 * Writes bot status to file for hardware displays and monitoring
 */
class HardwareStatusWriter {
    constructor(bot) {
        this.bot = bot;
        this.statusFile = path.join(process.cwd(), 'data', 'bot_status.json');
        this.updateInterval = 5000; // 5 seconds
        this.timer = null;
    }

    /**
     * Start periodic status updates
     */
    start() {
        // Ensure data directory exists
        this.ensureDataDir();
        
        // Write initial status
        this.writeStatus();
        
        // Set up periodic updates
        this.timer = setInterval(() => {
            this.writeStatus();
        }, this.updateInterval);
        
        this.bot.logger.info(`[Hardware Status] Writing to ${this.statusFile} every ${this.updateInterval/1000}s`);
    }

    /**
     * Stop periodic updates
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /**
     * Ensure data directory exists
     */
    async ensureDataDir() {
        const dataDir = path.dirname(this.statusFile);
        try {
            await fs.mkdir(dataDir, { recursive: true });
        } catch (error) {
            // Directory might already exist
        }
    }

    /**
     * Write current bot status to file
     */
    async writeStatus() {
        try {
            if (!this.bot.client || !this.bot.client.user) {
                return; // Bot not ready yet
            }

            const status = {
                online: true,
                timestamp: new Date().toISOString(),
                uptime: this.bot.client.uptime,
                guild_count: this.bot.client.guilds.cache.size,
                user_count: this.bot.client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0),
                ping: this.bot.client.ws.ping,
                username: this.bot.client.user.tag,
                user_id: this.bot.client.user.id
            };

            await fs.writeFile(this.statusFile, JSON.stringify(status, null, 2));
        } catch (error) {
            // Fail silently - don't spam logs if there's an issue
            if (error.code !== 'ENOENT') {
                this.bot.logger.error('[Hardware Status] Write error:', error.message);
            }
        }
    }

    /**
     * Write offline status (for graceful shutdown)
     */
    async writeOfflineStatus() {
        try {
            const status = {
                online: false,
                timestamp: new Date().toISOString(),
                guild_count: 0
            };

            await fs.writeFile(this.statusFile, JSON.stringify(status, null, 2));
        } catch (error) {
            // Ignore errors during shutdown
        }
    }
}

module.exports = HardwareStatusWriter;
