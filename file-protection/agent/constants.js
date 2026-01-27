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
        { path: path.join(ROOT_DIR, 'file-protection', 'agent'), recurse: false, extensions: ['.js'] },
        { path: path.join(ROOT_DIR, 'file-protection', 'index.js') },
        // Darklock integration files
        { path: path.join(ROOT_DIR, 'darklock', 'server.js') },
        { path: path.join(ROOT_DIR, 'darklock', 'integration.js') },
        { path: path.join(ROOT_DIR, 'darklock', 'start.js') },
        // Darklock database (SQLite) - empty extensions array allows all files
        { path: path.join(ROOT_DIR, 'darklock', 'data', 'darklock.db'), extensions: [] },
        // Anti-tampering app core files
        { path: path.join(ROOT_DIR, 'ainti-tampering-app', 'tauri-app', 'src', 'main.js') },
        { path: path.join(ROOT_DIR, 'ainti-tampering-app', 'tauri-app', 'package.json') },
        { path: path.join(ROOT_DIR, 'ainti-tampering-app', 'tauri-app', 'vite.config.js') },
        // Security suite
        { path: path.join(ROOT_DIR, 'security-suite', 'index.js') },
        { path: path.join(ROOT_DIR, 'security-suite', 'modules'), recurse: false, extensions: ['.js'] },
        // Setup scripts
        { path: path.join(ROOT_DIR, 'setup.js') },
        { path: path.join(ROOT_DIR, 'startup.sh') }
    ],
    high: [
        { path: path.join(ROOT_DIR, 'src', 'utils', 'logger.js') },
        { path: path.join(ROOT_DIR, 'src', 'security'), recurse: false, extensions: ['.js'] },
        // src/core/*.js (direct children only)
        { path: path.join(ROOT_DIR, 'src', 'core'), recurse: false, extensions: ['.js'] },
        { path: path.join(ROOT_DIR, 'package.json') },
        { path: path.join(ROOT_DIR, 'package-lock.json') },
        // Deployment and environment files
        { path: path.join(ROOT_DIR, 'Dockerfile') },
        { path: path.join(ROOT_DIR, 'render.yaml') },
        { path: path.join(ROOT_DIR, '.env.example') },
        // Important data files
        { path: path.join(ROOT_DIR, 'data', 'ranks.json') },
        { path: path.join(ROOT_DIR, 'data', 'file-integrity.json') },
        // Darklock routes and utilities
        { path: path.join(ROOT_DIR, 'darklock', 'routes'), recurse: false, extensions: ['.js'] },
        { path: path.join(ROOT_DIR, 'darklock', 'utils'), recurse: false, extensions: ['.js'] },
        // Anti-tampering app library and components
        { path: path.join(ROOT_DIR, 'ainti-tampering-app', 'tauri-app', 'src', 'lib'), recurse: false, extensions: ['.js'] },
        { path: path.join(ROOT_DIR, 'ainti-tampering-app', 'tauri-app', 'src', 'components'), recurse: false, extensions: ['.js'] },
        // Secure app components (Python core)
        { path: path.join(ROOT_DIR, 'ainti-tampering-app', 'secure', 'app', 'main.py') },
        { path: path.join(ROOT_DIR, 'ainti-tampering-app', 'secure', 'app', 'service.py') },
        { path: path.join(ROOT_DIR, 'ainti-tampering-app', 'secure', 'app', 'core'), recurse: false, extensions: ['.py'] },
        { path: path.join(ROOT_DIR, 'ainti-tampering-app', 'secure', 'app', 'config'), recurse: false, extensions: ['.json', '.yaml'] },
        { path: path.join(ROOT_DIR, 'ainti-tampering-app', 'secure', 'app', 'requirements.txt') }
    ],
    medium: [
        { path: path.join(ROOT_DIR, 'src', 'commands'), recurse: true, extensions: ['.js'] },
        { path: path.join(ROOT_DIR, 'src', 'events'), recurse: true, extensions: ['.js'] },
        // Darklock views and public files
        { path: path.join(ROOT_DIR, 'darklock', 'views'), recurse: true, extensions: ['.ejs', '.html'] },
        // Anti-tampering app styles
        { path: path.join(ROOT_DIR, 'ainti-tampering-app', 'tauri-app', 'src', 'styles'), recurse: false, extensions: ['.css'] },
        { path: path.join(ROOT_DIR, 'ainti-tampering-app', 'tauri-app', 'index.html') },
        { path: path.join(ROOT_DIR, 'ainti-tampering-app', 'tauri-app', 'login.html') }
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
