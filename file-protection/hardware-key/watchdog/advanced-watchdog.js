/**
 * Advanced Hardware Watchdog - Node.js Client
 * Features: Handshake, Session Management, Health Monitoring
 */

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const EventEmitter = require('events');
const crypto = require('crypto');

// ============================================================================
// PROTOCOL CONSTANTS
// ============================================================================
const Protocol = {
    // Handshake
    SYN: 'WD:SYN',
    SYN_ACK: 'SRV:SYN_ACK',
    ACK: 'WD:ACK',
    
    // Session
    SESSION_START: 'SRV:SESSION',
    SESSION_ACK: 'WD:SESSION_ACK',
    
    // Heartbeat
    HEARTBEAT: 'SRV:HB',
    HEARTBEAT_ACK: 'WD:HB_ACK',
    
    // Status
    STATUS_REQ: 'WD:STATUS?',
    STATUS_OK: 'SRV:STATUS_OK',
    STATUS_WARN: 'SRV:STATUS_WARN',
    STATUS_CRIT: 'SRV:STATUS_CRIT',
    
    // Control
    RESTART_REQ: 'WD:RESTART',
    RESTART_ACK: 'SRV:RESTART_ACK',
    SHUTDOWN: 'SRV:SHUTDOWN',
    SHUTDOWN_ACK: 'WD:SHUTDOWN_ACK',
    LAUNCH: 'WD:LAUNCH',
    LAUNCH_ACK: 'SRV:LAUNCH_ACK',
    
    // Ping
    PING: 'WD:PING',
    PONG: 'SRV:PONG'
};

// ============================================================================
// ADVANCED WATCHDOG CLASS
// ============================================================================
class AdvancedHardwareWatchdog extends EventEmitter {
    constructor(options = {}) {
        super();
        
        // Configuration
        this.heartbeatInterval = options.heartbeatInterval || 3000;
        this.statusCheckInterval = options.statusCheckInterval || 10000;
        this.handshakeTimeout = options.handshakeTimeout || 10000;
        this.logger = options.logger || console;
        
        // Connection
        this.port = null;
        this.parser = null;
        this.connected = false;
        this.picoPort = null;
        
        // Session
        this.sessionId = null;
        this.sessionStartTime = null;
        this.handshakeComplete = false;
        
        // Heartbeat
        this.heartbeatTimer = null;
        this.heartbeatSeq = 0;
        this.lastAckSeq = 0;
        this.missedAcks = 0;
        
        // Status
        this.serverStatus = 'starting';
        this.serverHealth = 100;
        this.memoryUsage = 0;
        this.cpuUsage = 0;
        
        // Statistics
        this.totalHeartbeats = 0;
        this.totalRestarts = 0;
        this.uptimeStart = Date.now();
    }

    // ========================================================================
    // CONNECTION MANAGEMENT
    // ========================================================================
    async connect() {
        try {
            const ports = await SerialPort.list();
            
            // Find Pico
            const pico = ports.find(p => 
                p.vendorId?.toLowerCase() === '2e8a' &&
                ['0005', '0003', '000a'].includes(p.productId?.toLowerCase())
            );
            
            if (!pico) {
                throw new Error('Raspberry Pi Pico not found');
            }
            
            this.picoPort = pico.path;
            this.logger.info(`🔌 Connecting to Pico on ${pico.path}...`);
            
            // Open port
            this.port = new SerialPort({
                path: pico.path,
                baudRate: 115200
            });
            
            // Parser
            this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
            
            // Event handlers
            this.parser.on('data', (data) => this.handleMessage(data.trim()));
            
            this.port.on('open', () => {
                this.connected = true;
                this.logger.info('✅ Serial connection established');
                
                // Wait a moment for Pico to be ready, then initiate handshake
                setTimeout(() => this.initiateHandshake(), 500);
            });
            
            this.port.on('close', () => {
                this.connected = false;
                this.handshakeComplete = false;
                this.sessionId = null;
                this.logger.warn('⚠️  Serial connection closed');
                this.stopHeartbeat();
                this.emit('disconnected');
            });
            
            this.port.on('error', (err) => {
                this.logger.error('Serial error:', err.message);
                this.emit('error', err);
            });
            
        } catch (error) {
            this.logger.error('Connection failed:', error.message);
            throw error;
        }
    }

    // ========================================================================
    // HANDSHAKE PROTOCOL
    // ========================================================================
    initiateHandshake() {
        this.logger.info('🤝 Initiating handshake with watchdog...');
        
        // Generate session ID
        this.sessionId = this.generateSessionId();
        
        // Send SYN_ACK (response to watchdog's SYN, or initiate from our side)
        this.send(Protocol.SYN_ACK);
        
        // Send session info
        setTimeout(() => {
            this.send(`${Protocol.SESSION_START}:${this.sessionId}`);
        }, 100);
        
        // Set handshake timeout
        this.handshakeTimer = setTimeout(() => {
            if (!this.handshakeComplete) {
                this.logger.warn('Handshake timeout - retrying...');
                this.initiateHandshake();
            }
        }, this.handshakeTimeout);
    }

    completeHandshake() {
        if (this.handshakeTimer) {
            clearTimeout(this.handshakeTimer);
        }
        
        this.handshakeComplete = true;
        this.sessionStartTime = Date.now();
        this.heartbeatSeq = 0;
        
        this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        this.logger.info('🔐 HANDSHAKE COMPLETE');
        this.logger.info(`   Session ID: ${this.sessionId}`);
        this.logger.info(`   Heartbeat Interval: ${this.heartbeatInterval}ms`);
        this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        // Start heartbeat
        this.startHeartbeat();
        
        // Emit connected event
        this.emit('connected', { sessionId: this.sessionId });
    }

