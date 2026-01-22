/**
 * Database Migration Script
 * Adds new columns to the tickets table for escalation and enhanced features
 */

const Database = require('better-sqlite3');
const path = require('path');

async function migrate() {
    try {
        const dbPath = path.join(__dirname, '../../data/bot.db');
        const db = new Database(dbPath);

        console.log('Starting database migration for ticket escalation features...');

        // Add new columns (if they don't exist)
        const columnsToAdd = [
            { name: 'assigned_to_name', type: 'TEXT', default: null },
            { name: 'escalated', type: 'INTEGER', default: '0' },
            { name: 'escalated_at', type: 'DATETIME', default: null },
            { name: 'escalated_by', type: 'TEXT', default: null },
            { name: 'dm_notify', type: 'INTEGER', default: '1' },
            { name: 'first_response_at', type: 'DATETIME', default: null },
            { name: 'user_tag', type: 'TEXT', default: null },
            { name: 'user_avatar', type: 'TEXT', default: null },
            { name: 'category', type: 'TEXT', default: null }
        ];

        for (const column of columnsToAdd) {
            try {
                const defaultClause = column.default !== null ? `DEFAULT ${column.default}` : '';
                const sql = `ALTER TABLE tickets ADD COLUMN ${column.name} ${column.type} ${defaultClause}`;
                db.prepare(sql).run();
                console.log(`✓ Added column: ${column.name}`);
            } catch (error) {
                if (error.message.includes('duplicate column')) {
                    console.log(`  Column ${column.name} already exists, skipping`);
                } else {
                    console.error(`✗ Error adding column ${column.name}:`, error.message);
                }
            }
        }

        // Create ticket_notes table if it doesn't exist
        try {
            db.prepare(`
                CREATE TABLE IF NOT EXISTS ticket_notes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticket_id TEXT NOT NULL,
                    staff_id TEXT NOT NULL,
                    staff_name TEXT NOT NULL,
                    note TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `).run();
            console.log('✓ Created ticket_notes table');
        } catch (error) {
            console.log('  ticket_notes table already exists');
        }

        // Create ticket_history table if it doesn't exist
        try {
            db.prepare(`
                CREATE TABLE IF NOT EXISTS ticket_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticket_id TEXT NOT NULL,
                    user TEXT NOT NULL,
                    action TEXT NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `).run();
            console.log('✓ Created ticket_history table');
        } catch (error) {
            console.log('  ticket_history table already exists');
        }

        db.close();
        console.log('\nMigration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

// Run migration
migrate();
