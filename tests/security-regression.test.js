/**
 * Security Regression Tests
 * 
 * Verifies all security patches from the comprehensive security audit.
 * Run: npx jest tests/security-regression.test.js --verbose
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ============================================================
// Unit tests that don't require a running server
// ============================================================

describe('Security Patch Verification', () => {

    // ----------------------------------------------------------
    // CRITICAL 3+4: SQL Injection Prevention
    // ----------------------------------------------------------
    describe('SQL Injection Guards', () => {
        test('CRITICAL 3: pro_codes duration_days is parameterized (not template literal)', () => {
            const dashboard = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'dashboard', 'dashboard.js'), 'utf8'
            );
            // Should NOT contain raw template-literal interpolation of duration_days in SQL
            const dangerousPatterns = [
                /\+\$\{row\.duration_days\}\s*days/,
                /\+\$\{codeRecord\.duration_days\}\s*days/
            ];
            for (const pat of dangerousPatterns) {
                expect(dashboard).not.toMatch(pat);
            }
            // Should contain the parameterized version
            expect(dashboard).toContain("CAST(? AS INTEGER)");
        });

        test('CRITICAL 4: createOrUpdateUserRecord has column allowlist', () => {
            const db = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'database', 'database.js'), 'utf8'
            );
            expect(db).toContain('ALLOWED_COLUMNS');
            expect(db).toMatch(/new Set\(\[/); // Set literal with allowed column names
        });

        test('getActionStats days parameter is parameterized', () => {
            const db = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'database', 'database.js'), 'utf8'
            );
            // Should use CAST(? AS INTEGER) not template literal for days
            const getActionStats = db.substring(db.indexOf('getActionStats'));
            expect(getActionStats).toContain('CAST(? AS INTEGER)');
        });
    });

    // ----------------------------------------------------------
    // CRITICAL 1+2: Auth & Guild Access Guards
    // ----------------------------------------------------------
    describe('Authentication & Authorization', () => {
        test('CRITICAL 1: /api/logs/:guildId requires authentication', () => {
            const dashboard = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'dashboard', 'dashboard.js'), 'utf8'
            );
            // The logs route should have authenticateToken middleware
            const logsSection = dashboard.substring(
                dashboard.indexOf("'/api/logs/:guildId'") - 100,
                dashboard.indexOf("'/api/logs/:guildId'") + 200
            );
            expect(logsSection).toContain('authenticateToken');
        });

        test('CRITICAL 2: Guild guard middleware module exists and exports correctly', () => {
            const { requireGuildAccess, isValidSnowflake, BoundedMap } = require(
                path.join(__dirname, '..', 'src', 'dashboard', 'middleware', 'guildGuard.js')
            );
            expect(typeof requireGuildAccess).toBe('function');
            expect(typeof isValidSnowflake).toBe('function');
            expect(typeof BoundedMap).toBe('function');
        });

        test('isValidSnowflake rejects bad inputs', () => {
            const { isValidSnowflake } = require(
                path.join(__dirname, '..', 'src', 'dashboard', 'middleware', 'guildGuard.js')
            );
            expect(isValidSnowflake('123456789012345678')).toBe(true);
            expect(isValidSnowflake('12345678901234567890')).toBe(true); // 20 digits
            expect(isValidSnowflake('')).toBe(false);
            expect(isValidSnowflake('abc')).toBe(false);
            expect(isValidSnowflake('1234')).toBe(false); // too short
            expect(isValidSnowflake('123456789012345678; DROP TABLE users')).toBe(false);
            expect(isValidSnowflake(null)).toBe(false);
            expect(isValidSnowflake(undefined)).toBe(false);
            expect(isValidSnowflake(12345)).toBe(false); // number, not string
        });

        test('HIGH 6: Auth skip list does not include broad /admin/ prefix', () => {
            const dashboard = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'dashboard', 'dashboard.js'), 'utf8'
            );
            const authSection = dashboard.substring(
                dashboard.indexOf('authenticateToken'),
                dashboard.indexOf('authenticateToken') + 3000
            );
            // Should NOT have broad /admin/ or /rfid/ prefix skips
            expect(authSection).not.toMatch(/startsWith\(['"]\/admin/);
            expect(authSection).not.toMatch(/startsWith\(['"]\/rfid\/['"]\)/);
        });

        test('HIGH 7: Login response does not include JWT token in body', () => {
            const dashboard = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'dashboard', 'dashboard.js'), 'utf8'
            );
            // Find handleLogin success response area. The token should NOT appear in res.json body
            // The old pattern was: res.json({ success: true, token, user: ... })
            // It should now be: res.json({ success: true, user: ... }) without token
            const loginArea = dashboard.substring(
                dashboard.indexOf('handleLogin'),
                dashboard.indexOf('handleLogin') + 5000
            );
            // Should not match patterns like: { success: true, token,  or  token: token,
            // But it's hard to be 100% with regex. Check there's no ", token," pattern
            expect(loginArea).not.toMatch(/res\.json\(\{[^}]*\btoken\b[^}]*\}\)/s);
        });

        test('MEDIUM 13: Setup pages require authentication', () => {
            const dashboard = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'dashboard', 'dashboard.js'), 'utf8'
            );
            const setupPages = ['/setup/security', '/setup/tickets', '/setup/features',
                '/setup/ai', '/setup/welcome', '/setup/anti-raid', '/setup/anti-spam'];
            for (const page of setupPages) {
                // Find the line containing the route registration
                const line = dashboard.split('\n').find(l => l.includes(`'${page}'`));
                expect(line).toBeTruthy();
                // authenticateToken must be on the same line (middleware arg)
                expect(line).toContain('authenticateToken');
            }
        });
    });

    // ----------------------------------------------------------
    // MEDIUM 12: CSRF Validation
    // ----------------------------------------------------------
    describe('CSRF Protection', () => {
        test('CSRF validation middleware exists in dashboard.js', () => {
            const dashboard = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'dashboard', 'dashboard.js'), 'utf8'
            );
            expect(dashboard).toContain('x-csrf-token');
            expect(dashboard).toContain('CSRF token invalid or missing');
        });
    });

    // ----------------------------------------------------------
    // MEDIUM 14: Bounded Caches
    // ----------------------------------------------------------
    describe('Bounded Caches', () => {
        test('BoundedMap enforces size limit', () => {
            const { BoundedMap } = require(
                path.join(__dirname, '..', 'src', 'dashboard', 'middleware', 'guildGuard.js')
            );
            const map = new BoundedMap(3, 0);
            map.set('a', 1);
            map.set('b', 2);
            map.set('c', 3);
            map.set('d', 4); // should evict 'a'
            expect(map.size).toBe(3);
            expect(map.get('a')).toBeUndefined();
            expect(map.get('d')).toBe(4);
        });

        test('BoundedMap enforces TTL', async () => {
            const { BoundedMap } = require(
                path.join(__dirname, '..', 'src', 'dashboard', 'middleware', 'guildGuard.js')
            );
            const map = new BoundedMap(100, 50); // 50ms TTL
            map.set('key', 'value');
            expect(map.get('key')).toBe('value');
            await new Promise(r => setTimeout(r, 60));
            expect(map.get('key')).toBeUndefined();
        });

        test('Dashboard uses BoundedMap for rateLimitMap', () => {
            const dashboard = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'dashboard', 'dashboard.js'), 'utf8'
            );
            expect(dashboard).toMatch(/rateLimitMap\s*=\s*new BoundedMap/);
        });

        test('Dashboard uses BoundedMap for discordTokenCache', () => {
            const dashboard = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'dashboard', 'dashboard.js'), 'utf8'
            );
            expect(dashboard).toMatch(/discordTokenCache\s*=\s*new BoundedMap/);
        });
    });

    // ----------------------------------------------------------
    // HIGH 11: Database Hardening
    // ----------------------------------------------------------
    describe('Database Hardening', () => {
        test('WAL mode PRAGMA is set on init', () => {
            const db = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'database', 'database.js'), 'utf8'
            );
            expect(db).toContain("PRAGMA journal_mode=WAL");
            expect(db).toContain("PRAGMA busy_timeout=5000");
            expect(db).toContain("PRAGMA foreign_keys=ON");
        });

        test('MEDIUM 18: Coin transfers use transactions', () => {
            const db = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'database', 'database.js'), 'utf8'
            );
            const transferSection = db.substring(db.indexOf('transferCoins'));
            expect(transferSection).toContain('BEGIN IMMEDIATE');
        });

        test('lockdown_snapshots table exists in schema', () => {
            const db = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'database', 'database.js'), 'utf8'
            );
            expect(db).toContain('lockdown_snapshots');
        });
    });

    // ----------------------------------------------------------
    // CRITICAL 5: AntiRaid Permission Snapshot
    // ----------------------------------------------------------
    describe('AntiRaid Permission Snapshot', () => {
        test('AntiRaid constructor initializes permissionSnapshots', () => {
            const antiraid = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'security', 'antiraid.js'), 'utf8'
            );
            expect(antiraid).toContain('this.permissionSnapshots');
        });

        test('Lockdown snapshots permissions before modifying', () => {
            const antiraid = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'security', 'antiraid.js'), 'utf8'
            );
            // Should contain snapshot logic in applyTemporaryRestrictions
            expect(antiraid).toContain('permissionSnapshots');
            expect(antiraid).toContain('snapshot');
        });

        test('Unlock restores from snapshot (not destructive delete)', () => {
            const antiraid = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'security', 'antiraid.js'), 'utf8'
            );
            const removeLockdown = antiraid.substring(antiraid.indexOf('removeLockdown'));
            // Should use permissionOverwrites.set (restore) not permissionOverwrites.delete
            expect(removeLockdown).toContain('permissionOverwrites');
            // Should reference snapshot
            expect(removeLockdown).toContain('snapshot');
        });
    });

    // ----------------------------------------------------------
    // HIGH 8: Platform Metrics Auth
    // ----------------------------------------------------------
    describe('Platform Security', () => {
        test('Metrics endpoint requires auth', () => {
            const platform = fs.readFileSync(
                path.join(__dirname, '..', 'darklock', 'routes', 'platform', 'index.js'), 'utf8'
            );
            const metricsLines = platform.split('\n').filter(l => l.includes('/api/metrics'));
            const routeLine = metricsLines.find(l => l.includes('router.get'));
            expect(routeLine).toBeTruthy();
            expect(routeLine).toContain('requireAuth');
        });
    });

    // ----------------------------------------------------------
    // MEDIUM 15: Password Hardening
    // ----------------------------------------------------------
    describe('Password Security', () => {
        test('No plaintext password comparison (uses timingSafeEqual)', () => {
            const dashboard = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'dashboard', 'dashboard.js'), 'utf8'
            );
            expect(dashboard).toContain('timingSafeEqual');
        });
    });

    // ----------------------------------------------------------
    // MEDIUM 19: Level Formula Consistency
    // ----------------------------------------------------------
    describe('Level Formula', () => {
        test('Canonical module exists and round-trips correctly', () => {
            const { calculateLevel, xpForLevel, progressPercent } = require(
                path.join(__dirname, '..', 'src', 'utils', 'levelFormula.js')
            );
            // Level 0 at 0 XP
            expect(calculateLevel(0)).toBe(0);
            // Level 1 at 100 XP
            expect(calculateLevel(100)).toBe(1);
            // Round-trip for levels 0-50
            for (let level = 0; level <= 50; level++) {
                const xp = xpForLevel(level);
                expect(calculateLevel(xp)).toBe(level);
            }
            // Progress
            expect(progressPercent(0)).toBe(0);
            expect(progressPercent(xpForLevel(5))).toBe(0); // exactly at level 5
        });

        test('RankCardGenerator uses canonical formula', () => {
            const rcg = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'utils', 'RankCardGenerator.js'), 'utf8'
            );
            expect(rcg).toContain('levelFormula');
        });

        test('systems/rankSystem uses canonical formula', () => {
            const rs = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'systems', 'rankSystem.js'), 'utf8'
            );
            expect(rs).toContain('levelFormula');
        });
    });

    // ----------------------------------------------------------
    // MEDIUM 20: JWT Secret Generation
    // ----------------------------------------------------------
    describe('JWT Secret Generation', () => {
        test('setup.js uses crypto.randomBytes, not Math.random', () => {
            const setup = fs.readFileSync(
                path.join(__dirname, '..', 'setup.js'), 'utf8'
            );
            // Extract just the function body (between { and } after generateRandomString)
            const fnStart = setup.indexOf('generateRandomString(length)');
            const bodyStart = setup.indexOf('{', fnStart);
            const bodyEnd = setup.indexOf('\n    }', bodyStart);
            const fnBody = setup.substring(bodyStart, bodyEnd);
            expect(fnBody).toContain('crypto.randomBytes');
            // Ensure Math.random is not in the function body (comments above are OK)
            expect(fnBody).not.toContain('Math.random');
        });
    });

    // ----------------------------------------------------------
    // LOW 24: RankSystem writeFileSync
    // ----------------------------------------------------------
    describe('File I/O', () => {
        test('RankSystem does not use writeFileSync', () => {
            const rs = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'utils', 'RankSystem.js'), 'utf8'
            );
            expect(rs).not.toContain('writeFileSync');
        });
    });

    // ----------------------------------------------------------
    // LOW 25: Leaderboard Hardening
    // ----------------------------------------------------------
    describe('Leaderboard Security', () => {
        test('server.js has restricted CORS (not open cors())', () => {
            const server = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'web', 'server.js'), 'utf8'
            );
            // Should not have wide-open cors()
            expect(server).not.toMatch(/app\.use\(cors\(\)\)/);
            // Should have origin-restricted cors
            expect(server).toContain('allowedOrigins');
        });

        test('server.js has rate limiting', () => {
            const server = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'web', 'server.js'), 'utf8'
            );
            expect(server).toContain('429');
            expect(server).toContain('Too many requests');
        });

        test('server.js validates guildId as snowflake', () => {
            const server = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'web', 'server.js'), 'utf8'
            );
            expect(server).toMatch(/\\d\{17,20\}/);
        });
    });

    // ----------------------------------------------------------
    // Security Self-Test Endpoint
    // ----------------------------------------------------------
    describe('Self-Test Endpoint', () => {
        test('/security/self-test route exists in dashboard.js', () => {
            const dashboard = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'dashboard', 'dashboard.js'), 'utf8'
            );
            expect(dashboard).toContain('/security/self-test');
        });
    });
});
