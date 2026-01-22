const HardwareWatchdog = require('./hardware-watchdog');
const { spawn } = require('child_process');
const path = require('path');

/**
 * Server Watchdog Manager
 * Manages server process and restarts on watchdog trigger
 */
class ServerWatchdog {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.serverScript = options.serverScript || path.join(__dirname, '..', '..', 'src', 'bot.js');
        this.restartDelay = options.restartDelay || 5000;
        this.maxRestarts = options.maxRestarts || 10;
        
        this.watchdog = new HardwareWatchdog({
            logger: this.logger,
            heartbeatInterval: options.heartbeatInterval || 5000
        });
        
        this.serverProcess = null;
        this.restartCount = 0;
        this.isRestarting = false;
        this.maintenanceMode = false;
        this.lockdownMode = false;
        
        this.setupWatchdogHandlers();
    }

    /**
     * Set up watchdog event handlers
     */
    setupWatchdogHandlers() {
        this.watchdog.on('connected', () => {
            this.logger.info('🔒 Hardware Watchdog protection active');
        });

        this.watchdog.on('disconnected', () => {
            this.logger.warn('⚠️  Hardware Watchdog protection disabled');
        });

        this.watchdog.on('launch', async () => {
            this.logger.info('🚀 Launch command received from hardware');
            if (!this.serverProcess) {
                await this.startServer();
            } else {
                this.logger.info('ℹ️  Server already running');
            }
        });

        this.watchdog.on('restart', async () => {
            this.logger.info('🔄 Restart command received from hardware');
            await this.restartServer();
        });

        this.watchdog.on('error', (err) => {
            this.logger.error('Watchdog error:', err.message);
        });
    }

    /**
     * Start the server process
     */
    async startServer() {
        if (this.serverProcess) {
            this.logger.warn('Server is already running');
            return;
        }

        this.logger.info('🚀 Starting server...');
        this.logger.info(`   Script: ${this.serverScript}`);
        
        try {
            // Use project root as cwd (where .env is located)
            const projectRoot = path.join(__dirname, '..', '..', '..');
            this.serverProcess = spawn('node', [this.serverScript], {
                stdio: 'inherit',
                cwd: projectRoot
            });

            this.serverProcess.on('exit', (code, signal) => {
                this.logger.warn(`Server process exited (code: ${code}, signal: ${signal})`);
                this.serverProcess = null;
                
                if (!this.isRestarting) {
                    // Unexpected exit - watchdog will detect and restart
                    this.logger.warn('⚠️  Unexpected server exit - watchdog monitoring...');
                }
            });

            this.serverProcess.on('error', (error) => {
                this.logger.error('Server process error:', error);
            });

            this.logger.info('✅ Server started successfully');
            
            // Notify Pico that bot started
            setTimeout(() => {
                this.watchdog.sendMessage('BOT_STARTED');
            }, 2000);
            
        } catch (error) {
            this.logger.error('Failed to start server:', error);
            throw error;
        }
    }

    /**
     * Stop the server process
     */
    async stopServer() {
        if (!this.serverProcess) {
            return;
        }

        this.logger.info('🛑 Stopping server...');
        
        // Notify Pico that bot is stopping
        this.watchdog.sendMessage('BOT_STOPPED');
        
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                // Force kill if graceful shutdown fails
                this.logger.warn('Force killing server process...');
                this.serverProcess.kill('SIGKILL');
                resolve();
            }, 10000);

            this.serverProcess.once('exit', () => {
                clearTimeout(timeout);
                this.serverProcess = null;
                this.logger.info('Server stopped');
                resolve();
            });

            // Try graceful shutdown first
            this.serverProcess.kill('SIGTERM');
        });
    }

    /**
     * Restart the server
     */
    async restartServer() {
        if (this.isRestarting) {
            this.logger.warn('Restart already in progress...');
            return;
        }

        this.restartCount++;
        
        if (this.restartCount > this.maxRestarts) {
            this.logger.error('❌ Maximum restart limit reached!');
            this.logger.error('   Manual intervention required');
            return;
        }

        this.isRestarting = true;
        
        this.logger.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        this.logger.warn(`🔄 RESTARTING SERVER (Attempt ${this.restartCount}/${this.maxRestarts})`);
        this.logger.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        try {
            // Stop current process
            await this.stopServer();
            
            // Wait before restart
            this.logger.info(`⏱️  Waiting ${this.restartDelay}ms before restart...`);
            await new Promise(resolve => setTimeout(resolve, this.restartDelay));
            
            // Start new process
            await this.startServer();
            
            this.logger.info('✅ Server restart completed');
            
        } catch (error) {
            this.logger.error('❌ Restart failed:', error);
        } finally {
            this.isRestarting = false;
        }
    }

    /**,
            maintenanceMode: this.maintenanceMode,
            lockdownMode: this.lockdownMode
     * Start watchdog and server
     */
    async start() {
        this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        this.logger.info('🔒 Starting Hardware Watchdog System');
        this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        // Connect to watchdog
        await this.watchdog.connect();
        
        // Start server
        await this.startServer();
        
        this.logger.info('');
        this.logger.info('✅ System started successfully');
        this.logger.info('💓 Heartbeats being sent to watchdog');
        this.logger.info('🛡️  Server will auto-restart if it crashes');
        this.logger.info('');
    }

    /**
     * Stop everything
     */
    async stop() {
        this.logger.info('Shutting down...');
        
        await this.stopServer();
        await this.watchdog.disconnect();
        
        this.logger.info('Shutdown complete');
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            serverRunning: !!this.serverProcess,
            watchdogConnected: this.watchdog.isConnected(),
            restartCount: this.restartCount,
            isRestarting: this.isRestarting
        };
    }
}

module.exports = ServerWatchdog;
