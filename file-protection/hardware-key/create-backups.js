#!/usr/bin/env node

const HardwareKeyProtection = require('./index');
const path = require('path');

/**
 * Script to manually create backups without starting protection
 */

const logger = {
    info: (...args) => console.log(`[${new Date().toISOString()}]`, ...args),
    warn: (...args) => console.warn(`[${new Date().toISOString()}]`, ...args),
    error: (...args) => console.error(`[${new Date().toISOString()}]`, ...args)
};

async function createBackups() {
    console.log('💾 Hardware Key Backup Creation Tool\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const protection = new HardwareKeyProtection({
        projectRoot: path.join(__dirname, '..', '..'),
        logger,
        watchPaths: [
            'src/**/*',
            'darklock/**/*',
            'file-protection/**/*',
            'security-suite/**/*',
            'scripts/**/*',
            'ainti-tampering-app/**/*',
            'docs/**/*',
            'website/**/*',
            'html/**/*',
            'data/**/*.json',
            'locale/**/*',
            'config.json',
            'package.json',
            'package-lock.json',
            '.env',
            '.env.example',
            'Dockerfile',
            'docker-compose.yml',
            'render.yaml',
            'startup.sh',
            '*.js',
            '*.cjs',
            '*.mjs',
            '*.sh',
            '*.ps1',
            '*.md',
            '.gitignore',
            '.gitattributes'
        ],
        ignorePaths: [
            '**/node_modules/**',
            '**/logs/**',
            '**/temp/**',
            '**/backups/**',
            '**/.git/**',
            '**/uploads/**',
            '**/downloads/**',
            '**/data/backups/**',
            '**/darklock/downloads/**',
            '**/file-protection/backups/**',
            '**/*.log',
            '**/coverage/**',
            '**/.vscode/**',
            '**/.idea/**',
            '**/dist/**',
            '**/build/**'
        ]
    });
    
    try {
        logger.info('🔍 Scanning project for files to backup...');
        logger.info('');
        
        // Clear old backups
        logger.info('🧹 Clearing old backups...');
        await protection.fileGuard.clearBackups();
        logger.info('');
        
        // Create new backups
        const startTime = Date.now();
        await protection.fileGuard.createAllBackups(false);
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        logger.info('');
        logger.info('✅ Backup creation completed!');
        logger.info(`   Duration: ${duration} seconds`);
        logger.info(`   Location: file-protection/backups/hardware-key/`);
        logger.info('');
        logger.info('💡 These backups will be used to restore files if unauthorized');
        logger.info('   modifications are detected when the hardware key is removed.');
        
    } catch (error) {
        logger.error('❌ Backup creation failed:', error);
        process.exit(1);
    }
}

// Run backup creation
createBackups().then(() => {
    console.log('');
    process.exit(0);
}).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
