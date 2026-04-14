'use strict';

/**
 * AnalyticsCollector — Hooks into Discord.js events and funnels
 * them through EventBus for realtime dashboard streaming.
 *
 * Handles: messages, member joins/leaves, mod actions, security events,
 * verification updates, and periodic aggregate snapshots.
 */

const EventBus = require('./EventBus');

class AnalyticsCollector {
    /**
     * @param {Object} bot       - Bot instance (bot.client, bot.database, etc.)
     * @param {Object} [opts]
     * @param {number} [opts.snapshotInterval=30000] - How often to push aggregate snapshots (ms).
     */
    constructor(bot, opts = {}) {
        this.bot = bot;
        this.bus = new EventBus({ flushInterval: opts.flushInterval ?? 500 });
        this._snapshotInterval = opts.snapshotInterval ?? 30_000;
        this._snapshotTimer = null;
        this._boundHandlers = {};
    }

    /** Attach to Discord.js client events. Call once after client is ready. */
    start() {
        const client = this.bot.client;
        if (!client) return;

        // ── message tracking ──
        this._on(client, 'messageCreate', (msg) => {
            if (msg.author?.bot || !msg.guild) return;
            this.bus.push(msg.guild.id, 'message', {
                channelId: msg.channel.id,
                channelName: msg.channel.name,
                userId: msg.author.id,
                username: msg.author.username,
            });
        });

        // ── member join ──
        this._on(client, 'guildMemberAdd', (member) => {
            this.bus.push(member.guild.id, 'member_join', {
                userId: member.user.id,
                username: member.user.username,
                isBot: member.user.bot,
                accountAge: Date.now() - member.user.createdTimestamp,
            });
        });

        // ── member leave ──
        this._on(client, 'guildMemberRemove', (member) => {
            this.bus.push(member.guild.id, 'member_leave', {
                userId: member.user.id,
                username: member.user.username,
            });
        });

        // ── moderation (hook into existing logger if available) ──
        if (this.bot.on) {
            this._on(this.bot, 'modAction', (guildId, data) => {
                this.bus.push(guildId, 'mod_action', data);
            });

            this._on(this.bot, 'securityEvent', (guildId, data) => {
                this.bus.push(guildId, 'security_event', data);
            });

            this._on(this.bot, 'verificationUpdate', (guildId, data) => {
                this.bus.push(guildId, 'verification', data);
            });
        }

        // ── periodic aggregate snapshots ──
        this._snapshotTimer = setInterval(() => this._pushSnapshots(), this._snapshotInterval);

        this.bot.logger?.info('[AnalyticsCollector] Realtime analytics collection started');
    }

    /** Detach all listeners. */
    stop() {
        for (const { emitter, event, handler } of Object.values(this._boundHandlers)) {
            emitter.removeListener(event, handler);
        }
        this._boundHandlers = {};
        clearInterval(this._snapshotTimer);
        this.bus.destroy();
    }

    /** Push a manual event (for systems that don't use Discord.js events). */
    push(guildId, type, data) {
        this.bus.push(guildId, type, data);
    }

    /* ─── internal ────────────────────────────────────────────────── */

    _on(emitter, event, handler) {
        emitter.on(event, handler);
        this._boundHandlers[event] = { emitter, event, handler };
    }

    async _pushSnapshots() {
        const client = this.bot.client;
        if (!client) return;

        for (const [guildId, guild] of client.guilds.cache) {
            try {
                const online = guild.members.cache.filter(m => m.presence?.status !== 'offline').size;
                const snapshot = {
                    memberCount: guild.memberCount,
                    online,
                    channelCount: guild.channels.cache.size,
                    boostLevel: guild.premiumTier,
                    boostCount: guild.premiumSubscriptionCount ?? 0,
                };

                // DB stats (non-blocking)
                try {
                    const db = this.bot.database?.db;
                    if (db?.getAsync) {
                        const row = await db.getAsync(
                            `SELECT COUNT(*) as cnt FROM message_logs WHERE guild_id = ? AND timestamp >= datetime('now', '-1 hour')`,
                            [guildId]
                        );
                        snapshot.messagesLastHour = row?.cnt ?? 0;
                    }
                } catch { /* non-fatal */ }

                this.bus.setSnapshot(guildId, snapshot);
            } catch { /* non-fatal per guild */ }
        }
    }
}

module.exports = AnalyticsCollector;
