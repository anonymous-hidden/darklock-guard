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
        // ========== BOT CORE ==========
        { path: path.join(ROOT_DIR, 'src', 'bot.js') },
        { path: path.join(ROOT_DIR, 'start-bot.js') },
        { path: path.join(ROOT_DIR, 'setup.js') },
        
        // ========== DATABASE ==========
        { path: path.join(ROOT_DIR, 'src', 'database'), recurse: true, extensions: ['.js'] },
        { path: path.join(ROOT_DIR, 'src', 'db'), recurse: true, extensions: ['.js'] },
        // Note: Do NOT protect .db files as they change during normal operation
        
        // ========== DASHBOARD ==========
        { path: path.join(ROOT_DIR, 'src', 'dashboard'), recurse: true, extensions: ['.js'] },
        
        // ========== CONFIGURATION ==========
        { path: path.join(ROOT_DIR, 'config.json') },
        { path: path.join(ROOT_DIR, 'package.json') },
        { path: path.join(ROOT_DIR, 'package-lock.json') },
        { path: path.join(ROOT_DIR, '.env.example') },
        
        // ========== FILE PROTECTION SYSTEM ==========
        { path: path.join(ROOT_DIR, 'file-protection', 'agent'), recurse: true, extensions: ['.js'] },
        { path: path.join(ROOT_DIR, 'file-protection', 'index.js') },
        // Note: baseline.json excluded - it changes during regeneration
        
        // ========== DARKLOCK PLATFORM CORE ==========
        { path: path.join(ROOT_DIR, 'darklock', 'server.js') },
        { path: path.join(ROOT_DIR, 'darklock', 'start.js') },
        
        // ========== DARKLOCK ADMIN V4 (CONSOLIDATED ADMIN) ==========
        { path: path.join(ROOT_DIR, 'darklock', 'admin-v4'), recurse: true, extensions: ['.js', '.html'] },
        
        // ========== GUARD-V2 SERVICE CORE ==========
        { path: path.join(ROOT_DIR, 'guard-v2', 'crates', 'guard-service', 'src'), recurse: true, extensions: ['.rs'] },
        { path: path.join(ROOT_DIR, 'guard-v2', 'crates', 'guard-service', 'Cargo.toml') },
        { path: path.join(ROOT_DIR, 'guard-v2', 'Cargo.toml') },
        
        // ========== SECURITY SUITE ==========
        { path: path.join(ROOT_DIR, 'security-suite', 'index.js') },
        { path: path.join(ROOT_DIR, 'security-suite', 'modules'), recurse: true, extensions: ['.js'] },
        
        // ========== START/STOP SCRIPTS ==========
        { path: path.join(ROOT_DIR, 'startup.sh') },
        { path: path.join(ROOT_DIR, 'start-all.sh') },
        { path: path.join(ROOT_DIR, 'stop-all.sh') }
    ],
    
    high: [
        // ========== BOT CORE SYSTEMS ==========
        { path: path.join(ROOT_DIR, 'src', 'bot'), recurse: true, extensions: ['.js'] },
        { path: path.join(ROOT_DIR, 'src', 'core'), recurse: true, extensions: ['.js'] },
        { path: path.join(ROOT_DIR, 'src', 'systems'), recurse: true, extensions: ['.js'] },
        { path: path.join(ROOT_DIR, 'src', 'services'), recurse: true, extensions: ['.js'] },
        
        // ========== SECURITY ==========
        { path: path.join(ROOT_DIR, 'src', 'security'), recurse: true, extensions: ['.js'] },
        
        // ========== UTILITIES ==========
        { path: path.join(ROOT_DIR, 'src', 'utils'), recurse: true, extensions: ['.js'] },
        
        // ========== DARKLOCK ROUTES & MIDDLEWARE ==========
        { path: path.join(ROOT_DIR, 'darklock', 'routes'), recurse: true, extensions: ['.js'] },
        { path: path.join(ROOT_DIR, 'darklock', 'utils'), recurse: true, extensions: ['.js'] },
        { path: path.join(ROOT_DIR, 'darklock', 'middleware'), recurse: true, extensions: ['.js'] },
        
        // ========== GUARD-V2 DESKTOP APP ==========
        { path: path.join(ROOT_DIR, 'guard-v2', 'desktop', 'src'), recurse: true, extensions: ['.js', '.ts', '.tsx', '.jsx'] },
        { path: path.join(ROOT_DIR, 'guard-v2', 'desktop', 'src-tauri', 'src'), recurse: true, extensions: ['.rs'] },
        { path: path.join(ROOT_DIR, 'guard-v2', 'desktop', 'package.json') },
        { path: path.join(ROOT_DIR, 'guard-v2', 'desktop', 'src-tauri', 'Cargo.toml') },
        
        // ========== CRITICAL SCRIPTS ==========
        { path: path.join(ROOT_DIR, 'scripts', 'admin'), recurse: true, extensions: ['.js'] },
        { path: path.join(ROOT_DIR, 'scripts', 'database'), recurse: true, extensions: ['.js'] },
        { path: path.join(ROOT_DIR, 'scripts', 'security'), recurse: true, extensions: ['.js'] },
        { path: path.join(ROOT_DIR, 'scripts', 'users'), recurse: true, extensions: ['.js'] },
        { path: path.join(ROOT_DIR, 'scripts', 'deployment'), recurse: true, extensions: ['.js', '.sh'] },
        
        // ========== DATA FILES ==========
        { path: path.join(ROOT_DIR, 'data', 'ranks.json') },
        { path: path.join(ROOT_DIR, 'data', 'file-integrity.json') },
        
        // ========== DEPLOYMENT ==========
        { path: path.join(ROOT_DIR, 'Dockerfile') },
        { path: path.join(ROOT_DIR, 'docker-compose.yml') },
        { path: path.join(ROOT_DIR, 'render.yaml') }
    ],
    
    medium: [
        // ========== COMMANDS & EVENTS ==========
        { path: path.join(ROOT_DIR, 'src', 'commands'), recurse: true, extensions: ['.js'] },
        { path: path.join(ROOT_DIR, 'src', 'events'), recurse: true, extensions: ['.js'] },
        
        // ========== WEB INTERFACE ==========
        { path: path.join(ROOT_DIR, 'src', 'web'), recurse: true, extensions: ['.js', '.html', '.css'] },
        
        // ========== DARKLOCK VIEWS & PUBLIC ==========
        { path: path.join(ROOT_DIR, 'darklock', 'views'), recurse: true, extensions: ['.ejs', '.html'] },
        { path: path.join(ROOT_DIR, 'darklock', 'public'), recurse: true, extensions: ['.js', '.css', '.html'] },
        
        // ========== GUARD-V2 WEBSITE ==========
        { path: path.join(ROOT_DIR, 'guard-v2', 'website'), recurse: true, extensions: ['.html', '.css', '.js'] },
        
        // ========== TESTING SCRIPTS ==========
        { path: path.join(ROOT_DIR, 'scripts', 'testing'), recurse: true, extensions: ['.js'] },
        
        // ========== HARDWARE SCRIPTS ==========
        { path: path.join(ROOT_DIR, 'scripts', 'hardware'), recurse: true, extensions: ['.js', '.sh', '.py'] }
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
