const fs = require('fs');
const path = require('path');
const readline = require('readline');

class BotSetup {
    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async run() {
        console.log('🛡️  DarkLock Setup\n');
        console.log('This setup will help you configure your DarkLock.\n');

        try {
            // Check if .env exists
            const envPath = path.join(__dirname, '.env');
            const envExamplePath = path.join(__dirname, '.env.example');

            if (!fs.existsSync(envPath)) {
                if (fs.existsSync(envExamplePath)) {
                    fs.copyFileSync(envExamplePath, envPath);
                    console.log('✅ Created .env file from template\n');
                } else {
                    await this.createEnvFile(envPath);
                }
            }

            // Get bot token
            const botToken = await this.getBotToken();
            await this.updateEnvFile(envPath, 'BOT_TOKEN', botToken);

            // Get basic configuration
            const config = await this.getBasicConfig();
            await this.updateEnvWithConfig(envPath, config);

            // Create necessary directories
            await this.createDirectories();

            // Display final instructions
            this.showFinalInstructions();

        } catch (error) {
            console.error('❌ Setup failed:', error.message);
        } finally {
            this.rl.close();
        }
    }

    async createEnvFile(envPath) {
        const envContent = `# DarkLock Configuration

# Bot Token (Required)
BOT_TOKEN=your_discord_bot_token_here

# Database Configuration
DB_NAME=security_bot.db
DB_PATH=./data/

# Web Dashboard Configuration
WEB_PORT=3000
WEB_HOST=localhost
JWT_SECRET=your_jwt_secret_here
ADMIN_PASSWORD=your_admin_password_here

# Security API Keys (Optional but recommended)
VIRUSTOTAL_API_KEY=
URLVOID_API_KEY=
SAFE_BROWSING_API_KEY=

# Advanced Features
ENABLE_AI_TOXICITY=true
ENABLE_VPN_DETECTION=false
ENABLE_WEB_DASHBOARD=true

# Rate Limits
MAX_MESSAGES_PER_MINUTE=10
MAX_JOINS_PER_MINUTE=5
RAID_THRESHOLD=10

# Default Settings
DEFAULT_ACCOUNT_AGE_HOURS=24
DEFAULT_VERIFICATION_LEVEL=1
LOG_RETENTION_DAYS=30
`;

        fs.writeFileSync(envPath, envContent);
        console.log('✅ Created .env file\n');
    }

    async getBotToken() {
        console.log('🤖 Discord Bot Token Setup');
        console.log('You need to create a Discord application and bot at:');
        console.log('https://discord.com/developers/applications\n');

        return new Promise((resolve) => {
            this.rl.question('Enter your Discord bot token: ', (token) => {
                if (!token || token.trim() === '' || token === 'your_discord_bot_token_here') {
                    console.log('❌ Invalid token. Please enter a valid Discord bot token.');
                    resolve(this.getBotToken());
                } else {
                    console.log('✅ Bot token configured\n');
                    resolve(token.trim());
                }
            });
        });
    }

    async getBasicConfig() {
        console.log('⚙️  Basic Configuration');
        
        const config = {};

        // Web dashboard
        config.enableDashboard = await this.askYesNo('Enable web dashboard? (y/n): ', true);
        
        if (config.enableDashboard) {
            config.dashboardPort = await this.askNumber('Dashboard port (default 3000): ', 3000);
            config.adminPassword = await this.askString('Admin password for dashboard: ');
        }

        // Security settings
        config.raidThreshold = await this.askNumber('Raid detection threshold (users joining rapidly, default 10): ', 10);
        config.accountAgeHours = await this.askNumber('Minimum account age in hours (default 24): ', 24);
        config.enableVPN = await this.askYesNo('Enable VPN detection? (may cause false positives) (y/n): ', false);

        return config;
    }

    async askYesNo(question, defaultValue) {
        return new Promise((resolve) => {
            this.rl.question(question, (answer) => {
                const normalized = answer.toLowerCase().trim();
                if (normalized === 'y' || normalized === 'yes') {
                    resolve(true);
                } else if (normalized === 'n' || normalized === 'no') {
                    resolve(false);
                } else if (normalized === '') {
                    resolve(defaultValue);
                } else {
                    console.log('Please enter y/n');
                    resolve(this.askYesNo(question, defaultValue));
                }
            });
        });
    }

