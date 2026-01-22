const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const EventEmitter = require('events');

/**
 * Hardware Watchdog Monitor
 * Sends heartbeats to Pico and handles restart commands
 */
class HardwareWatchdog extends EventEmitter {
    constructor(options = {}) {
        super();
        this.logger = options.logger || console;
        this.heartbeatInterval = options.heartbeatInterval || 5000; // 5 seconds
        this.port = null;
        this.parser = null;
        this.heartbeatTimer = null;
        this.connected = false;
        this.picoPort = null;
    }

    /**
     * Find and connect to the Pico
     */
    async connect() {
        try {
            const ports = await SerialPort.list();
            
            // Find Pico
            const pico = ports.find(p => 
                p.vendorId?.toLowerCase() === '2e8a' &&
                p.productId?.toLowerCase() === '0005'
            );
            
            if (!pico) {
                throw new Error('Raspberry Pi Pico not found. Please plug it in.');
            }
            
            this.picoPort = pico.path;
            this.logger.info(`🔌 Connecting to Pico on ${pico.path}...`);
            
            // Open serial connection
            this.port = new SerialPort({
                path: pico.path,
                baudRate: 115200
            });
            
            // Set up parser
            this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
            
            // Listen for messages from Pico
            this.parser.on('data', (data) => this.handlePicoMessage(data.trim()));
            
            // Handle connection events
            this.port.on('open', () => {
                this.connected = true;
                this.logger.info('✅ Hardware Watchdog connected');
                this.startHeartbeat();
                this.emit('connected');
            });
            
            this.port.on('close', () => {
                this.connected = false;
                this.logger.warn('⚠️  Hardware Watchdog disconnected');
                this.stopHeartbeat();
                this.emit('disconnected');
            });
            
            this.port.on('error', (err) => {
                this.logger.error('Watchdog error:', err.message);
                this.emit('error', err);
            });
            
        } catch (error) {
            this.logger.error('Failed to connect to Pico:', error.message);
            throw error;
        }
    }

    /**
     * Handle messages from Pico
     */
    handlePicoMessage(message) {
        this.logger.info(`📨 Pico: ${message}`);
        
        switch (message) {
            case 'AUTO_RESTART':
                this.logger.error('🚨 AUTO RESTART - Server crash detected');
                this.sendMessage('RESTART_ACK');
                this.emit('restart');
                break;
                
            case 'MANUAL_RESTART':
                this.logger.warn('🔄 MANUAL RESTART - Button double-press');
                this.sendMessage('RESTART_ACK');
                this.emit('restart');
                break;
                
            case 'LAUNCH':
                this.logger.info('🚀 LAUNCH command - Starting bot');
                this.emit('launch');
                break;
                
            case 'RESTART':
                this.logger.error('🚨 RESTART COMMAND RECEIVED FROM WATCHDOG');
                this.sendMessage('RESTART_ACK');
                this.emit('restart');
                break;
                
            case 'PONG':
                this.logger.info('🏓 Pong received');
                break;
                
            default:
                this.logger.info(`Unknown message: ${message}`);
        }
    }

    /**
     * Send message to Pico
     */
    sendMessage(message) {
        if (this.connected && this.port && this.port.isOpen) {
            this.port.write(message + '\n');
        }
    }

    /**
     * Send heartbeat to Pico
     */
    sendHeartbeat() {
        if (this.connected) {
            this.sendMessage('HEARTBEAT');
        }
    }

    /**
     * Start sending heartbeats
     */
    startHeartbeat() {
        this.stopHeartbeat(); // Clear any existing timer
        
        this.heartbeatTimer = setInterval(() => {
            this.sendHeartbeat();
        }, this.heartbeatInterval);
        
        this.logger.info(`💓 Heartbeat started (every ${this.heartbeatInterval}ms)`);
    }

    /**
     * Stop sending heartbeats
     */
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    /**
     * Send ping to test connection
     */
    ping() {
        this.sendMessage('PING');
    }

    /**
     * Disconnect from Pico
     */
    async disconnect() {
        this.stopHeartbeat();
        
        if (this.port && this.port.isOpen) {
            return new Promise((resolve) => {
                this.port.close((err) => {
                    if (err) {
                        this.logger.error('Error closing port:', err);
                    }
                    resolve();
                });
            });
        }
    }

    /**
     * Check if watchdog is connected
     */
    isConnected() {
        return this.connected;
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            connected: this.connected,
            port: this.picoPort,
            heartbeatInterval: this.heartbeatInterval
        };
    }
}

module.exports = HardwareWatchdog;
