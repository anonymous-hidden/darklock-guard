/**
 * DARKLOCK HARDWARE SECURITY GATE
 * =================================
 * 
 * Purpose: Physical RFID key requirement for bot operation and admin access
 * Security Model: FAIL CLOSED - no hardware key = no access
 * 
 * This service:
 * 1) Monitors Arduino over USB serial for RFID state
 * 2) Maintains shared in-memory security state
 * 3) Triggers bot shutdown if key is removed
 * 4) Provides middleware for admin route protection
 * 
 * Integration points:
 * - Bot lifecycle (shutdown on RFID_LOST)
 * - Express middleware (admin route protection)
 * - Monitoring/logging system
 */

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const EventEmitter = require('events');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Serial port configuration
  serialPort: process.env.HARDWARE_SERIAL_PORT || '/dev/ttyACM0',
  baudRate: 115200,
  
  // Timing
  reconnectDelay: 5000,          // Retry connection every 5s
  hardwareTimeout: 15000,        // No heartbeat for 15s = hardware failure
  shutdownGracePeriod: 5000,     // 5s to shut down bot gracefully
  
  // Security policy
  failClosed: true,              // If hardware fails, deny access
  requireHardwareForBoot: true,  // Bot cannot start without hardware key
  
  // Logging
  verboseLogging: process.env.NODE_ENV !== 'production',
};

// ============================================================================
// HARDWARE SECURITY GATE SERVICE
// ============================================================================

class HardwareSecurityGate extends EventEmitter {
  constructor(config = CONFIG) {
    super();
    
    this.config = config;
    
    // CRITICAL SECURITY STATE
    // Default to LOCKED (fail closed)
    this.hardwareKeyPresent = false;
    this.hardwareConnected = false;
    this.lastHeartbeat = null;
    
    // Connection state
    this.serialPort = null;
    this.parser = null;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    
    // Statistics
    this.stats = {
      startTime: Date.now(),
      messagesReceived: 0,
      rfidOkCount: 0,
      rfidLostCount: 0,
      rfidInvalidCount: 0,
      reconnectCount: 0,
      lastStateChange: null,
    };
  }
  
  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================
  
  async start() {
    this.log('info', 'Starting hardware security gate service...');
    this.log('info', `Serial port: ${this.config.serialPort}`);
    this.log('info', `Security policy: ${this.config.failClosed ? 'FAIL CLOSED' : 'FAIL OPEN'}`);
    
    await this.connect();
    this.startHeartbeatMonitor();
    
    this.emit('started');
  }
  
  async connect() {
    try {
      this.log('info', 'Connecting to Arduino...');
      
      this.serialPort = new SerialPort({
        path: this.config.serialPort,
        baudRate: this.config.baudRate,
        autoOpen: false,
      });
      
      this.parser = this.serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));
      
      // Set up event handlers
      this.serialPort.on('open', () => this.onSerialOpen());
      this.serialPort.on('error', (err) => this.onSerialError(err));
      this.serialPort.on('close', () => this.onSerialClose());
      this.parser.on('data', (line) => this.onSerialData(line));
      
