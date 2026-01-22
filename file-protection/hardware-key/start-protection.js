#!/usr/bin/env node

const HardwareKeyProtection = require('./index');
const path = require('path');

/**
 * Startup script for Hardware Key Protection System
 */

// Configuration
const config = {
    projectRoot: path.join(__dirname, '..', '..'), // Discord bot root directory
    checkInterval: 2000, // Check for hardware key every 2 seconds
    
    // Paths to protect (relative to project root)
    // ALL CORE FILES - Cannot be modified without hardware key
    watchPaths: [
        // Core source files
        'src/**/*',
        
        // Darklock dashboard system
        'darklock/**/*',
        
        // File protection system
        'file-protection/**/*',
        
        // Security suite
        'security-suite/**/*',
        
        // Scripts directory
        'scripts/**/*',
        
        // Anti-tampering app
        'ainti-tampering-app/**/*',
        
        // Documentation (protect from unauthorized changes)
        'docs/**/*',
        
        // Website files
        'website/**/*',
        'html/**/*',
        
        // Data files (ranks, file integrity, etc.)
        'data/**/*.json',
        
        // Locale/language files
        'locale/**/*',
        
        // Configuration files
        'config.json',
        'package.json',
        'package-lock.json',
        '.env',
        '.env.example',
        
        // Docker and deployment
        'Dockerfile',
        'docker-compose.yml',
        'render.yaml',
        'startup.sh',
        
        // All root-level JavaScript files
        '*.js',
        '*.cjs',
        '*.mjs',
        
        // All root-level scripts
        '*.sh',
        '*.ps1',
        
        // Markdown documentation files
        '*.md',
        
        // Git configuration
        '.gitignore',
        '.gitattributes'
    ],
    
    // Paths to ignore (temporary/generated files only)
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
    ],
    
    // Optional: Set a custom identifier for your specific Pico
    // You can find this by running: node list-ports.js
    customIdentifier: null // e.g., 'E6614103E73A2A2D'
};

// Create logger with timestamps
const logger = {
    info: (...args) => console.log(`[${new Date().toISOString()}] [INFO]`, ...args),
    warn: (...args) => console.warn(`[${new Date().toISOString()}] [WARN]`, ...args),
    error: (...args) => console.error(`[${new Date().toISOString()}] [ERROR]`, ...args)
};

// Initialize protection system
const protection = new HardwareKeyProtection({
    ...config,
    logger
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n\nShutting down...');
    await protection.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await protection.stop();
    process.exit(0);
});

// Handle errors
process.on('unhandledRejection', (error) => {
    logger.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    protection.stop().then(() => process.exit(1));
});

// Start the system
(async () => {
    try {
        // Start protection WITHOUT creating backups (faster startup)
        await protection.detector.start();
        await protection.fileGuard.start();
        
        protection.showStatus();
        
        // Keep the process running
        logger.info('');
        logger.info('Press Ctrl+C to stop the protection system');
        logger.info('');
        logger.info('⚡ Fast mode: Started without creating backups');
        logger.info('   To create backups manually, run: npm run create-backups');
        
    } catch (error) {
        logger.error('Failed to start protection system:', error);
        process.exit(1);
    }
})();
