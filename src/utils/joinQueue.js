/**
 * Join Queue - Process member joins sequentially to avoid race conditions and rate limits
 */

class JoinQueue {
    constructor(bot) {
        this.bot = bot;
        this.queue = [];
        this.processing = false;
        this.processDelay = 400; // ms between joins
    }

    enqueueJoin(member) {
        this.queue.push(member);
        this.bot.logger?.debug && this.bot.logger.debug(`[JoinQueue] Enqueued ${member.user.tag}, queue size: ${this.queue.length}`);
        
        if (!this.processing) {
            this.startProcessing();
        }
    }

    async startProcessing() {
        if (this.processing) return;
        this.processing = true;

        while (this.queue.length > 0) {
            const member = this.queue.shift();
            
            try {
                await this.processJoin(member);
            } catch (error) {
                this.bot.logger?.error && this.bot.logger.error(`[JoinQueue] Failed to process ${member.user.tag}:`, error);
            }

            // Delay before next join to avoid rate limits
            if (this.queue.length > 0) {
                await this.sleep(this.processDelay);
            }
        }

        this.processing = false;
        this.bot.logger?.debug && this.bot.logger.debug('[JoinQueue] Queue empty, stopped processing');
    }

    async processJoin(member) {
        this.bot.logger?.info && this.bot.logger.info(`[JoinQueue] Processing join: ${member.user.tag}`);

        const config = await this.bot.database.getGuildConfig(member.guild.id);
        
        // Run verification intake if enabled
        if (config?.verification_enabled && this.bot.userVerification) {
            try {
                await this.bot.userVerification.verifyNewMember(member);
            } catch (err) {
                this.bot.logger?.error && this.bot.logger.error('[JoinQueue] Verification intake failed:', err);
            }
        }

        // Other join logic can be added here (welcome messages, auto-roles, etc.)
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getQueueSize() {
        return this.queue.length;
    }
}

module.exports = JoinQueue;
