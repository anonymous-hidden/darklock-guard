/**
 * Migration 006: Create Unified Events Table
 * 
 * ARCHITECTURE DECISION:
 * This creates the canonical event logging table that consolidates:
 * - bot_logs (command logging)
 * - dashboard_audit (dashboard changes)
 * - audit_logs (guild changes)
 * - security_logs (security events)
 * 
 * All new logging goes here. Old tables are preserved for backward
 * compatibility but new code should use the EventLog class.
 */

module.exports = {
    description: 'Create unified events table for consolidated logging',

    async up(db) {
        // Create the unified events table
        await db.run(`
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                
                -- Event classification
                event_type TEXT NOT NULL,
                category TEXT NOT NULL,
                severity TEXT DEFAULT 'info',
                
                -- Context identifiers
                guild_id TEXT,
                user_id TEXT,
                user_tag TEXT,
                executor_id TEXT,
                executor_tag TEXT,
                target_type TEXT,
                target_id TEXT,
                target_name TEXT,
                channel_id TEXT,
                
                -- Event details
                command TEXT,
                action TEXT,
                reason TEXT,
                before_state TEXT,
                after_state TEXT,
                metadata TEXT,
                
                -- Request context (encrypted/hashed)
                ip_hash TEXT,
                user_agent TEXT,
                device_fingerprint TEXT,
                
                -- Outcome
                success INTEGER DEFAULT 1,
                duration_ms INTEGER,
                error TEXT,
                
                -- Replay support
                can_replay INTEGER DEFAULT 0,
                
                -- Timestamps
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('    ✅ Created events table');

        // Create indexes for common query patterns
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_events_guild ON events(guild_id)',
            'CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_events_executor ON events(executor_id)',
            'CREATE INDEX IF NOT EXISTS idx_events_category ON events(category)',
            'CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)',
            'CREATE INDEX IF NOT EXISTS idx_events_severity ON events(severity)',
            'CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at)',
            'CREATE INDEX IF NOT EXISTS idx_events_guild_category ON events(guild_id, category)',
            'CREATE INDEX IF NOT EXISTS idx_events_guild_created ON events(guild_id, created_at)'
        ];

        for (const index of indexes) {
            try {
                await db.run(index);
            } catch (e) {
                // Index may already exist
            }
        }
        console.log('    ✅ Created events indexes');

        // Create a view for backward compatibility with bot_logs queries
        try {
            await db.run(`
                CREATE VIEW IF NOT EXISTS v_bot_logs AS
                SELECT 
                    id,
                    event_type as type,
                    user_id,
                    user_tag,
                    guild_id,
                    channel_id,
                    command,
                    NULL as endpoint,
                    metadata as payload,
                    success,
                    duration_ms,
                    error,
                    created_at
                FROM events
                WHERE category IN ('command', 'system')
            `);
            console.log('    ✅ Created v_bot_logs view for backward compatibility');
        } catch (e) {
            // View may already exist
        }

        // Create a view for backward compatibility with dashboard_audit queries
        try {
            await db.run(`
                CREATE VIEW IF NOT EXISTS v_dashboard_audit AS
                SELECT 
                    id,
                    executor_id as admin_id,
                    executor_tag as admin_tag,
                    guild_id,
                    event_type,
                    before_state as before_data,
                    after_state as after_data,
                    ip_hash as ip,
                    user_agent,
                    created_at
                FROM events
                WHERE category = 'dashboard'
            `);
            console.log('    ✅ Created v_dashboard_audit view for backward compatibility');
        } catch (e) {
            // View may already exist
        }

        // Create a view for backward compatibility with audit_logs queries
        try {
            await db.run(`
                CREATE VIEW IF NOT EXISTS v_audit_logs AS
                SELECT 
                    id,
                    guild_id,
                    event_type,
                    category as event_category,
                    executor_id,
                    executor_tag,
                    target_type,
                    target_id,
                    target_name,
                    metadata as changes,
                    reason,
                    before_state,
                    after_state,
                    can_replay,
                    device_fingerprint,
                    ip_hash,
                    created_at
                FROM events
                WHERE category IN ('guild_change', 'moderation', 'security')
            `);
            console.log('    ✅ Created v_audit_logs view for backward compatibility');
        } catch (e) {
            // View may already exist
        }
    }
};
