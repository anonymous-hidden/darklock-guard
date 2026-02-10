/**
 * WebSocket Security Module
 * 
 * Provides rate limiting, message size limits, and connection management
 * for the dashboard WebSocket server.
 * 
 * SECURITY FEATURES:
 * - Per-connection message rate limiting
 * - Maximum message size enforcement
 * - Maximum connections per IP
 * - Subscription count limits
 * - Automatic cleanup of dead connections
 */

const DEFAULT_CONFIG = {
    // Rate limiting
    maxMessagesPerMinute: 60,        // Messages per minute per connection
    maxMessagesPerSecond: 10,        // Burst limit per second

    // Size limits
    maxMessageSizeBytes: 8192,       // 8KB max message size
    maxSubscriptions: 10,            // Max guild subscriptions per connection

    // Connection limits
    maxConnectionsPerIP: 5,          // Max connections per IP address
    
    // Timeouts
    heartbeatIntervalMs: 30000,      // 30s heartbeat
    heartbeatTimeoutMs: 60000,       // 60s timeout for pong response
    connectionTimeoutMs: 300000,     // 5min idle timeout (no messages)
};

class WebSocketSecurity {
    /**
     * @param {Object} config - Override default configuration
     */
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };

        // Track per-connection state
        this._connectionState = new Map();  // ws -> { ip, messageCount, windowStart, subscriptions, lastActivity }

        // Track per-IP connection counts
        this._ipConnections = new Map();    // ip -> count

        // Cleanup interval
        this._cleanupInterval = setInterval(() => this._cleanup(), 60000);
    }

    /**
     * Register a new WebSocket connection
     * @param {WebSocket} ws - WebSocket instance
     * @param {Object} req - HTTP upgrade request
     * @returns {{ allowed: boolean, reason?: string }}
     */
    registerConnection(ws, req) {
        const ip = this._getIP(req);
        const currentCount = this._ipConnections.get(ip) || 0;

        if (currentCount >= this.config.maxConnectionsPerIP) {
            return {
                allowed: false,
                reason: `Too many connections from IP (max: ${this.config.maxConnectionsPerIP})`
            };
        }

        this._ipConnections.set(ip, currentCount + 1);
        this._connectionState.set(ws, {
            ip,
            messageCountMinute: 0,
            messageCountSecond: 0,
            minuteWindowStart: Date.now(),
            secondWindowStart: Date.now(),
            subscriptions: new Set(),
            lastActivity: Date.now(),
            authenticated: false,
            userId: null
        });

        return { allowed: true };
    }

    /**
     * Unregister a WebSocket connection
     * @param {WebSocket} ws - WebSocket instance
     */
    unregisterConnection(ws) {
        const state = this._connectionState.get(ws);
        if (state) {
            const ipCount = this._ipConnections.get(state.ip) || 1;
            if (ipCount <= 1) {
                this._ipConnections.delete(state.ip);
            } else {
                this._ipConnections.set(state.ip, ipCount - 1);
            }
            this._connectionState.delete(ws);
        }
    }

    /**
     * Check if a message should be allowed (rate limit check)
     * @param {WebSocket} ws - WebSocket instance
     * @param {string|Buffer} message - The message data
     * @returns {{ allowed: boolean, reason?: string }}
     */
    checkMessage(ws, message) {
        const state = this._connectionState.get(ws);
        if (!state) {
            return { allowed: false, reason: 'Connection not registered' };
        }

        // Check message size
        const size = typeof message === 'string' ? Buffer.byteLength(message, 'utf8') : message.length;
        if (size > this.config.maxMessageSizeBytes) {
            return {
                allowed: false,
                reason: `Message too large (${size} bytes, max: ${this.config.maxMessageSizeBytes})`
            };
        }

        const now = Date.now();

        // Per-second rate limit (burst protection)
        if (now - state.secondWindowStart > 1000) {
            state.secondWindowStart = now;
            state.messageCountSecond = 0;
        }
        state.messageCountSecond++;
        if (state.messageCountSecond > this.config.maxMessagesPerSecond) {
            return {
                allowed: false,
                reason: `Burst rate limit exceeded (max: ${this.config.maxMessagesPerSecond}/sec)`
            };
        }

        // Per-minute rate limit
        if (now - state.minuteWindowStart > 60000) {
            state.minuteWindowStart = now;
            state.messageCountMinute = 0;
        }
        state.messageCountMinute++;
        if (state.messageCountMinute > this.config.maxMessagesPerMinute) {
            return {
                allowed: false,
                reason: `Rate limit exceeded (max: ${this.config.maxMessagesPerMinute}/min)`
            };
        }

        state.lastActivity = now;
        return { allowed: true };
    }

    /**
     * Check if a subscription should be allowed
     * @param {WebSocket} ws - WebSocket instance
     * @param {string} guildId - Guild to subscribe to
     * @returns {{ allowed: boolean, reason?: string }}
     */
    checkSubscription(ws, guildId) {
        const state = this._connectionState.get(ws);
        if (!state) {
            return { allowed: false, reason: 'Connection not registered' };
        }

        if (state.subscriptions.size >= this.config.maxSubscriptions) {
            return {
                allowed: false,
                reason: `Too many subscriptions (max: ${this.config.maxSubscriptions})`
            };
        }

        state.subscriptions.add(guildId);
        return { allowed: true };
    }

    /**
     * Remove a subscription
     * @param {WebSocket} ws - WebSocket instance
     * @param {string} guildId - Guild to unsubscribe from
     */
    removeSubscription(ws, guildId) {
        const state = this._connectionState.get(ws);
        if (state) {
            state.subscriptions.delete(guildId);
        }
    }

    /**
     * Mark connection as authenticated
     * @param {WebSocket} ws - WebSocket instance
     * @param {string} userId - Authenticated user ID
     */
    markAuthenticated(ws, userId) {
        const state = this._connectionState.get(ws);
        if (state) {
            state.authenticated = true;
            state.userId = userId;
        }
    }

    /**
     * Get connection stats
     * @returns {Object} Connection statistics
     */
    getStats() {
        return {
            totalConnections: this._connectionState.size,
            uniqueIPs: this._ipConnections.size,
            ipBreakdown: Object.fromEntries(this._ipConnections)
        };
    }

    /**
     * Extract client IP from request
     */
    _getIP(req) {
        return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
            || req.headers['x-real-ip']
            || req.socket?.remoteAddress
            || 'unknown';
    }

    /**
     * Cleanup stale connections
     */
    _cleanup() {
        const now = Date.now();
        for (const [ws, state] of this._connectionState) {
            // Check for idle timeout
            if (now - state.lastActivity > this.config.connectionTimeoutMs) {
                try {
                    ws.close(1000, 'Idle timeout');
                } catch (e) {
                    // Connection already closed
                }
                this.unregisterConnection(ws);
            }
        }
    }

    /**
     * Graceful shutdown
     */
    destroy() {
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }
        this._connectionState.clear();
        this._ipConnections.clear();
    }
}

module.exports = WebSocketSecurity;