      // Open connection
      await new Promise((resolve, reject) => {
        this.serialPort.open((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
    } catch (error) {
      this.log('error', `Failed to connect: ${error.message}`);
      this.scheduleReconnect();
    }
  }
  
  // ==========================================================================
  // SERIAL EVENT HANDLERS
  // ==========================================================================
  
  onSerialOpen() {
    this.log('info', '✓ Connected to Arduino');
    this.hardwareConnected = true;
    this.stats.reconnectCount++;
    
    // Request initial status
    setTimeout(() => {
      this.sendCommand('STATUS');
    }, 2000);
    
    this.emit('connected');
  }
  
  onSerialError(error) {
    this.log('error', `Serial error: ${error.message}`);
    this.hardwareConnected = false;
    
    // SECURITY: Hardware failure = lock system
    if (this.config.failClosed && this.hardwareKeyPresent) {
      this.setKeyState(false, 'HARDWARE_ERROR');
    }
    
    this.emit('error', error);
  }
  
  onSerialClose() {
    this.log('warn', 'Serial connection closed');
    this.hardwareConnected = false;
    
    // SECURITY: Hardware disconnect = lock system
    if (this.config.failClosed && this.hardwareKeyPresent) {
      this.setKeyState(false, 'HARDWARE_DISCONNECTED');
    }
    
    this.scheduleReconnect();
    this.emit('disconnected');
  }
  
  onSerialData(line) {
    const message = line.trim();
    if (!message) return;
    
    this.stats.messagesReceived++;
    this.log('debug', `RX: ${message}`);
    
    // Parse message
    if (message === 'BOOT_OK') {
      this.log('info', '✓ Arduino booted successfully');
      this.emit('boot');
      
    } else if (message === 'RFID_OK') {
      this.stats.rfidOkCount++;
      this.setKeyState(true, 'RFID_OK');
      
    } else if (message === 'RFID_LOST') {
      this.stats.rfidLostCount++;
      this.setKeyState(false, 'RFID_LOST');
      
    } else if (message === 'RFID_INVALID') {
      this.stats.rfidInvalidCount++;
      this.emit('invalid-card');
      this.log('warn', 'Invalid RFID card detected');
      
    } else if (message.startsWith('INVALID_UID:')) {
      const uid = message.substring(12);
      this.log('warn', `Invalid UID scanned: ${uid}`);
      this.emit('invalid-uid', uid);
      
    } else if (message === 'HEARTBEAT') {
      this.lastHeartbeat = Date.now();
      
    } else if (message.startsWith('RFID_VERSION:')) {
      const version = message.substring(13);
      this.log('info', `RFID reader version: ${version}`);
      
    } else if (message.startsWith('ERROR:')) {
      const error = message.substring(6);
      this.log('error', `Hardware error: ${error}`);
      this.emit('hardware-error', error);
    }
  }
  
  // ==========================================================================
  // KEY STATE MANAGEMENT
  // ==========================================================================
  
  setKeyState(present, reason) {
    const previousState = this.hardwareKeyPresent;
    this.hardwareKeyPresent = present;
    this.stats.lastStateChange = Date.now();
    
    // Only emit/log if state changed
    if (previousState === present) {
      return;
    }
    
    if (present) {
      this.log('info', `🔓 Hardware key GRANTED (${reason})`);
      this.emit('key-granted', reason);
    } else {
      this.log('warn', `🔒 Hardware key REVOKED (${reason})`);
      this.emit('key-revoked', reason);
      
      // CRITICAL: Trigger bot shutdown
      this.triggerBotShutdown(reason);
    }
  }
  
  // ==========================================================================
  // BOT LIFECYCLE INTEGRATION
  // ==========================================================================
  
  triggerBotShutdown(reason) {
    this.log('error', `SECURITY LOCKOUT: Bot shutdown triggered (${reason})`);
    
    // Emit event for bot to handle
    this.emit('shutdown-required', {
      reason,
      timestamp: Date.now(),
      gracePeriod: this.config.shutdownGracePeriod,
    });
    
    // In production, this would integrate with your bot's lifecycle manager
    // Example:
    // if (global.discordClient) {
    //   global.discordClient.destroy();
    // }
  }
  
  // ==========================================================================
  // HEARTBEAT MONITORING
  // ==========================================================================
  
  startHeartbeatMonitor() {
    this.heartbeatTimer = setInterval(() => {
      if (!this.hardwareConnected) {
        return; // Not connected, skip check
      }
      
      if (!this.lastHeartbeat) {
        return; // No heartbeat received yet
      }
      
      const timeSinceHeartbeat = Date.now() - this.lastHeartbeat;
      
      if (timeSinceHeartbeat > this.config.hardwareTimeout) {
        this.log('error', 'Hardware heartbeat timeout - no response from Arduino');
        
        // SECURITY: Hardware unresponsive = lock system
        if (this.config.failClosed && this.hardwareKeyPresent) {
          this.setKeyState(false, 'HEARTBEAT_TIMEOUT');
        }
        
        // Try to reconnect
        this.serialPort.close();
      }
      
    }, 5000);
  }
  
  // ==========================================================================
  // CONNECTION MANAGEMENT
  // ==========================================================================
  
  scheduleReconnect() {
    if (this.reconnectTimer) {
      return; // Already scheduled
    }
    
    this.log('info', `Will retry connection in ${this.config.reconnectDelay}ms`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.config.reconnectDelay);
  }
  
  sendCommand(command) {
    if (!this.hardwareConnected || !this.serialPort || !this.serialPort.isOpen) {
      this.log('warn', `Cannot send command "${command}" - not connected`);
      return false;
    }
    
    this.log('debug', `TX: ${command}`);
    this.serialPort.write(`${command}\n`);
    return true;
  }
  
  // ==========================================================================
  // PUBLIC API
  // ==========================================================================
  
  /**
   * Check if hardware key is currently present
   * @returns {boolean} True if authorized RFID card is present
   */
  isKeyPresent() {
    return this.hardwareKeyPresent;
  }
  
  /**
   * Check if hardware is connected and operational
   * @returns {boolean} True if Arduino is connected
   */
  isHardwareConnected() {
    return this.hardwareConnected;
  }
  
  /**
   * Get current statistics
   * @returns {object} Stats object
   */
  getStats() {
    return {
      ...this.stats,
      uptime: Date.now() - this.stats.startTime,
      hardwareConnected: this.hardwareConnected,
      keyPresent: this.hardwareKeyPresent,
      lastHeartbeat: this.lastHeartbeat,
    };
  }
  
  /**
   * Graceful shutdown
   */
  async shutdown() {
    this.log('info', 'Shutting down hardware security gate...');
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    if (this.serialPort && this.serialPort.isOpen) {
      await new Promise((resolve) => {
        this.serialPort.close(() => resolve());
      });
    }
    
    this.emit('shutdown');
  }
  
  // ==========================================================================
  // LOGGING
  // ==========================================================================
  
  log(level, message) {
    const timestamp = new Date().toISOString();
    const prefix = `[HardwareSecurityGate] [${level.toUpperCase()}]`;
    
    if (level === 'debug' && !this.config.verboseLogging) {
      return;
    }
    
    console.log(`${timestamp} ${prefix} ${message}`);
    
    // Emit for external logging systems
    this.emit('log', { level, message, timestamp });
  }
}

// ============================================================================
// EXPRESS MIDDLEWARE
// ============================================================================

/**
 * Express middleware to protect admin routes
 * Requires hardware key to be present
 * 
 * Usage:
 *   app.use('/admin', requireHardwareKey(securityGate), adminRouter);
 */
function requireHardwareKey(securityGate) {
  return (req, res, next) => {
    // Check hardware key presence
    if (!securityGate.isKeyPresent()) {
      // SECURITY: Hardware key required - deny access
      return res.status(403).json({
        error: 'Hardware key required',
        message: 'Physical RFID key must be present to access admin panel',
        hardwareConnected: securityGate.isHardwareConnected(),
      });
    }
    
    // Check if hardware is connected
    if (!securityGate.isHardwareConnected()) {
      return res.status(503).json({
        error: 'Hardware not available',
        message: 'Security hardware is not connected',
      });
    }
    
    // Hardware key present - proceed to normal authentication
    next();
  };
}

/**
 * Express middleware to provide hardware status to all routes
 * Adds req.hardwareSecurity object
 * 
 * Usage:
 *   app.use(hardwareSecurityContext(securityGate));
 */
function hardwareSecurityContext(securityGate) {
  return (req, res, next) => {
    req.hardwareSecurity = {
      keyPresent: securityGate.isKeyPresent(),
      hardwareConnected: securityGate.isHardwareConnected(),
      stats: securityGate.getStats(),
    };
    next();
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  HardwareSecurityGate,
  requireHardwareKey,
  hardwareSecurityContext,
  CONFIG,
};
