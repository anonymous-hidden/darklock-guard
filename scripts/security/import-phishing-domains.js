#!/usr/bin/env node

/**
 * Import Phishing Domains to Database
 * 
 * Imports a list of phishing domains from a JSON file into the malicious_links table
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Database path
const DB_PATH = path.join(__dirname, 'data', 'darklock.db');

// Check if phishing domains file is provided
const domainsFile = process.argv[2];
if (!domainsFile) {
    console.error('❌ Error: Please provide path to phishing domains JSON file');
    console.error('Usage: node import-phishing-domains.js <path-to-domains.json>');
    process.exit(1);
}

// Check if file exists
if (!fs.existsSync(domainsFile)) {
    console.error(`❌ Error: File not found: ${domainsFile}`);
    process.exit(1);
}

console.log('🔒 Phishing Domains Import Tool');
console.log('================================\n');
console.log(`📂 Domains file: ${domainsFile}`);
console.log(`💾 Database: ${DB_PATH}\n`);

// Read and parse the domains file
let domainsData;
try {
    const fileContent = fs.readFileSync(domainsFile, 'utf8');
    domainsData = JSON.parse(fileContent);
    
    if (!domainsData.domains || !Array.isArray(domainsData.domains)) {
        console.error('❌ Error: Invalid JSON format. Expected { "domains": [...] }');
        process.exit(1);
    }
    
    console.log(`✅ Loaded ${domainsData.domains.length} domains from file\n`);
} catch (error) {
    console.error(`❌ Error reading/parsing file: ${error.message}`);
    process.exit(1);
}

// Connect to database
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error(`❌ Database connection failed: ${err.message}`);
        process.exit(1);
    }
    console.log('✅ Connected to database\n');
});

// Create malicious_links table if it doesn't exist
db.run(`
    CREATE TABLE IF NOT EXISTS malicious_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT UNIQUE,
        threat_type TEXT,
        severity INTEGER,
        source TEXT,
        verified BOOLEAN DEFAULT 0,
        whitelisted BOOLEAN DEFAULT 0,
        last_checked DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) {
        console.error(`❌ Failed to create table: ${err.message}`);
        db.close();
        process.exit(1);
    }
    console.log('✅ Table verified/created\n');
    importDomains();
});

function importDomains() {
    console.log('📥 Starting import...\n');
    
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO malicious_links 
        (url, threat_type, severity, source, verified, whitelisted)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    
    const domains = domainsData.domains;
    const batchSize = 1000;
    let processed = 0;
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        for (const domain of domains) {
            if (!domain || typeof domain !== 'string') {
                errors++;
                continue;
            }
            
            try {
                stmt.run(
                    domain,
                    'PHISHING',
                    9, // High severity (scale 1-10)
                    'imported_list',
                    1, // Verified = true (from trusted source)
                    0  // Whitelisted = false
                );
                imported++;
                processed++;
                
                // Show progress every 1000 domains
                if (processed % batchSize === 0) {
                    console.log(`   Progress: ${processed}/${domains.length} domains (${Math.round(processed/domains.length*100)}%)`);
                }
            } catch (error) {
                if (error.code === 'SQLITE_CONSTRAINT') {
                    skipped++; // Domain already exists
                } else {
                    errors++;
                    console.error(`   ⚠️  Error with domain '${domain}': ${error.message}`);
                }
            }
        }
        
        stmt.finalize();
        
        db.run('COMMIT', (err) => {
            if (err) {
                console.error(`\n❌ Transaction failed: ${err.message}`);
                db.close();
                process.exit(1);
            }
            
            console.log('\n================================');
            console.log('✅ Import Complete!\n');
            console.log(`📊 Statistics:`);
            console.log(`   • Total domains: ${domains.length}`);
            console.log(`   • Imported: ${imported}`);
            console.log(`   • Skipped (duplicates): ${skipped}`);
            console.log(`   • Errors: ${errors}\n`);
            
            // Show some sample entries
            db.all(`
                SELECT url, threat_type, severity, source 
                FROM malicious_links 
                WHERE source = 'imported_list'
                LIMIT 5
            `, (err, rows) => {
                if (!err && rows.length > 0) {
                    console.log('📋 Sample entries:');
                    rows.forEach((row, i) => {
                        console.log(`   ${i + 1}. ${row.url} (${row.threat_type}, severity: ${row.severity})`);
                    });
                    console.log('');
                }
                
                // Show total count in database
                db.get('SELECT COUNT(*) as total FROM malicious_links', (err, row) => {
                    if (!err) {
                        console.log(`💾 Total domains in database: ${row.total}\n`);
                    }
                    
                    db.close((err) => {
                        if (err) {
                            console.error(`⚠️  Error closing database: ${err.message}`);
                        }
                        console.log('✅ Done!');
                        process.exit(0);
                    });
                });
            });
        });
    });
}
