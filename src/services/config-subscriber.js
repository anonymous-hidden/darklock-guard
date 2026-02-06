/**
 * ConfigSubscriber — Connects ConfigService change events to bot runtime modules.
 * 
 * This is the glue layer that makes config changes propagate immediately to
 * security modules without requiring a restart or waiting for cache TTL expiry.
 * 
 * Architecture:
 *   Dashboard PUT → ConfigService.update() → emit('configChanged') → ConfigSubscriber
 *                                                                      ├── invalidate module caches
 *                                                                      ├── toggle module state
 *                                                                      └── push new thresholds
 * 
 * Modules fall into 3 categories:
 *   1. guild_configs consumers (AntiSpam, AntiRaid, AntiNuke, etc.) → handled via ConfigService cache
 *   2. Isolated-table modules (WebhookProtection, EmojiSpam, AltDetector) → separate invalidation
 *   3. Bot-level state (feature flags, log channels) → direct bot property updates
 * 
 * @module ConfigSubscriber
 */

class ConfigSubscriber {
    constructor(bot) {
        this.bot = bot;
        this.subscriptions = new Map(); // key pattern → handler[]
        this._bound = false;
    }

    /**
     * Bind to ConfigService events. Safe to call multiple times — only binds once.
     */
    bind() {
        if (this._bound) return;
        const configService = this.bot.configService;
        if (!configService) {
            this.bot.logger?.warn('[ConfigSubscriber] No ConfigService available, skipping bind');
            return;
        }

        configService.on('configChanged', (event) => this._dispatch(event));
        this._registerCoreSubscriptions();
        this._bound = true;
        this.bot.logger?.info('[ConfigSubscriber] Bound to ConfigService events');
    }

    /**
     * Register a handler that fires when a config key matching `pattern` changes.
     * 
     * @param {string|RegExp} pattern - Exact key name or regex pattern
     * @param {Function} handler - async (event) => void, receives { guildId, userId, key, oldValue, newValue }
     * @returns {Function} unsubscribe function
     */
    on(pattern, handler) {
        const key = pattern instanceof RegExp ? pattern.source : pattern;
        if (!this.subscriptions.has(key)) {
            this.subscriptions.set(key, { pattern, handlers: [] });
        }
        this.subscriptions.get(key).handlers.push(handler);

        // Return unsubscribe function
        return () => {
            const entry = this.subscriptions.get(key);
            if (entry) {
                entry.handlers = entry.handlers.filter(h => h !== handler);
                if (entry.handlers.length === 0) this.subscriptions.delete(key);
            }
        };
    }

    /**
     * Dispatch a configChanged event to all matching subscribers.
     * @private
     */
    async _dispatch(event) {
        const { key, guildId } = event;
        let dispatched = 0;

        for (const [, entry] of this.subscriptions) {
            const matches = entry.pattern instanceof RegExp
                ? entry.pattern.test(key)
                : entry.pattern === key;

            if (matches) {
                for (const handler of entry.handlers) {
                    try {
                        await handler(event);
                        dispatched++;
                    } catch (err) {
                        this.bot.logger?.error(
                            `[ConfigSubscriber] Handler error for key=${key} guild=${guildId}: ${err.message}`
                        );
                    }
                }
            }
        }

        if (dispatched > 0) {
            this.bot.logger?.debug?.(
                `[ConfigSubscriber] Dispatched ${dispatched} handler(s) for key=${key} guild=${guildId}`
            );
        }
    }