    async askNumber(question, defaultValue) {
        return new Promise((resolve) => {
            this.rl.question(question, (answer) => {
                if (answer.trim() === '') {
                    resolve(defaultValue);
                } else {
                    const num = parseInt(answer);
                    if (isNaN(num)) {
                        console.log('Please enter a valid number');
                        resolve(this.askNumber(question, defaultValue));
                    } else {
                        resolve(num);
                    }
                }
            });
        });
    }

    async askString(question, defaultValue = '') {
        return new Promise((resolve) => {
            this.rl.question(question, (answer) => {
                resolve(answer.trim() || defaultValue);
            });
        });
    }

    async updateEnvFile(envPath, key, value) {
        let envContent = fs.readFileSync(envPath, 'utf8');
        const regex = new RegExp(`^${key}=.*$`, 'm');
        
        if (regex.test(envContent)) {
            envContent = envContent.replace(regex, `${key}=${value}`);
        } else {
            envContent += `\n${key}=${value}`;
        }
        
        fs.writeFileSync(envPath, envContent);
    }

    async updateEnvWithConfig(envPath, config) {
        if (config.enableDashboard !== undefined) {
            await this.updateEnvFile(envPath, 'ENABLE_WEB_DASHBOARD', config.enableDashboard);
        }
        
        if (config.dashboardPort) {
            await this.updateEnvFile(envPath, 'WEB_PORT', config.dashboardPort);
        }
        
        if (config.adminPassword) {
            await this.updateEnvFile(envPath, 'ADMIN_PASSWORD', config.adminPassword);
        }
        
        if (config.raidThreshold) {
            await this.updateEnvFile(envPath, 'RAID_THRESHOLD', config.raidThreshold);
        }
        
        if (config.accountAgeHours) {
            await this.updateEnvFile(envPath, 'DEFAULT_ACCOUNT_AGE_HOURS', config.accountAgeHours);
        }
        
        if (config.enableVPN !== undefined) {
            await this.updateEnvFile(envPath, 'ENABLE_VPN_DETECTION', config.enableVPN);
        }

        // Generate JWT secret
        const jwtSecret = this.generateRandomString(64);
        await this.updateEnvFile(envPath, 'JWT_SECRET', jwtSecret);

        console.log('✅ Configuration updated\n');
    }

    async createDirectories() {
        const directories = [
            './data',
            './logs',
            './temp',
            './src/commands/security',
            './src/commands/moderation',
            './src/commands/config'
        ];

        directories.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`✅ Created directory: ${dir}`);
            }
        });

        console.log('');
    }

    generateRandomString(length) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    showFinalInstructions() {
        console.log('🎉 Setup Complete!\n');
        console.log('Next steps:');
        console.log('1. Invite your bot to a Discord server with the following permissions:');
        console.log('   - View Channels');
        console.log('   - Send Messages');
        console.log('   - Manage Messages');
        console.log('   - Manage Roles');
        console.log('   - Moderate Members');
        console.log('   - Kick Members');
        console.log('   - Ban Members');
        console.log('   - View Audit Log\n');
        
        console.log('2. Start the bot:');
        console.log('   npm start\n');
        
        console.log('3. Configure the bot in your Discord server:');
        console.log('   Use the /config command to set up security features\n');
        
        console.log('4. Optional - Set up external APIs for enhanced protection:');
        console.log('   - VirusTotal: https://www.virustotal.com/gui/join-us');
        console.log('   - URLVoid: https://www.urlvoid.com/api/');
        console.log('   - Google Safe Browsing: https://developers.google.com/safe-browsing\n');
        
        console.log('5. Access the web dashboard (if enabled):');
        console.log('   Open your browser to the configured dashboard URL\n');
        
        console.log('For more information, see README.md');
        console.log('For support, check the logs in the logs/ directory');
        console.log('\n🛡️  Your Discord server security is now enhanced!');
    }
}

// Run setup if this file is executed directly
if (require.main === module) {
    const setup = new BotSetup();
    setup.run().catch(console.error);
}

module.exports = BotSetup;