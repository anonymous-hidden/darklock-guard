const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

const PATHS = {
    baseline: path.join(ROOT_DIR, 'file-protection', 'config', 'baseline.json'),
    backups: path.join(ROOT_DIR, 'file-protection', 'backups'),
    quarantine: path.join(ROOT_DIR, 'file-protection', 'backups', 'quarantine'),
    logs: path.join(ROOT_DIR, 'file-protection', 'logs')
};

const HMAC_KEY_ENV = 'AUDIT_ENCRYPTION_KEY';
const ALERT_WEBHOOK_ENV = 'TAMPER_ALERT_WEBHOOK_URL';
const OWNER_ENV = 'OWNER_ID';
const RESCAN_INTERVAL_MS = 60 * 1000; // 60 seconds

// Tier definitions map to the authoritative architecture requirements
const TIER_SOURCES = {
    critical: [
        { path: path.join(ROOT_DIR, 'src', 'bot.js') },
        { path: path.join(ROOT_DIR, 'src', 'database', 'database.js') },
        { path: path.join(ROOT_DIR, 'src', 'dashboard', 'dashboard.js') },
        { path: path.join(ROOT_DIR, 'config.json') },
        // Protect the protector (all agent files)
        { path: path.join(ROOT_DIR, 'file-protection', 'agent'), recurse: false, extensions: ['.js'] }
    ],
    high: [
        { path: path.join(ROOT_DIR, 'src', 'utils', 'logger.js') },
        { path: path.join(ROOT_DIR, 'src', 'security'), recurse: false, extensions: ['.js'] },
        // src/core/*.js (direct children only)
        { path: path.join(ROOT_DIR, 'src', 'core'), recurse: false, extensions: ['.js'] },
        { path: path.join(ROOT_DIR, 'package.json') },
        { path: path.join(ROOT_DIR, 'package-lock.json') }
    ],
    medium: [
        { path: path.join(ROOT_DIR, 'src', 'commands'), recurse: true, extensions: ['.js'] },
        { path: path.join(ROOT_DIR, 'src', 'events'), recurse: true, extensions: ['.js'] }
    ]
};

module.exports = {
    ROOT_DIR,
    PATHS,
    HMAC_KEY_ENV,
    ALERT_WEBHOOK_ENV,
    OWNER_ENV,
    RESCAN_INTERVAL_MS,
    TIER_SOURCES
};