    /**
     * Register core subscriptions for security modules.
     * Each subscription connects a config key (or pattern) to the appropriate
     * module invalidation or state update.
     * @private
     */
    _registerCoreSubscriptions() {
        // ─── Anti-Spam: push threshold changes immediately ───
        this.on(/^(anti_spam_enabled|antispam_enabled|spam_message_limit|spam_time_window|spam_action)$/, async (event) => {
            const antiSpam = this.bot.antiSpam;
            if (!antiSpam) return;

            // AntiSpam reads fresh from DB every message — no cache to invalidate.
            // But if it gains a cache in the future, invalidate it here.
            if (typeof antiSpam.invalidateCache === 'function') {
                antiSpam.invalidateCache(event.guildId);
            }
        });

        // ─── Anti-Raid: invalidate + toggle lockdown awareness ───
        this.on(/^(anti_raid_enabled|antiraid_enabled|raid_join_limit|raid_time_window|raid_action)$/, async (event) => {
            const antiRaid = this.bot.antiRaid;
            if (!antiRaid) return;

            if (typeof antiRaid.invalidateCache === 'function') {
                antiRaid.invalidateCache(event.guildId);
            }

            // If raid protection was just disabled, deactivate any active lockdown
            if (/anti_raid_enabled|antiraid_enabled/.test(event.key) && !event.newValue) {
                if (typeof antiRaid.deactivateLockdown === 'function') {
                    try {
                        await antiRaid.deactivateLockdown(event.guildId);
                    } catch (err) {
                        this.bot.logger?.warn(`[ConfigSubscriber] Failed to deactivate lockdown for ${event.guildId}: ${err.message}`);
                    }
                }
            }
        });

        // ─── Anti-Nuke: refresh protection state ───
        this.on(/^(antinuke_enabled|antinuke_)/, async (event) => {
            const antiNuke = this.bot.antiNuke;
            if (!antiNuke) return;

            if (typeof antiNuke.invalidateCache === 'function') {
                antiNuke.invalidateCache(event.guildId);
            }
        });

        // ─── Anti-Phishing: toggle state ───
        this.on(/^anti_phishing_enabled$/, async (event) => {
            const antiPhishing = this.bot.antiPhishing;
            if (!antiPhishing) return;

            if (typeof antiPhishing.invalidateCache === 'function') {
                antiPhishing.invalidateCache(event.guildId);
            }
        });

        // ─── Anti-Links: toggle + threshold updates ───
        this.on(/^(anti_links_enabled|anti_links_)/, async (event) => {
            const antiLinks = this.bot.antiLinks;
            if (!antiLinks) return;

            if (typeof antiLinks.invalidateCache === 'function') {
                antiLinks.invalidateCache(event.guildId);
            }
        });

        // ─── Word Filter: invalidate cached filter list ───
        this.on(/^(word_filter|content_filter)/, async (event) => {
            const wordFilter = this.bot.wordFilter;
            if (!wordFilter) return;

            // WordFilter already has a cache with invalidate — use it
            if (typeof wordFilter.invalidateCache === 'function') {
                wordFilter.invalidateCache(event.guildId);
            }
        });

        // ─── AutoMod: general toggle ───
        this.on(/^(auto_mod_enabled|automod_enabled)$/, async (event) => {
            const autoMod = this.bot.autoMod;
            if (!autoMod) return;

            if (typeof autoMod.invalidateCache === 'function') {
                autoMod.invalidateCache(event.guildId);
            }
        });

        // ─── Verification: push config changes ───
        this.on(/^(verification_enabled|verification_method|verification_profile|verification_channel_id|verified_role_id|unverified_role_id|verification_timeout|verification_min_account_age)/, async (event) => {
            const verification = this.bot.userVerification || this.bot.verificationSystem;
            if (!verification) return;

            if (typeof verification.invalidateCache === 'function') {
                verification.invalidateCache(event.guildId);
            }
        });

        // ─── Logging: update log channel references ───
        this.on(/^(mod_log_channel|logging_enabled|log_channel)/, async (event) => {
            // No specific module — logging reads fresh from config each time.
            // This subscription exists as a hook point for future log-channel caching.
        });

        // ─── Welcome/Goodbye: push message changes ───
        this.on(/^(welcome_enabled|welcome_channel|welcome_message|goodbye_enabled|goodbye_channel|goodbye_message)$/, async (event) => {
            // Welcome system reads fresh from DB — no cache to invalidate.
            // Hook point for future caching.
        });

        // ─── Escalation thresholds ───
        this.on(/^(escalation_|warnings_for_)/, async (event) => {
            // Escalation thresholds are read fresh from config each time.
            // Hook point for pushing to cached escalation engine.
        });

        // ─── CachedConfigService invalidation (if used) ───
        // Any config change should invalidate the CachedConfigService for that guild
        this.on(/.*/, async (event) => {
            const cachedConfig = this.bot.cachedConfigService;
            if (cachedConfig && typeof cachedConfig.invalidate === 'function') {
                cachedConfig.invalidate(event.guildId);
            }
        });
    }

    /**
     * Get subscription stats for diagnostics.
     */
    getStats() {
        const stats = {};
        for (const [key, entry] of this.subscriptions) {
            stats[key] = entry.handlers.length;
        }
        return {
            bound: this._bound,
            patterns: this.subscriptions.size,
            handlers: Object.values(stats).reduce((a, b) => a + b, 0),
            detail: stats
        };
    }

    /**
     * Unbind all listeners and clear subscriptions.
     */
    destroy() {
        if (this._bound && this.bot.configService) {
            this.bot.configService.removeAllListeners('configChanged');
        }
        this.subscriptions.clear();
        this._bound = false;
    }
}

module.exports = ConfigSubscriber;
