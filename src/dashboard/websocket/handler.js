/**
 * WebSocket Handler
 * Manages real-time communication between dashboard and bot
 */

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { sessionStore } = require('../security-utils');

class WebSocketHandler {
    constructor(dashboard) {
        this.dashboard = dashboard;
        this.bot = dashboard.bot;
        this.wss = null;
        this.clients = new Map(); // Map of userId -> Set of WebSocket connections
        this.guildSubscriptions = new Map(); // Map of guildId -> Set of client connections
        this.heartbeatInterval = 30000; // 30 seconds
    }

    /**
     * Initialize WebSocket server
     */
    initialize(server) {
        this.wss = new WebSocket.Server({ 
            server,
            path: '/ws',
            verifyClient: this.verifyClient.bind(this)
        });

        this.wss.on('connection', this.handleConnection.bind(this));
        
        // Start heartbeat check
        setInterval(() => this.checkHeartbeats(), this.heartbeatInterval);

        this.bot.logger?.info('✅ WebSocket server initialized');
    }

    /**
     * Verify client connection
     */
    verifyClient(info, callback) {
        const url = new URL(info.req.url, `ws://${info.req.headers.host}`);
        const token = url.searchParams.get('token');

        if (!token) {
            callback(false, 401, 'Authentication required');
            return;
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const session = sessionStore.get(decoded.sessionId);

            if (!session || session.revoked) {
                callback(false, 401, 'Session invalid');
                return;
            }

            // Attach user info to request for use in connection handler
            info.req.user = decoded;
            info.req.session = session;
            callback(true);
        } catch (error) {
            callback(false, 403, 'Invalid token');
        }
    }

    /**
     * Handle new WebSocket connection
     */
    handleConnection(ws, req) {
        const userId = req.user.userId;
        ws.userId = userId;
        ws.isAlive = true;
        ws.subscribedGuilds = new Set();

        // Add to clients map
        if (!this.clients.has(userId)) {
            this.clients.set(userId, new Set());
        }
        this.clients.get(userId).add(ws);

        this.bot.logger?.debug(`WebSocket connected: ${userId}`);

        // Send initial connection success
        this.send(ws, 'connected', { 
            userId,
            serverTime: Date.now()
        });

        // Handle messages
        ws.on('message', (data) => this.handleMessage(ws, data));

        // Handle pong for heartbeat
        ws.on('pong', () => {
            ws.isAlive = true;
        });

        // Handle disconnection
        ws.on('close', () => this.handleDisconnect(ws));

        // Handle errors
        ws.on('error', (error) => {
            this.bot.logger?.warn('WebSocket error:', error.message);
        });
    }

    /**
     * Handle incoming WebSocket message
     */
    handleMessage(ws, data) {
        try {
            const message = JSON.parse(data);
            const { type, payload } = message;

            switch (type) {
                case 'subscribe':
                    this.handleSubscribe(ws, payload);
                    break;
                case 'unsubscribe':
                    this.handleUnsubscribe(ws, payload);
                    break;
                case 'ping':
                    this.send(ws, 'pong', { timestamp: Date.now() });
                    break;
                case 'console_subscribe':
                    this.handleConsoleSubscribe(ws, payload);
                    break;
                default:
                    this.bot.logger?.debug(`Unknown WebSocket message type: ${type}`);
            }
        } catch (error) {
            this.bot.logger?.warn('Invalid WebSocket message:', error.message);
        }
    }

    /**
     * Handle guild subscription
     */
    async handleSubscribe(ws, payload) {
        const { guildId } = payload;

        if (!guildId) {
            return this.send(ws, 'error', { message: 'Guild ID required' });
        }

        // Verify user has access to guild
        const hasAccess = await this.dashboard.checkGuildAccess(ws.userId, guildId);
        if (!hasAccess?.authorized) {
            return this.send(ws, 'error', { message: 'No access to guild' });
        }

        // Add to subscriptions
        if (!this.guildSubscriptions.has(guildId)) {
            this.guildSubscriptions.set(guildId, new Set());
        }
        this.guildSubscriptions.get(guildId).add(ws);
        ws.subscribedGuilds.add(guildId);

        this.send(ws, 'subscribed', { guildId });
    }

    /**
     * Handle guild unsubscription
     */
    handleUnsubscribe(ws, payload) {
        const { guildId } = payload;

        if (guildId && this.guildSubscriptions.has(guildId)) {
            this.guildSubscriptions.get(guildId).delete(ws);
        }
        ws.subscribedGuilds.delete(guildId);

        this.send(ws, 'unsubscribed', { guildId });
    }

