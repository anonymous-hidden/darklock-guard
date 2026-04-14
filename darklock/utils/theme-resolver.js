/**
 * Theme Resolver — resolves view paths based on active theme config.
 * 
 * Usage:
 *   const { resolveView } = require('./utils/theme-resolver');
 *   res.sendFile(resolveView('login.html'));
 * 
 * To switch themes: edit views/themes/theme-config.json and set "activeTheme"
 * to one of: "theme-1-glass", "theme-2-minimal", "theme-3-neon", or null for default.
 */

const path = require('path');
const fs = require('fs');

const VIEWS_DIR = path.join(__dirname, '..', 'views');
const THEMES_DIR = path.join(VIEWS_DIR, 'themes');
const CONFIG_PATH = path.join(THEMES_DIR, 'theme-config.json');

let _cachedTheme = undefined;
let _cacheTime = 0;
const CACHE_TTL = 5000; // re-read config every 5s max

function getActiveTheme() {
    const now = Date.now();
    if (_cachedTheme !== undefined && now - _cacheTime < CACHE_TTL) {
        return _cachedTheme;
    }
    try {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        const config = JSON.parse(raw);
        _cachedTheme = config.activeTheme || null;
    } catch {
        _cachedTheme = null;
    }
    _cacheTime = now;
    return _cachedTheme;
}

/**
 * Resolve a view filename to the themed path if available, otherwise fallback to default.
 * @param {string} viewName - e.g. 'home.html', 'login.html', 'signup.html', 'dashboard.html'
 * @returns {string} Absolute path to the view file
 */
function resolveView(viewName) {
    const theme = getActiveTheme();
    if (theme) {
        const themed = path.join(THEMES_DIR, theme, viewName);
        if (fs.existsSync(themed)) {
            return themed;
        }
    }
    return path.join(VIEWS_DIR, viewName);
}

module.exports = { resolveView, getActiveTheme };