    generateSessionId() {
        return `SRV${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    }

    // ========================================================================
    // MESSAGE HANDLING
    // ========================================================================
    send(message) {
        if (this.connected && this.port && this.port.isOpen) {
            this.port.write(message + '\n');
        }
    }

    handleMessage(message) {
        if (!message) return;
        
        // Parse message
        const parts = message.split(':');
        const prefix = parts[0];
        const cmd = parts.length >= 2 ? `${parts[0]}:${parts[1]}` : message;
        const data = parts.length >= 3 ? parts[2] : '';
        
        // Log (except frequent heartbeat ACKs)
        if (!message.includes('HB_ACK')) {
            this.logger.info(`📨 Pico: ${message}`);
        }
        
        // Handle by message type
        switch (true) {
            case message.includes('SYN') && !message.includes('ACK'):
                // Watchdog initiated handshake
                this.logger.info('🤝 Received SYN from watchdog');
                this.send(Protocol.SYN_ACK);
                setTimeout(() => {
                    this.send(`${Protocol.SESSION_START}:${this.sessionId || this.generateSessionId()}`);
                }, 100);
                break;
                
            case message.includes('SESSION_ACK'):
                // Handshake complete
                this.completeHandshake();
                break;
                
            case message.includes('HB_ACK'):
                // Heartbeat acknowledged
                const ackSeq = parseInt(data) || 0;
                this.lastAckSeq = ackSeq;
                this.missedAcks = 0;
                break;
                
            case message.includes('STATUS?'):
                // Status request
                this.sendStatus();
                break;
                
            case message.includes('RESTART'):
                // Restart requested
                this.logger.warn('🔄 RESTART requested by watchdog');
                this.send(Protocol.RESTART_ACK);
                this.emit('restart');
                break;
                
            case message.includes('LAUNCH'):
                // Launch requested
                this.logger.info('🚀 LAUNCH requested by watchdog');
                this.send(Protocol.LAUNCH_ACK);
                this.emit('launch');
                break;
                
            case message.includes('PING'):
                // Ping request
                this.send(Protocol.PONG);
                break;
                
            case message.includes('SHUTDOWN_ACK'):
                // Shutdown acknowledged
                this.logger.info('✅ Shutdown acknowledged by watchdog');
                this.emit('shutdown-ack');
                break;
        }
    }

    // ========================================================================
    // HEARTBEAT SYSTEM
    // ========================================================================
    startHeartbeat() {
        this.stopHeartbeat();
        
        this.heartbeatTimer = setInterval(() => {
            this.sendHeartbeat();
        }, this.heartbeatInterval);
        
        this.logger.info(`💓 Heartbeat started (every ${this.heartbeatInterval}ms)`);
        
        // Send first heartbeat immediately
        this.sendHeartbeat();
    }

    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    sendHeartbeat() {
        if (!this.connected || !this.handshakeComplete) return;
        
        this.heartbeatSeq++;
        this.totalHeartbeats++;
        
        this.send(`${Protocol.HEARTBEAT}:${this.heartbeatSeq}`);
        
        // Check for missed ACKs
        if (this.heartbeatSeq - this.lastAckSeq > 3) {
            this.missedAcks++;
            this.logger.warn(`⚠️  Missed ${this.missedAcks} heartbeat ACKs`);
        }
    }

    // ========================================================================
    // STATUS REPORTING
    // ========================================================================
    sendStatus() {
        // Gather system stats
        const mem = process.memoryUsage();
        this.memoryUsage = Math.round(mem.heapUsed / 1024 / 1024);
        
        // Determine status level
        let statusMsg;
        if (this.serverHealth >= 80) {
            statusMsg = Protocol.STATUS_OK;
        } else if (this.serverHealth >= 50) {
            statusMsg = Protocol.STATUS_WARN;
        } else {
            statusMsg = Protocol.STATUS_CRIT;
        }
        
        this.send(`${statusMsg}:${this.serverHealth}:${this.memoryUsage}MB`);
    }

    updateHealth(health) {
        this.serverHealth = Math.max(0, Math.min(100, health));
    }

    // ========================================================================
    // GRACEFUL SHUTDOWN
    // ========================================================================
    async gracefulShutdown() {
        this.logger.info('🛑 Initiating graceful shutdown...');
        
        // Notify watchdog
        this.send(Protocol.SHUTDOWN);
        
        // Wait for ACK or timeout
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.logger.warn('Shutdown ACK timeout');
                resolve();
            }, 3000);
            
            this.once('shutdown-ack', () => {
                clearTimeout(timeout);
                resolve();
            });
        });
    }

    // ========================================================================
    // UTILITY
    // ========================================================================
    getSessionInfo() {
        if (!this.sessionId) {
            return { active: false };
        }
        
        return {
            active: true,
            sessionId: this.sessionId,
            duration: Date.now() - this.sessionStartTime,
            heartbeats: this.totalHeartbeats,
            health: this.serverHealth,
            handshakeComplete: this.handshakeComplete
        };
    }

    async disconnect() {
        this.stopHeartbeat();
        
        if (this.port && this.port.isOpen) {
            return new Promise((resolve) => {
                this.port.close((err) => {
                    if (err) this.logger.error('Disconnect error:', err.message);
                    resolve();
                });
            });
        }
    }
}

module.exports = AdvancedHardwareWatchdog;
