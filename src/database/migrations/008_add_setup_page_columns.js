/**
 * Migration 008: Add Setup Page Columns
 * Adds all columns needed by dashboard setup pages that don't yet exist.
 * Uses ALTER TABLE ADD COLUMN with try/catch to safely skip columns that already exist.
 */

module.exports = {
    description: 'Add missing columns for dashboard setup pages',

    async up(db) {
        const columns = [
            // === XP & Levels ===
            { name: 'xp_per_message', type: 'INTEGER DEFAULT 15' },
            { name: 'xp_multiplier', type: 'REAL DEFAULT 1.0' },
            { name: 'voice_xp_enabled', type: 'BOOLEAN DEFAULT 0' },
            { name: 'voice_xp_per_minute', type: 'INTEGER DEFAULT 5' },
            { name: 'min_voice_time', type: 'INTEGER DEFAULT 60' },
            { name: 'level_announcement', type: 'TEXT DEFAULT \'channel\'' },
            { name: 'level_up_message', type: 'TEXT' },
            { name: 'level_up_channel', type: 'TEXT' },

            // === Timeout System ===
            { name: 'auto_timeout_enabled', type: 'BOOLEAN DEFAULT 0' },
            { name: 'default_timeout_duration', type: 'INTEGER DEFAULT 600' },
            { name: 'max_timeout_duration', type: 'INTEGER DEFAULT 604800' },
            { name: 'spam_timeout_duration', type: 'INTEGER DEFAULT 300' },
            { name: 'toxicity_timeout_duration', type: 'INTEGER DEFAULT 600' },
            { name: 'dm_timeout_notification', type: 'BOOLEAN DEFAULT 1' },

            // === Warning System ===
            { name: 'warning_system_enabled', type: 'BOOLEAN DEFAULT 1' },
            { name: 'warnings_before_timeout', type: 'INTEGER DEFAULT 3' },
            { name: 'warnings_before_kick', type: 'INTEGER DEFAULT 5' },
            { name: 'dm_warning_notification', type: 'BOOLEAN DEFAULT 1' },
            { name: 'warning_expiry_days', type: 'INTEGER DEFAULT 30' },
            { name: 'exempt_staff_automod', type: 'BOOLEAN DEFAULT 1' },

            // === Appeal System ===
            { name: 'appeal_system_enabled', type: 'BOOLEAN DEFAULT 0' },
            { name: 'appeal_review_channel', type: 'TEXT' },
            { name: 'appeal_cooldown_hours', type: 'INTEGER DEFAULT 24' },
            { name: 'appeal_auto_dm', type: 'BOOLEAN DEFAULT 1' },
            { name: 'appeal_url', type: 'TEXT' },
            { name: 'appeal_message_template', type: 'TEXT' },
            { name: 'appeal_require_reason', type: 'BOOLEAN DEFAULT 1' },
            { name: 'appeal_min_length', type: 'INTEGER DEFAULT 20' },

            // === Content Filters ===
            { name: 'caps_percentage', type: 'INTEGER DEFAULT 70' },
            { name: 'emoji_limit', type: 'INTEGER DEFAULT 10' },
            { name: 'mention_limit', type: 'INTEGER DEFAULT 5' },
            { name: 'toxicity_threshold', type: 'REAL DEFAULT 0.8' },
            { name: 'detect_duplicates', type: 'BOOLEAN DEFAULT 1' },
            { name: 'filter_zalgo', type: 'BOOLEAN DEFAULT 1' },

            // === Word Filter ===
            { name: 'word_filter_enabled', type: 'BOOLEAN DEFAULT 0' },
            { name: 'banned_words', type: 'TEXT DEFAULT \'[]\'' },
            { name: 'banned_phrases', type: 'TEXT DEFAULT \'[]\'' },
            { name: 'word_filter_action', type: 'TEXT DEFAULT \'delete\'' },
            { name: 'word_filter_mode', type: 'TEXT DEFAULT \'exact\'' },
            { name: 'filter_display_names', type: 'BOOLEAN DEFAULT 0' },
            { name: 'log_filtered_messages', type: 'BOOLEAN DEFAULT 1' },
            { name: 'word_filter_custom_message', type: 'TEXT' },
            { name: 'word_filter_whitelist_channels', type: 'TEXT DEFAULT \'[]\'' },
            { name: 'word_filter_whitelist_roles', type: 'TEXT DEFAULT \'[]\'' },

            // === Anti-Raid Advanced ===
            { name: 'raid_join_threshold', type: 'INTEGER DEFAULT 10' },
            { name: 'raid_time_window', type: 'INTEGER DEFAULT 10' },
            { name: 'raid_lockdown_duration_ms', type: 'INTEGER DEFAULT 300000' },
            { name: 'raid_action', type: 'TEXT DEFAULT \'kick\'' },
            { name: 'account_age_enabled', type: 'BOOLEAN DEFAULT 0' },
            { name: 'min_account_age', type: 'INTEGER DEFAULT 24' },

            // === Anti-Spam Advanced ===
            { name: 'spam_action', type: 'TEXT DEFAULT \'timeout\'' },
            { name: 'antispam_bypass_channels', type: 'TEXT DEFAULT \'[]\'' },
            { name: 'antispam_flood_mid', type: 'INTEGER DEFAULT 5' },
            { name: 'antispam_flood_high', type: 'INTEGER DEFAULT 10' },
            { name: 'antispam_duplicate_mid', type: 'INTEGER DEFAULT 3' },
            { name: 'antispam_duplicate_high', type: 'INTEGER DEFAULT 5' },
            { name: 'antispam_mention_threshold', type: 'INTEGER DEFAULT 5' },
            { name: 'antispam_emoji_mid', type: 'INTEGER DEFAULT 10' },
            { name: 'antispam_emoji_high', type: 'INTEGER DEFAULT 20' },
            { name: 'antispam_link_threshold', type: 'INTEGER DEFAULT 3' },
            { name: 'antispam_caps_ratio', type: 'REAL DEFAULT 0.7' },
            { name: 'antispam_caps_min_letters', type: 'INTEGER DEFAULT 10' },

            // === Verification ===
            { name: 'verification_type', type: 'TEXT DEFAULT \'button\'' },
            { name: 'verify_timeout', type: 'INTEGER DEFAULT 10' },
            { name: 'dm_verification', type: 'BOOLEAN DEFAULT 0' },
            { name: 'verify_message', type: 'TEXT DEFAULT \'Click the button below to verify.\'' },

            // === Welcome/Goodbye ===
            { name: 'welcome_channel_id', type: 'TEXT' },
            { name: 'welcome_embed_enabled', type: 'BOOLEAN DEFAULT 1' },
            { name: 'welcome_ping_user', type: 'BOOLEAN DEFAULT 0' },
            { name: 'welcome_delete_after', type: 'INTEGER DEFAULT 0' },
            { name: 'goodbye_channel_id', type: 'TEXT' },
            { name: 'goodbye_embed_enabled', type: 'BOOLEAN DEFAULT 1' },
            { name: 'goodbye_delete_after', type: 'INTEGER DEFAULT 0' },

            // === Autorole ===
            { name: 'bot_autorole', type: 'TEXT' },
            { name: 'autorole_delay', type: 'INTEGER DEFAULT 0' },
            { name: 'autoroles', type: 'TEXT DEFAULT \'[]\'' },

            // === Reaction Roles ===
            { name: 'reaction_roles_enabled', type: 'BOOLEAN DEFAULT 0' },
            { name: 'reaction_channel', type: 'TEXT' },
            { name: 'reaction_title', type: 'TEXT DEFAULT \'Role Selection\'' },
            { name: 'reaction_desc', type: 'TEXT' },
            { name: 'reaction_roles', type: 'TEXT DEFAULT \'[]\'' },

            // === Anti-Nuke Advanced ===
            { name: 'antinuke_limit', type: 'INTEGER DEFAULT 3' },
            { name: 'antinuke_window', type: 'INTEGER DEFAULT 10' },
            { name: 'antinuke_punishment', type: 'TEXT DEFAULT \'ban\'' },
            { name: 'antinuke_protections', type: 'TEXT DEFAULT \'{}\'' },
            { name: 'antinuke_whitelist', type: 'TEXT DEFAULT \'[]\'' },

            // === Anti-Phishing ===
            { name: 'antiphishing_enabled', type: 'BOOLEAN DEFAULT 1' },
            { name: 'phishing_action', type: 'TEXT DEFAULT \'delete\'' },
            { name: 'phishing_sensitivity', type: 'TEXT DEFAULT \'medium\'' },
            { name: 'phishing_delete_message', type: 'BOOLEAN DEFAULT 1' },
            { name: 'phishing_log_all', type: 'BOOLEAN DEFAULT 0' },
            { name: 'phishing_dm_user', type: 'BOOLEAN DEFAULT 1' },
            { name: 'phishing_notify_staff', type: 'BOOLEAN DEFAULT 1' },
            { name: 'phishing_escalate', type: 'BOOLEAN DEFAULT 0' },
            { name: 'phishing_ban_threshold', type: 'INTEGER DEFAULT 3' },
            { name: 'phishing_reset_hours', type: 'INTEGER DEFAULT 24' },
            { name: 'phishing_log_channel', type: 'TEXT' },
            { name: 'phishing_whitelist_roles', type: 'TEXT DEFAULT \'[]\'' },
            { name: 'phishing_ignored_channels', type: 'TEXT DEFAULT \'[]\'' }
        ];

        let added = 0;
        let skipped = 0;
        for (const col of columns) {
            try {
                await db.run(`ALTER TABLE guild_configs ADD COLUMN ${col.name} ${col.type}`);
                added++;
            } catch (e) {
                // Column already exists — skip
                skipped++;
            }
        }
        console.log(`    Setup page columns: ${added} added, ${skipped} already existed`);
    }
};
