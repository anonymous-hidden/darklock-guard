const { SerialPort } = require('serialport');
const EventEmitter = require('events');

/**
 * Raspberry Pi Pico Hardware Key Detector
 * Monitors USB ports for Raspberry Pi Pico device
 */
class PicoDetector extends EventEmitter {
    constructor(options = {}) {
        super();
        this.logger = options.logger || console;
        
        // Raspberry Pi Pico USB identifiers
        this.PICO_VENDOR_ID = '2e8a'; // Raspberry Pi
        this.PICO_PRODUCT_ID = '0005'; // Pico (CDC)
        
        // Alternative identifiers (Pico can show up as different devices)
        this.PICO_IDENTIFIERS = [
            { vendorId: '2e8a', productId: '0005' }, // Pico CDC
            { vendorId: '2e8a', productId: '0003' }, // Pico MicroPython
            { vendorId: '2e8a', productId: '000a' }, // Pico W
        ];
        
        this.isConnected = false;
        this.currentPort = null;
        this.checkInterval = options.checkInterval || 2000; // Check every 2 seconds
        this.timer = null;
        this.customIdentifier = options.customIdentifier || null;
    }

    /**
     * Start monitoring for Pico device
     */
    async start() {
        this.logger.info('🔑 Starting Raspberry Pi Pico hardware key detector...');
        
        // Initial check
        await this.checkConnection();
        
        // Set up periodic checking
        this.timer = setInterval(() => {
            this.checkConnection();
        }, this.checkInterval);
        
        this.logger.info('✅ Hardware key detector started');
    }

    /**
     * Stop monitoring
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.logger.info('Hardware key detector stopped');
    }

    /**
     * Check if Pico is currently connected
     */
    async checkConnection() {
        try {
            const ports = await SerialPort.list();
            const picoPort = this.findPicoPort(ports);
            
            const wasConnected = this.isConnected;
            this.isConnected = !!picoPort;
            this.currentPort = picoPort;
            
            // Emit events on state change
            if (this.isConnected && !wasConnected) {
                this.logger.info('🔓 Hardware key CONNECTED - File modifications enabled');
                this.emit('connected', picoPort);
            } else if (!this.isConnected && wasConnected) {
                this.logger.warn('🔒 Hardware key DISCONNECTED - File modifications blocked');
                this.emit('disconnected');
            }
            
            return this.isConnected;
        } catch (error) {
            this.logger.error('Error checking Pico connection:', error);
            return false;
        }
    }

    /**
     * Find Raspberry Pi Pico in port list
     */
    findPicoPort(ports) {
        for (const port of ports) {
            // Check standard Pico identifiers
            for (const identifier of this.PICO_IDENTIFIERS) {
                if (port.vendorId?.toLowerCase() === identifier.vendorId &&
                    port.productId?.toLowerCase() === identifier.productId) {
                    return port;
                }
            }
            
            // Check custom identifier if provided
            if (this.customIdentifier) {
                if (port.serialNumber === this.customIdentifier ||
                    port.path.includes(this.customIdentifier)) {
                    return port;
                }
            }
            
            // Check manufacturer/product name
            if (port.manufacturer?.toLowerCase().includes('raspberry') ||
                port.manufacturer?.toLowerCase().includes('micropython')) {
                return port;
            }
        }
        
        return null;
    }

    /**
     * Get current connection status
     */
    getStatus() {
        return {
            connected: this.isConnected,
            port: this.currentPort,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * List all available serial ports (for debugging)
     */
    async listAllPorts() {
        try {
            const ports = await SerialPort.list();
            this.logger.info('📋 Available serial ports:');
            ports.forEach((port, index) => {
                this.logger.info(`  ${index + 1}. ${port.path}`);
                this.logger.info(`     Manufacturer: ${port.manufacturer || 'N/A'}`);
                this.logger.info(`     Serial Number: ${port.serialNumber || 'N/A'}`);
                this.logger.info(`     Vendor ID: ${port.vendorId || 'N/A'}`);
                this.logger.info(`     Product ID: ${port.productId || 'N/A'}`);
            });
            return ports;
        } catch (error) {
            this.logger.error('Error listing ports:', error);
            return [];
        }
    }

    /**
     * Wait for hardware key to be connected
     */
    async waitForConnection(timeout = 30000) {
        return new Promise((resolve, reject) => {
            if (this.isConnected) {
                resolve(true);
                return;
            }

            const timeoutTimer = setTimeout(() => {
                this.removeListener('connected', onConnected);
                reject(new Error('Timeout waiting for hardware key'));
            }, timeout);

            const onConnected = () => {
                clearTimeout(timeoutTimer);
                resolve(true);
            };

            this.once('connected', onConnected);
        });
    }
}

module.exports = PicoDetector;
