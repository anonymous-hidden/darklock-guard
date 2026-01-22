/**
 * DM Queue - Send DMs with rate limit protection
 */

class DMQueue {
    constructor(bot) {
        this.bot = bot;
        this.queue = [];
        this.processing = false;
        this.processDelay = 1000; // 1 DM per second
    }

    enqueueDM(member, content) {
        this.queue.push({ member, content, timestamp: Date.now() });
        this.bot.logger?.debug && this.bot.logger.debug(`[DMQueue] Enqueued DM for ${member.user.tag}, queue size: ${this.queue.length}`);
        
        if (!this.processing) {
            this.startProcessing();
        }
    }

    async startProcessing() {
        if (this.processing) return;
        this.processing = true;

        while (this.queue.length > 0) {
            const { member, content } = this.queue.shift();
            
            try {
                await member.send(content);
                this.bot.logger?.debug && this.bot.logger.debug(`[DMQueue] Sent DM to ${member.user.tag}`);
            } catch (error) {
                this.bot.logger?.warn && this.bot.logger.warn(`[DMQueue] Failed to DM ${member.user.tag}, attempting fallback:`, error.message);
                
                // Fallback to guild channel
                try {
                    const fallbackChannel = member.guild.systemChannel || 
                        member.guild.channels.cache.find(c => c.type === 0 && c.name.match(/verif/i)) ||
                        member.guild.channels.cache.find(c => c.type === 0 && c.permissionsFor(member.guild.members.me)?.has('SendMessages'));
                    
                    if (fallbackChannel) {
                        await fallbackChannel.send({ content: `${member}`, ...content });
                        this.bot.logger?.info && this.bot.logger.info(`[DMQueue] Sent fallback message to ${fallbackChannel.name}`);
                    }

                    // Mark in database that user has DMs closed
                    await this.bot.database.run(
                        `UPDATE verification_queue SET dm_failed = 1 WHERE guild_id = ? AND user_id = ? AND status = 'pending'`,
                        [member.guild.id, member.id]
                    );
                } catch (fallbackError) {
                    this.bot.logger?.error && this.bot.logger.error('[DMQueue] Fallback failed:', fallbackError);
                }
            }

            // Delay before next DM
            if (this.queue.length > 0) {
                await this.sleep(this.processDelay);
            }
        }

        this.processing = false;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getQueueSize() {
        return this.queue.length;
    }
}

module.exports = DMQueue;