    /**
     * Handle console subscription (for real-time bot logs)
     */
    async handleConsoleSubscribe(ws, payload) {
        const { guildId } = payload;

        if (!guildId) {
            return this.send(ws, 'error', { message: 'Guild ID required' });
        }

        // SECURITY: Verify user has access to this guild before subscribing to its logs
        const hasAccess = await this.dashboard.checkGuildAccess(ws.userId, guildId);
        if (!hasAccess?.authorized) {
            return this.send(ws, 'error', { message: 'No access to guild' });
        }

        ws.consoleSubscription = guildId;
        
        // Send recent console messages
        const recentMessages = this.dashboard.getConsoleMessages(guildId);
        this.send(ws, 'console_history', { 
            guildId, 
            messages: recentMessages.slice(-100) 
        });
    }

    /**
     * Handle client disconnection
     */
    handleDisconnect(ws) {
        const userId = ws.userId;

        // Remove from clients map
        if (this.clients.has(userId)) {
            this.clients.get(userId).delete(ws);
            if (this.clients.get(userId).size === 0) {
                this.clients.delete(userId);
            }
        }

        // Remove from all guild subscriptions
        for (const guildId of ws.subscribedGuilds) {
            if (this.guildSubscriptions.has(guildId)) {
                this.guildSubscriptions.get(guildId).delete(ws);
            }
        }

        this.bot.logger?.debug(`WebSocket disconnected: ${userId}`);
    }

    /**
     * Check heartbeats and close dead connections
     */
    checkHeartbeats() {
        if (!this.wss) return;

        this.wss.clients.forEach((ws) => {
            if (!ws.isAlive) {
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }

    /**
     * Send message to a WebSocket client
     */
    send(ws, type, payload) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
        }
    }

    /**
     * Broadcast message to all clients subscribed to a guild
     */
    broadcastToGuild(guildId, type, payload) {
        const subscribers = this.guildSubscriptions.get(guildId);
        if (!subscribers) return;

        const message = JSON.stringify({ type, payload, timestamp: Date.now() });
        
        for (const ws of subscribers) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        }
    }

    /**
     * Broadcast message to a specific user (all their connections)
     */
    broadcastToUser(userId, type, payload) {
        const connections = this.clients.get(userId);
        if (!connections) return;

        const message = JSON.stringify({ type, payload, timestamp: Date.now() });
        
        for (const ws of connections) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        }
    }

    /**
     * Broadcast to all connected clients
     */
    broadcastAll(type, payload) {
        if (!this.wss) return;

        const message = JSON.stringify({ type, payload, timestamp: Date.now() });
        
        this.wss.clients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        });
    }

    /**
     * Broadcast console message to guild subscribers
     */
    broadcastConsole(guildId, message) {
        const consoleMsg = {
            timestamp: Date.now(),
            message,
            guildId
        };

        // Store in dashboard console buffer
        this.dashboard.addConsoleMessage(guildId, consoleMsg);

        // Send to subscribers
        if (!this.wss) return;

        for (const ws of this.wss.clients) {
            if (ws.readyState === WebSocket.OPEN && ws.consoleSubscription === guildId) {
                this.send(ws, 'console', consoleMsg);
            }
        }
    }

    /**
     * Notify about security incident
     */
    notifySecurityIncident(guildId, incident) {
        this.broadcastToGuild(guildId, 'security_incident', incident);
    }

    /**
     * Notify about verification event
     */
    notifyVerificationEvent(guildId, event) {
        this.broadcastToGuild(guildId, 'verification_event', event);
    }

    /**
     * Notify about moderation action
     */
    notifyModerationAction(guildId, action) {
        this.broadcastToGuild(guildId, 'mod_action', action);
    }

    /**
     * Notify about settings change
     */
    notifySettingsChange(guildId, change) {
        this.broadcastToGuild(guildId, 'settings_changed', change);
    }

    /**
     * Get connection count
     */
    getConnectionCount() {
        return this.wss ? this.wss.clients.size : 0;
    }

    /**
     * Get guild subscription count
     */
    getGuildSubscriptionCount(guildId) {
        return this.guildSubscriptions.get(guildId)?.size || 0;
    }
}

module.exports = WebSocketHandler;
