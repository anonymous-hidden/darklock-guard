#!/usr/bin/env node
/**
 * Generate Premium License Codes
 * Usage: node generate-license.js <tier> [expiresInDays]
 * 
 * Examples:
 *   node generate-license.js pro
 *   node generate-license.js enterprise 365
 */

require('dotenv').config();

const db = require('./darklock/utils/database');
const premiumManager = require('./darklock/utils/premium');

async function main() {
    const args = process.argv.slice(2);
    const tier = args[0] || 'pro';
    const expiresInDays = args[1] ? parseInt(args[1]) : null;

    if (!['pro', 'enterprise'].includes(tier)) {
        console.error('❌ Invalid tier. Use "pro" or "enterprise"');
        process.exit(1);
    }

    try {
        // Initialize database
        await db.initialize();

        // Generate license code
        const options = {};
        if (expiresInDays) {
            options.expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
        }

        const result = await premiumManager.createLicenseCode(tier, {
            ...options,
            createdBy: 'CLI'
        });

        console.log('\n✅ License Code Generated Successfully!\n');
        console.log('═══════════════════════════════════════');
        console.log(`  Tier:    ${tier.toUpperCase()}`);
        console.log(`  Code:    ${result.code}`);
        if (expiresInDays) {
            console.log(`  Expires: ${new Date(options.expiresAt).toLocaleDateString()}`);
        } else {
            console.log(`  Expires: Never (Lifetime)`);
        }
        console.log('═══════════════════════════════════════\n');

        // Close database
        await db.close();

    } catch (err) {
        console.error('❌ Error generating license code:', err);
        process.exit(1);
    }
}

main();
