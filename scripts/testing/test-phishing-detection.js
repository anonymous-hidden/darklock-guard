#!/usr/bin/env node

/**
 * Test Phishing Detection System
 * 
 * Verifies that phishing domains are loaded and LinkAnalyzer can detect them
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'darklock.db');

console.log('🧪 Testing Phishing Detection System\n');
console.log('=' .repeat(50));

// Test domains from the imported list
const testDomains = [
    'discord-giveaway.com',
    '101nitro.com',
    'freenitro.com',
    'steamcommnunity.com',
    'discord-nitro.com',
    'academy-moderator.com'
];

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ Database connection failed:', err.message);
        process.exit(1);
    }
    console.log('✅ Connected to database\n');
});

// Test 1: Check database has phishing domains
console.log('📋 Test 1: Database Domain Count');
console.log('-'.repeat(50));
db.get('SELECT COUNT(*) as total FROM malicious_links WHERE threat_type = "PHISHING"', (err, row) => {
    if (err) {
        console.error('❌ Query failed:', err.message);
        process.exit(1);
    }
    console.log(`Total phishing domains in database: ${row.total}\n`);
    
    if (row.total === 0) {
        console.error('❌ ERROR: No phishing domains found!');
        console.error('   Run: node import-phishing-domains.js /home/cayden/Downloads/Untitled-1.json\n');
        process.exit(1);
    }
    
    // Test 2: Check specific test domains exist
    console.log('🔍 Test 2: Check Test Domains');
    console.log('-'.repeat(50));
    
    let foundCount = 0;
    let checkedCount = 0;
    
    testDomains.forEach((domain, index) => {
        db.get('SELECT * FROM malicious_links WHERE url = ?', [domain], (err, row) => {
            checkedCount++;
            
            if (err) {
                console.error(`❌ ${domain}: Query error`);
            } else if (row) {
                foundCount++;
                console.log(`✅ ${domain}: Found (severity: ${row.severity})`);
            } else {
                console.log(`❌ ${domain}: NOT FOUND`);
            }
            
            // After checking all domains
            if (checkedCount === testDomains.length) {
                console.log('\n' + '='.repeat(50));
                console.log(`Results: ${foundCount}/${testDomains.length} test domains found\n`);
                
                if (foundCount === testDomains.length) {
                    console.log('✅ All test domains present in database!');
                } else {
                    console.log(`⚠️  Only ${foundCount} domains found. Some may be missing from import.`);
                }
                
                // Test 3: Sample random domains
                console.log('\n📝 Test 3: Random Sample Domains');
                console.log('-'.repeat(50));
                db.all('SELECT url, severity, created_at FROM malicious_links LIMIT 10', (err, rows) => {
                    if (err) {
                        console.error('❌ Sample query failed:', err.message);
                    } else {
                        rows.forEach((row, i) => {
                            console.log(`${i + 1}. ${row.url} (severity: ${row.severity})`);
                        });
                    }
                    
                    console.log('\n' + '='.repeat(50));
                    console.log('🎯 Next Steps:');
                    console.log('   1. Start the bot: npm start');
                    console.log('   2. Look for log: "[LinkAnalyzer] Loaded XXXXX phishing domains"');
                    console.log('   3. Send a test message with: https://discord-giveaway.com');
                    console.log('   4. Bot should delete it and warn the user');
                    console.log('\n✅ Database test complete!\n');
                    
                    db.close();
                });
            }
        });
    });
});
