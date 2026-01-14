/**
 * Darklock Platform - "Secure or Not?" Learning Game
 * 
 * A client-side educational game teaching security concepts.
 * No backend calls, no cookies, no analytics, no tracking.
 * Progress and scores stored in localStorage only.
 * 
 * @version 3.0.0 - Enhanced difficulty with realistic edge cases
 */

(function() {
    'use strict';

    // ========================================================================
    // GAME CONFIGURATION
    // ========================================================================
    
    const CONFIG = {
        ROUNDS_PER_GAME: 5,
        POINTS: {
            easy: 10,
            medium: 15,
            hard: 25
        },
        MULTIPLIER_LABELS: {
            easy: '×1',
            medium: '×1.5',
            hard: '×2.5'
        },
        FEEDBACK_DELAY_MS: 2500,
        STORAGE_KEY: 'darklock_security_game_v3'
    };

    // ========================================================================
    // SCENARIO POOLS BY DIFFICULTY
    // ========================================================================
    
    /**
     * EASY SCENARIOS: Clear-cut security failures
     * - Obvious weak passwords, missing 2FA, no rate limiting
     * - Single clear correct answer
     * - Purpose: onboarding, confidence building
     */
    const EASY_SCENARIOS = [
        {
            config: {
                password: { label: 'Password', value: 'Weak', class: 'value-weak' },
                twoFactor: { label: '2FA', value: 'Disabled', class: 'value-disabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Disabled', class: 'value-disabled' }
            },
            isSecure: false,
            explanation: 'A weak password with no 2FA or rate limiting allows trivial credential guessing and brute-force attacks.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' }
            },
            isSecure: true,
            explanation: 'Strong password combined with TOTP-based 2FA and rate limiting provides robust multi-layered protection.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Weak', class: 'value-weak' },
                twoFactor: { label: '2FA', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' }
            },
            isSecure: false,
            explanation: 'A weak password undermines 2FA. Social engineering and phishing can capture both the password and TOTP code simultaneously.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA', value: 'Disabled', class: 'value-disabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Disabled', class: 'value-disabled' }
            },
            isSecure: false,
            explanation: 'Single-factor authentication is insufficient. Credential leaks or phishing bypass password strength entirely.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Moderate', class: 'value-warning' },
                twoFactor: { label: '2FA', value: 'Disabled', class: 'value-disabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' }
            },
            isSecure: false,
            explanation: 'Moderate passwords can be cracked with sustained effort. Rate limiting slows but does not prevent eventual compromise.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                sessions: { label: 'Sessions', value: '2 (known devices)', class: 'value-strong' }
            },
            isSecure: true,
            explanation: 'All primary security controls enabled with sessions limited to recognized devices. This is a secure configuration.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Weak', class: 'value-weak' },
                twoFactor: { label: '2FA', value: 'Disabled', class: 'value-disabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' }
            },
            isSecure: false,
            explanation: 'Rate limiting alone cannot compensate for a weak password and missing 2FA. Patient attackers will succeed.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Disabled', class: 'value-disabled' }
            },
            isSecure: false,
            explanation: 'Without rate limiting, attackers can attempt unlimited TOTP code combinations. The 6-digit code space is brute-forceable.'
        }
    ];

    /**
     * MEDIUM SCENARIOS: Mixed signals requiring analysis
     * - Strong in some areas, weak in others
     * - At least one misleading "secure-looking" setting
     * - ~30% are "almost secure but not quite"
     */
    const MEDIUM_SCENARIOS = [
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA', value: 'SMS', class: 'value-warning' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                sessions: { label: 'Sessions', value: '1 (current)', class: 'value-strong' }
            },
            isSecure: false,
            explanation: 'SMS-based 2FA is vulnerable to SIM swapping, SS7 attacks, and social engineering at carrier support lines.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong (reused)', class: 'value-warning' },
                twoFactor: { label: '2FA', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                sessions: { label: 'Sessions', value: '1', class: 'value-strong' }
            },
            isSecure: false,
            explanation: 'Password reuse across services means a breach elsewhere exposes this account. Credential stuffing attacks are automated and widespread.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Per-IP only', class: 'value-warning' },
                sessions: { label: 'Sessions', value: '3 (home, office, mobile)', class: 'value-neutral' }
            },
            isSecure: false,
            explanation: 'Per-IP rate limiting is bypassed by distributed attacks using botnets or rotating proxies. Account-level limiting is also required.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                sessions: { label: 'Sessions', value: '5 (verified locations)', class: 'value-strong' }
            },
            isSecure: true,
            explanation: 'Multiple sessions from verified locations with full security controls enabled is an acceptable posture for active users.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                recovery: { label: 'Account Recovery', value: 'Email only', class: 'value-warning' }
            },
            isSecure: false,
            explanation: 'Account recovery via email alone bypasses 2FA entirely. Recovery mechanisms must require equivalent authentication strength.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA', value: 'Disabled', class: 'value-disabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Adaptive', class: 'value-strong' },
                sessions: { label: 'Sessions', value: '1 (trusted device)', class: 'value-strong' }
            },
            isSecure: false,
            explanation: 'Adaptive rate limiting and device trust cannot replace 2FA. A phished or leaked password grants immediate full access.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                passwordAge: { label: 'Password Age', value: '2 years', class: 'value-warning' }
            },
            isSecure: false,
            explanation: 'Passwords unchanged for extended periods increase exposure window. Regular rotation limits impact of undetected credential leaks.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                backupCodes: { label: 'Backup Codes', value: 'Stored securely', class: 'value-enabled' }
            },
            isSecure: true,
            explanation: 'Complete security configuration with properly stored backup codes for account recovery without compromising 2FA integrity.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Moderate', class: 'value-warning' },
                twoFactor: { label: '2FA', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                sessions: { label: 'Sessions', value: '1', class: 'value-strong' }
            },
            isSecure: false,
            explanation: 'Defense in depth requires all layers to be strong. A moderate password remains the weakest link, vulnerable to targeted attacks.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                sessions: { label: 'Sessions', value: '4 (unknown locations)', class: 'value-weak' }
            },
            isSecure: false,
            explanation: 'Multiple sessions from unknown locations with otherwise good security suggests active compromise. Immediate session review required.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA', value: 'Hardware Key', class: 'value-strong' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                sessions: { label: 'Sessions', value: '2 (bound devices)', class: 'value-strong' }
            },
            isSecure: true,
            explanation: 'Hardware security keys provide phishing-resistant authentication. Combined with device-bound sessions, this is enterprise-grade security.'
        }
    ];

    /**
     * HARD SCENARIOS: Subtle architectural vulnerabilities
     * - Everything appears secure at first glance
     * - Minimum 5 security factors per scenario
     * - Requires reasoning, not pattern matching
     * - No obvious giveaways
     */
    const HARD_SCENARIOS = [
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA Method', value: 'SMS', class: 'value-warning' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                tokenReuse: { label: 'Session Token', value: 'Reusable', class: 'value-warning' },
                adminPriv: { label: 'Admin Privileges', value: 'Yes', class: 'value-neutral' },
                ipReputation: { label: 'IP Reputation', value: 'Unknown', class: 'value-warning' }
            },
            isSecure: false,
            explanation: 'SMS-based 2FA combined with session token reuse creates elevated account takeover risk, especially for privileged accounts accessing from unknown IPs.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA Method', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                backupCodes: { label: 'Backup Codes', value: 'Plaintext file', class: 'value-weak' },
                sessions: { label: 'Sessions', value: '1 (current)', class: 'value-strong' },
                recovery: { label: 'Recovery Method', value: 'Security questions', class: 'value-warning' }
            },
            isSecure: false,
            explanation: 'Plaintext backup codes and weak security questions create parallel attack paths that bypass strong primary authentication entirely.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA Method', value: 'Hardware Key', class: 'value-strong' },
                rateLimiting: { label: 'Rate Limiting', value: 'Adaptive', class: 'value-strong' },
                tokenReuse: { label: 'Session Token', value: 'Unique per session', class: 'value-strong' },
                adminPriv: { label: 'Admin Privileges', value: 'No', class: 'value-neutral' },
                auditLog: { label: 'Audit Logging', value: 'Enabled', class: 'value-enabled' }
            },
            isSecure: true,
            explanation: 'Hardware key authentication with unique session tokens, adaptive rate limiting, and audit logging represents comprehensive enterprise security.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA Method', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                sessionTimeout: { label: 'Session Timeout', value: '30 days', class: 'value-warning' },
                reauth: { label: 'Sensitive Op Re-auth', value: 'Disabled', class: 'value-disabled' },
                ipReputation: { label: 'IP Reputation', value: 'Known', class: 'value-strong' }
            },
            isSecure: false,
            explanation: 'Extended session timeouts without re-authentication for sensitive operations expand the attack window for session hijacking significantly.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA Method', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'API Rate Limiting', value: 'Disabled', class: 'value-disabled' },
                webRateLimit: { label: 'Web Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                sessions: { label: 'Sessions', value: '1', class: 'value-strong' },
                cookieSec: { label: 'Cookie Flags', value: 'HttpOnly, Secure', class: 'value-strong' }
            },
            isSecure: false,
            explanation: 'API endpoints without rate limiting allow automated attacks that bypass web-only protections. All authentication surfaces require consistent controls.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA Method', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                tokenReuse: { label: 'Session Token', value: 'Unique', class: 'value-strong' },
                adminPriv: { label: 'Admin Privileges', value: 'Yes', class: 'value-neutral' },
                ipRestrict: { label: 'Admin IP Restrict', value: 'None', class: 'value-warning' }
            },
            isSecure: false,
            explanation: 'Admin accounts without IP restrictions can be accessed from anywhere if credentials are compromised. Privileged access requires additional network controls.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA Method', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                cookieSec: { label: 'Cookie Flags', value: 'Missing SameSite', class: 'value-warning' },
                sessions: { label: 'Sessions', value: '1', class: 'value-strong' },
                csrfProtect: { label: 'CSRF Protection', value: 'Token-based', class: 'value-enabled' }
            },
            isSecure: false,
            explanation: 'Missing SameSite cookie attribute enables cross-site request attacks. CSRF tokens help but defense in depth requires proper cookie attributes.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA Method', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                sessions: { label: 'Sessions', value: '1 (device-bound)', class: 'value-strong' },
                geoAnomaly: { label: 'Geo Anomaly', value: 'None detected', class: 'value-strong' },
                passwordAge: { label: 'Password Age', value: 'Recent', class: 'value-strong' }
            },
            isSecure: true,
            explanation: 'Complete security posture with device binding, recent credential rotation, and no geographic anomalies. This is a properly secured account.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA Method', value: 'TOTP (secret logged)', class: 'value-weak' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                sessions: { label: 'Sessions', value: '1', class: 'value-strong' },
                auditLog: { label: 'Audit Logging', value: 'Verbose', class: 'value-enabled' },
                adminPriv: { label: 'Admin Privileges', value: 'No', class: 'value-neutral' }
            },
            isSecure: false,
            explanation: 'Logging TOTP shared secrets allows anyone with log access to generate valid codes indefinitely. Secrets must never appear in any logs.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA Method', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Account + IP', class: 'value-strong' },
                tokenReuse: { label: 'Session Token', value: 'Unique, rotating', class: 'value-strong' },
                recovery: { label: 'Recovery Method', value: '2FA backup codes', class: 'value-enabled' },
                geoAnomaly: { label: 'Geo Anomaly', value: 'Flagged - new country', class: 'value-weak' }
            },
            isSecure: false,
            explanation: 'Geographic anomaly detection flagging access from a new country indicates potential compromise. Security controls cannot override active threat signals.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA Method', value: 'Hardware Key', class: 'value-strong' },
                rateLimiting: { label: 'Rate Limiting', value: 'Adaptive', class: 'value-strong' },
                sessions: { label: 'Sessions', value: '2 (verified)', class: 'value-strong' },
                recovery: { label: 'Recovery Method', value: 'In-person verification', class: 'value-strong' },
                auditLog: { label: 'Audit Logging', value: 'Immutable', class: 'value-strong' }
            },
            isSecure: true,
            explanation: 'Hardware key with in-person recovery verification and immutable audit logging. This represents the highest tier of account security architecture.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA Method', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                pwReset: { label: 'Password Reset', value: 'Email link (no 2FA)', class: 'value-warning' },
                sessions: { label: 'Sessions', value: '1', class: 'value-strong' },
                ipReputation: { label: 'IP Reputation', value: 'Known', class: 'value-strong' }
            },
            isSecure: false,
            explanation: 'Password reset flow bypassing 2FA creates a backdoor. Email account compromise grants full access regardless of configured authentication strength.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA Method', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Per-account only', class: 'value-warning' },
                adminPriv: { label: 'Admin Privileges', value: 'Yes', class: 'value-neutral' },
                sessions: { label: 'Sessions', value: '1', class: 'value-strong' },
                ipReputation: { label: 'IP Reputation', value: 'High risk', class: 'value-weak' }
            },
            isSecure: false,
            explanation: 'Per-account rate limiting on an admin account from a high-risk IP enables distributed credential attacks. Global IP-based limiting is essential.'
        },
        {
            config: {
                password: { label: 'Password', value: 'Strong', class: 'value-strong' },
                twoFactor: { label: '2FA Method', value: 'TOTP', class: 'value-enabled' },
                rateLimiting: { label: 'Rate Limiting', value: 'Enabled', class: 'value-enabled' },
                tokenReuse: { label: 'Session Token', value: 'Unique', class: 'value-strong' },
                cookieSec: { label: 'Cookie Flags', value: 'All flags set', class: 'value-strong' },
                reauth: { label: 'Sensitive Op Re-auth', value: 'Required', class: 'value-enabled' }
            },
            isSecure: true,
            explanation: 'Complete cookie security, unique session tokens, and re-authentication for sensitive operations. This configuration follows security best practices.'
        }
    ];

    // ========================================================================
    // GAME STATE AND LOGIC
    // ========================================================================

    const Game = {
        // Current game state
        state: {
            difficulty: 'easy',
            score: 0,
            currentRound: 0,
            scenarios: [],
            isPlaying: false
        },

        // DOM element references
        elements: {},

        /**
         * Initialize the game component
         */
        init() {
            this.elements = {
                container: document.getElementById('securityGame'),
                collapseBtn: document.getElementById('gameCollapseBtn'),
                difficultyBtns: document.querySelectorAll('.difficulty-btn'),
                scoreDisplay: document.getElementById('gameScore'),
                roundDisplay: document.getElementById('gameRound'),
                multiplierDisplay: document.getElementById('gameMultiplier'),
                startSection: document.getElementById('gameStart'),
                activeSection: document.getElementById('gameActive'),
                completeSection: document.getElementById('gameComplete'),
                startBtn: document.getElementById('gameStartBtn'),
                restartBtn: document.getElementById('gameRestartBtn'),
                scenarioDisplay: document.getElementById('gameScenario'),
                secureBtn: document.getElementById('gameSecureBtn'),
                insecureBtn: document.getElementById('gameInsecureBtn'),
                feedback: document.getElementById('gameFeedback'),
                finalScore: document.getElementById('gameFinalScore')
            };

            // Exit gracefully if game elements don't exist
            if (!this.elements.container) return;

            this.loadState();
            this.bindEvents();
            this.updateUI();
        },

        /**
         * Load saved state from localStorage
         */
        loadState() {
            try {
                const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
                if (saved) {
                    const data = JSON.parse(saved);
                    this.state.difficulty = data.difficulty || 'easy';
                    this.state.score = data.score || 0;
                    
                    // Update difficulty button state
                    this.elements.difficultyBtns.forEach(btn => {
                        btn.classList.toggle('active', btn.dataset.difficulty === this.state.difficulty);
                    });
                }
            } catch (e) {
                // localStorage unavailable - continue with defaults
            }
        },

        /**
         * Save current state to localStorage
         */
        saveState() {
            try {
                localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify({
                    difficulty: this.state.difficulty,
                    score: this.state.score,
                    timestamp: Date.now()
                }));
            } catch (e) {
                // localStorage unavailable - continue without persistence
            }
        },

        /**
         * Get points for current difficulty
         */
        getPoints() {
            return CONFIG.POINTS[this.state.difficulty] || CONFIG.POINTS.easy;
        },

        /**
         * Get multiplier label for current difficulty
         */
        getMultiplierLabel() {
            return CONFIG.MULTIPLIER_LABELS[this.state.difficulty] || CONFIG.MULTIPLIER_LABELS.easy;
        },

        /**
         * Bind event listeners
         */
        bindEvents() {
            // Collapse toggle
            this.elements.collapseBtn?.addEventListener('click', () => {
                this.elements.container.classList.toggle('collapsed');
            });

            // Difficulty selection
            this.elements.difficultyBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    if (this.state.isPlaying) return; // Don't change during game
                    
                    const newDifficulty = btn.dataset.difficulty;
                    if (newDifficulty !== this.state.difficulty) {
                        this.state.difficulty = newDifficulty;
                        this.state.score = 0; // Reset score on difficulty change
                        
                        // Update button states
                        this.elements.difficultyBtns.forEach(b => {
                            b.classList.toggle('active', b.dataset.difficulty === newDifficulty);
                        });
                        
                        this.saveState();
                        this.updateUI();
                    }
                });
            });

            // Start game
            this.elements.startBtn?.addEventListener('click', () => this.startGame());

            // Restart game
            this.elements.restartBtn?.addEventListener('click', () => this.startGame());

            // Answer buttons
            this.elements.secureBtn?.addEventListener('click', () => this.submitAnswer(true));
            this.elements.insecureBtn?.addEventListener('click', () => this.submitAnswer(false));
        },

        /**
         * Update UI elements with current state
         */
        updateUI() {
            if (this.elements.scoreDisplay) {
                this.elements.scoreDisplay.textContent = this.state.score;
            }
            if (this.elements.roundDisplay) {
                this.elements.roundDisplay.textContent = this.state.currentRound;
            }
            if (this.elements.multiplierDisplay) {
                this.elements.multiplierDisplay.textContent = this.getMultiplierLabel();
            }
        },

        /**
         * Get scenario pool for current difficulty
         */
        getScenarioPool() {
            switch (this.state.difficulty) {
                case 'hard':
                    return HARD_SCENARIOS;
                case 'medium':
                    return MEDIUM_SCENARIOS;
                default:
                    return EASY_SCENARIOS;
            }
        },

        /**
         * Start a new game
         */
        startGame() {
            // Reset game state
            this.state.currentRound = 0;
            this.state.score = 0;
            this.state.isPlaying = true;
            
            // Shuffle and select scenarios for this game
            const pool = this.getScenarioPool();
            this.state.scenarios = this.shuffleArray([...pool]).slice(0, CONFIG.ROUNDS_PER_GAME);

            // Update UI
            this.updateUI();
            
            // Show active section
            this.elements.startSection.classList.add('hidden');
            this.elements.completeSection.classList.add('hidden');
            this.elements.activeSection.classList.remove('hidden');
            this.elements.feedback.classList.add('hidden');

            // Disable difficulty buttons during game
            this.elements.difficultyBtns.forEach(btn => btn.disabled = true);

            // Load first scenario
            this.loadScenario();
        },

        /**
         * Load current scenario into the display
         */
        loadScenario() {
            const scenario = this.state.scenarios[this.state.currentRound];
            if (!scenario) return;

            // Update round display
            this.state.currentRound++;
            this.elements.roundDisplay.textContent = this.state.currentRound;

            // Build scenario HTML
            let itemsHTML = '';
            for (const [key, item] of Object.entries(scenario.config)) {
                itemsHTML += `
                    <div class="scenario-item">
                        <span class="scenario-item-label">${item.label}</span>
                        <span class="scenario-item-value ${item.class}">${item.value}</span>
                    </div>
                `;
            }

            this.elements.scenarioDisplay.innerHTML = `
                <div class="scenario-title">Account Configuration</div>
                <div class="scenario-items">${itemsHTML}</div>
            `;

            // Enable answer buttons
            this.elements.secureBtn.disabled = false;
            this.elements.insecureBtn.disabled = false;
            this.elements.feedback.classList.add('hidden');
        },

        /**
         * Submit an answer and show feedback
         */
        async submitAnswer(answeredSecure) {
            const scenario = this.state.scenarios[this.state.currentRound - 1];
            const isCorrect = answeredSecure === scenario.isSecure;
            const points = this.getPoints();

            // Update score
            if (isCorrect) {
                this.state.score += points;
                this.elements.scoreDisplay.textContent = this.state.score;
            }

            // Disable answer buttons during feedback
            this.elements.secureBtn.disabled = true;
            this.elements.insecureBtn.disabled = true;

            // Show feedback
            const correctAnswer = scenario.isSecure ? 'Secure' : 'Not Secure';
            this.elements.feedback.className = `game-feedback ${isCorrect ? 'feedback-correct' : 'feedback-incorrect'}`;
            this.elements.feedback.innerHTML = `
                <div class="feedback-header">
                    ${isCorrect ? `
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                            <polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                        <span>Correct (+${points})</span>
                    ` : `
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="15" y1="9" x2="9" y2="15"/>
                            <line x1="9" y1="9" x2="15" y2="15"/>
                        </svg>
                        <span>Incorrect — ${correctAnswer}</span>
                    `}
                </div>
                <div class="feedback-explanation">${scenario.explanation}</div>
            `;
            this.elements.feedback.classList.remove('hidden');

            // Wait before proceeding
            await new Promise(resolve => setTimeout(resolve, CONFIG.FEEDBACK_DELAY_MS));

            // Advance to next round or complete game
            if (this.state.currentRound >= CONFIG.ROUNDS_PER_GAME) {
                this.completeGame();
            } else {
                this.loadScenario();
            }
        },

        /**
         * Complete the game and show results
         */
        completeGame() {
            this.state.isPlaying = false;
            this.saveState();

            // Calculate max score based on difficulty
            const maxScore = CONFIG.ROUNDS_PER_GAME * this.getPoints();
            this.elements.finalScore.textContent = `${this.state.score} / ${maxScore}`;

            // Show completion section
            this.elements.activeSection.classList.add('hidden');
            this.elements.completeSection.classList.remove('hidden');

            // Re-enable difficulty buttons
            this.elements.difficultyBtns.forEach(btn => btn.disabled = false);
        },

        /**
         * Fisher-Yates shuffle algorithm
         */
        shuffleArray(array) {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
            return array;
        }
    };

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    /**
     * Initialize game when DOM is ready
     */
    function init() {
        Game.init();
    }

    // Initialize on DOMContentLoaded or immediately if already loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
