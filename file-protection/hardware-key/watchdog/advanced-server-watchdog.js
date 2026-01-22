/**
 * Advanced Server Watchdog Manager
 * Manages server process with advanced watchdog protocol
 */

const AdvancedHardwareWatchdog = require('./advanced-watchdog');
const { spawn } = require('child_process');
const path = require('path');

class AdvancedServerWatchdog {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.serverScript = options.serverScript || path.join(__dirname, '..', '..', '..', 'src', 'bot.js');
        this.restartDelay = options.restartDelay || 3000;
        this.maxRestarts = options.maxRestarts || 10;
        this.restartWindow = options.restartWindow || 300000; // 5 minutes
        
        // Project root for .env
        this.projectRoot = path.join(__dirname, '..', '..', '..');
        
        // Watchdog
        this.watchdog = new AdvancedHardwareWatchdog({
            logger: this.logger,
            heartbeatInterval: options.heartbeatInterval || 3000
        });
        
        // Server process
        this.serverProcess = null;
        this.restartCount = 0;
        this.restartTimestamps = [];
        this.isRestarting = false;
        this.isShuttingDown = false;
        
        // Health monitoring
        this.healthCheckInterval = null;
        this.lastHealthCheck = Date.now();
        
        this.setupHandlers();
    }

    setupHandlers() {
        // Watchdog connected
        this.watchdog.on('connected', ({ sessionId }) => {
            this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            this.logger.info('🔐 WATCHDOG SESSION ESTABLISHED');
            this.logger.info(`   Session: ${sessionId}`);
            this.logger.info('   Protection: ACTIVE');
            this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        });

        // Watchdog disconnected
        this.watchdog.on('disconnected', () => {
            this.logger.warn('⚠️  Watchdog disconnected - protection disabled');
        });

        // Launch requested
        this.watchdog.on('launch', async () => {
            if (!this.serverProcess && !this.isRestarting) {
                this.logger.info('🚀 Launch requested by hardware button');
                await this.startServer();
            } else {
                this.logger.info('ℹ️  Server already running');
            }
        });

        // Restart requested
        this.watchdog.on('restart', async () => {
            if (!this.isShuttingDown) {
                this.logger.warn('🔄 Restart requested by watchdog');
                await this.restartServer();
            }
        });

        // Error
        this.watchdog.on('error', (err) => {
            this.logger.error('Watchdog error:', err.message);
        });
    }

    async start() {
        this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        this.logger.info('🔒 ADVANCED WATCHDOG SYSTEM');
        this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        try {
            // Connect to hardware watchdog
            await this.watchdog.connect();
            
            // Start server
            await this.startServer();
            
            // Start health monitoring
            this.startHealthMonitoring();
            
            this.logger.info('');
            this.logger.info('✅ System started successfully');
            this.logger.info('🔐 Session handshake in progress...');
            this.logger.info('🛡️  Auto-restart enabled on crash');
            this.logger.info('');
            this.logger.info('Button Controls:');
            this.logger.info('  Single press: Launch bot');
            this.logger.info('  Double press: Restart bot');
            this.logger.info('');
            
        } catch (error) {
            this.logger.error('Failed to start:', error.message);
            throw error;
        }
    }

    async startServer() {
        if (this.serverProcess) {
            this.logger.warn('Server already running');
            return;
        }

        this.logger.info('🚀 Starting server...');
        this.logger.info(`   Script: ${this.serverScript}`);
        this.logger.info(`   CWD: ${this.projectRoot}`);

        try {
            this.serverProcess = spawn('node', [this.serverScript], {
                stdio: 'inherit',
                cwd: this.projectRoot
            });

            // Process exit handler
            this.serverProcess.on('exit', (code, signal) => {
                const exitInfo = `code: ${code}, signal: ${signal}`;
                this.serverProcess = null;

                if (this.isShuttingDown) {
                    this.logger.info(`Server stopped (${exitInfo})`);
                    return;
                }

                if (this.isRestarting) {
                    this.logger.info(`Server stopped for restart (${exitInfo})`);
                    return;
                }

                // Unexpected exit = crash
                this.logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                this.logger.error('🚨 SERVER CRASH DETECTED');
                this.logger.error(`   Exit: ${exitInfo}`);
                this.logger.error('   Watchdog will trigger auto-restart');
                this.logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                
                // Update watchdog health (triggers faster detection)
                this.watchdog.updateHealth(0);
            });

            this.serverProcess.on('error', (error) => {
                this.logger.error('Server process error:', error.message);
            });

            this.logger.info('✅ Server process started');

        } catch (error) {
            this.logger.error('Failed to start server:', error.message);
            throw error;
        }
    }

    async stopServer() {
        if (!this.serverProcess) {
            return;
        }

        this.logger.info('🛑 Stopping server...');

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.logger.warn('Force killing server...');
                this.serverProcess?.kill('SIGKILL');
                resolve();
            }, 10000);

            this.serverProcess.once('exit', () => {
                clearTimeout(timeout);
                this.serverProcess = null;
                this.logger.info('Server stopped');
                resolve();
            });

            this.serverProcess.kill('SIGTERM');
        });
    }

    async restartServer() {
        if (this.isRestarting) {
            this.logger.warn('Restart already in progress');
            return;
        }

        // Check restart limits
        this.cleanOldRestarts();
        this.restartTimestamps.push(Date.now());
        
        if (this.restartTimestamps.length > this.maxRestarts) {
            this.logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            this.logger.error('❌ MAX RESTARTS EXCEEDED');
            this.logger.error(`   ${this.maxRestarts} restarts in ${this.restartWindow/1000}s`);
            this.logger.error('   Manual intervention required');
            this.logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            return;
        }

        this.isRestarting = true;
        this.restartCount++;

        this.logger.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        this.logger.warn(`🔄 RESTARTING SERVER (${this.restartCount})`);
        this.logger.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        try {
            await this.stopServer();
            
            this.logger.info(`Waiting ${this.restartDelay}ms before restart...`);
            await new Promise(r => setTimeout(r, this.restartDelay));
            
            await this.startServer();
            
            // Reset health
            this.watchdog.updateHealth(100);
            
        } catch (error) {
            this.logger.error('Restart failed:', error.message);
        } finally {
            this.isRestarting = false;
        }
    }

    cleanOldRestarts() {
        const cutoff = Date.now() - this.restartWindow;
        this.restartTimestamps = this.restartTimestamps.filter(t => t > cutoff);
    }

    startHealthMonitoring() {
        this.healthCheckInterval = setInterval(() => {
            if (this.serverProcess) {
                // Server is running
                this.watchdog.updateHealth(100);
            } else if (!this.isRestarting && !this.isShuttingDown) {
                // Server died unexpectedly
                this.watchdog.updateHealth(0);
            }
        }, 5000);
    }

    async shutdown() {
        this.isShuttingDown = true;
        
        this.logger.info('🛑 Initiating graceful shutdown...');
        
        // Clear health monitoring
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
        
        // Notify watchdog of graceful shutdown
        await this.watchdog.gracefulShutdown();
        
        // Stop server
        await this.stopServer();
        
        // Disconnect watchdog
        await this.watchdog.disconnect();
        
        this.logger.info('✅ Shutdown complete');
    }

    getStatus() {
        return {
            server: {
                running: !!this.serverProcess,
                restartCount: this.restartCount,
                isRestarting: this.isRestarting
            },
            watchdog: this.watchdog.getSessionInfo()
        };
    }
}

module.exports = AdvancedServerWatchdog;

// ============================================================================
// STANDALONE EXECUTION
// ============================================================================
if (require.main === module) {
    const watchdog = new AdvancedServerWatchdog();
    
    // Handle shutdown signals
    process.on('SIGINT', async () => {
        console.log('\n');
        await watchdog.shutdown();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        await watchdog.shutdown();
        process.exit(0);
    });
    
    // Start
    watchdog.start().catch((err) => {
        console.error('Failed to start:', err);
        process.exit(1);
    });
}
