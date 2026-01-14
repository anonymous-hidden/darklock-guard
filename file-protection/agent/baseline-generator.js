require('dotenv').config();

const fs = require('fs');
const path = require('path');
const Hasher = require('./hasher');
const FileEnumerator = require('./file-enumerator');
const BaselineManager = require('./baseline-manager');
const Protector = require('./protector');
const { PATHS } = require('./constants');

class BaselineGenerator {
    constructor(logger = console) {
        this.logger = logger;
        this.enumerator = new FileEnumerator(logger);
        this.baselineManager = new BaselineManager(logger);
        this.protector = new Protector(logger);
    }

    generateHashes(files) {
        const hashes = {};

        for (const entry of files) {
            const filePath = path.normalize(entry.path);
            if (!fs.existsSync(filePath)) {
                throw new Error(`Protected file missing during baseline generation: ${filePath}`);
            }
            const hash = Hasher.hashFile(filePath);
            hashes[filePath] = hash;

            // Create a backup for Tier1 and Tier2 to enable restore-on-tamper
            if (entry.tier === 'critical' || entry.tier === 'high') {
                this.protector.createBackup(filePath);
            }
        }

        return hashes;
    }

    run() {
        this.logger.log('\n=================================================');
        this.logger.log('🔒 Anti-Tampering Baseline Generator (HMAC-signed)');
        this.logger.log('=================================================\n');

        const { files } = this.enumerator.buildProtectedMap();
        if (!files.length) {
            throw new Error('No protected files discovered. Check tier configuration.');
        }

        const hashes = this.generateHashes(files);
        const baseline = this.baselineManager.saveBaseline(hashes);

        this.logger.log(`✅ Baseline generated with ${baseline.fileCount} entries`);
        this.logger.log(`   Path: ${PATHS.baseline}`);
        this.logger.log('   Signature: HMAC-SHA256 over sorted hashes');

        return baseline;
    }
}

if (require.main === module) {
    try {
        // Skip baseline generation if AUDIT_ENCRYPTION_KEY is not set (e.g., during npm install)
        if (!process.env.AUDIT_ENCRYPTION_KEY) {
            console.log('⏭️  Skipping baseline generation (AUDIT_ENCRYPTION_KEY not set)');
            console.log('   Baseline will be generated at runtime on first startup.');
            process.exit(0);
        }
        
        const generator = new BaselineGenerator();
        generator.run();
        process.exit(0);
    } catch (err) {
        console.error('❌ Baseline generation failed:', err.message || err);
        process.exit(1);
    }
}

module.exports = BaselineGenerator;
