const express = require('express');
const path = require('path');
const cors = require('cors');

/**
 * XP Leaderboard Web Dashboard
 * Express server for web-based leaderboard viewing
 */
class WebDashboard {
    constructor(xpDatabase, discordClient, port = 3005) {
        this.db = xpDatabase;
        this.client = discordClient;
        this.port = port;
        this.app = express();
        this.setupMiddleware();
        this.setupRoutes();
    }

    /**
     * Setup Express middleware
     */
    setupMiddleware() {
        // CORS for API access
        this.app.use(cors());

        // JSON body parser
        this.app.use(express.json());

        // Static files (CSS, JS, images)
        this.app.use('/public', express.static(path.join(__dirname, 'public')));

        // Logging middleware
        this.app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
            next();
        });
    }

    /**
     * Setup Express routes
     */
    setupRoutes() {
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok', timestamp: Date.now() });
        });

        // Leaderboard page
        this.app.get('/leaderboard/:guildId', async (req, res) => {
            try {
                await this.renderLeaderboard(req, res);
            } catch (error) {
                console.error('Error rendering leaderboard:', error);
                res.status(500).send('Internal Server Error');
            }
        });

        // API endpoint for leaderboard data
        this.app.get('/api/leaderboard/:guildId', async (req, res) => {
            try {
                const guildId = req.params.guildId;
                const leaderboard = await this.db.getFullLeaderboard(guildId);

                // Enrich with Discord user data
                const enrichedLeaderboard = await Promise.all(
                    leaderboard.map(async (entry) => {
                        try {
                            const user = await this.client.users.fetch(entry.user_id);
                            return {
                                ...entry,
                                username: user.username,
                                discriminator: user.discriminator,
                                avatar: user.displayAvatarURL({ format: 'png', size: 128 })
                            };
                        } catch (err) {
                            return {
                                ...entry,
                                username: 'Unknown User',
                                discriminator: '0000',
                                avatar: 'https://cdn.discordapp.com/embed/avatars/0.png'
                            };
                        }
                    })
                );

                res.json({
                    success: true,
                    data: enrichedLeaderboard
                });

            } catch (error) {
                console.error('Error fetching leaderboard:', error);
                res.status(500).json({
                    success: false,
                    error: 'Failed to fetch leaderboard'
                });
            }
        });

        // 404 handler
        this.app.use((req, res) => {
            res.status(404).send('Page not found');
        });
    }

    /**
     * Render leaderboard HTML page
     */
    async renderLeaderboard(req, res) {
        const guildId = req.params.guildId;

        // Fetch guild info
        let guildName = 'Server Leaderboard';
        let guildIcon = null;

        try {
            const guild = await this.client.guilds.fetch(guildId);
            guildName = guild.name;
            guildIcon = guild.iconURL({ format: 'png', size: 256 });
        } catch (error) {
            console.error('Error fetching guild:', error);
        }

        // Fetch leaderboard
        const leaderboard = await this.db.getFullLeaderboard(guildId);

        // Enrich with user data
        const enrichedLeaderboard = await Promise.all(
            leaderboard.map(async (entry) => {
                try {
                    const user = await this.client.users.fetch(entry.user_id);
                    return {
                        ...entry,
                        username: user.username,
                        discriminator: user.discriminator,
                        avatar: user.displayAvatarURL({ format: 'png', size: 128 })
                    };
                } catch (err) {
                    return {
                        ...entry,
                        username: 'Unknown User',
                        discriminator: '0000',
                        avatar: 'https://cdn.discordapp.com/embed/avatars/0.png'
                    };
                }
            })
        );

        // Render HTML
        const html = this.generateLeaderboardHTML(guildName, guildIcon, enrichedLeaderboard);
        res.send(html);
    }

    /**
     * Generate leaderboard HTML with Tailwind CSS
     */
    generateLeaderboardHTML(guildName, guildIcon, leaderboard) {
        return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${guildName} - XP Leaderboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body {
            background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%);
            min-height: 100vh;
        }
        .progress-bar-fill {
            background: linear-gradient(90deg, #00d4ff 0%, #00ff88 50%, #00d4ff 100%);
            transition: width 0.3s ease;
        }
        .leaderboard-entry {
            transition: all 0.2s ease;
        }
        .leaderboard-entry:hover {
            transform: translateX(5px);
            box-shadow: 0 0 20px rgba(0, 212, 255, 0.3);
        }
        .rank-badge {
            background: linear-gradient(135deg, #00d4ff 0%, #0099cc 100%);
        }
        .top-3 {
            border-left: 3px solid #00d4ff;
        }
    </style>
</head>
<body class="text-gray-100">
    <div class="container mx-auto px-4 py-8 max-w-6xl">
        <!-- Header -->
        <div class="text-center mb-12">
            ${guildIcon ? `<img src="${guildIcon}" alt="Server Icon" class="w-24 h-24 rounded-full mx-auto mb-4 ring-4 ring-cyan-500/50">` : ''}
            <h1 class="text-5xl font-bold mb-2 bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                ${this.escapeHtml(guildName)}
            </h1>
            <p class="text-gray-400 text-lg">XP Leaderboard</p>
        </div>

        <!-- Stats Overview -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div class="bg-gray-800/50 rounded-xl p-6 text-center border border-gray-700">
                <div class="text-4xl font-bold text-cyan-400">${leaderboard.length}</div>
                <div class="text-gray-400 mt-2">Total Members</div>
            </div>
            <div class="bg-gray-800/50 rounded-xl p-6 text-center border border-gray-700">
                <div class="text-4xl font-bold text-green-400">${leaderboard[0] ? this.formatNumber(leaderboard[0].xp) : '0'}</div>
                <div class="text-gray-400 mt-2">Top XP</div>
            </div>
            <div class="bg-gray-800/50 rounded-xl p-6 text-center border border-gray-700">
                <div class="text-4xl font-bold text-purple-400">${leaderboard[0] ? leaderboard[0].level : '0'}</div>
                <div class="text-gray-400 mt-2">Highest Level</div>
            </div>
        </div>

        <!-- Leaderboard -->
        <div class="bg-gray-800/30 rounded-2xl border border-gray-700/50 overflow-hidden backdrop-blur-sm">
            <div class="p-6 border-b border-gray-700">
                <h2 class="text-2xl font-bold">Overall XP Rankings</h2>
            </div>
            
            <div class="divide-y divide-gray-700/50">
                ${leaderboard.map((entry, index) => this.generateLeaderboardEntry(entry, index)).join('')}
            </div>
        </div>

        <!-- Footer -->
        <div class="text-center mt-12 text-gray-500">
            <p>Last updated: ${new Date().toLocaleString()}</p>
        </div>
    </div>
</body>
</html>`;
    }

    /**
     * Generate individual leaderboard entry HTML
     */
    generateLeaderboardEntry(entry, index) {
        const isTop3 = entry.rank <= 3;
        const progressPercent = entry.progress_percent;

        return `
        <div class="leaderboard-entry p-6 flex items-center gap-6 bg-gray-900/20 hover:bg-gray-900/40 ${isTop3 ? 'top-3' : ''}">
            <!-- Rank Badge -->
            <div class="rank-badge w-16 h-16 rounded-full flex items-center justify-center font-bold text-2xl flex-shrink-0 ${isTop3 ? 'ring-4 ring-cyan-500/50' : 'bg-gray-700'}">
                ${entry.rank}
            </div>

            <!-- Avatar -->
            <img src="${entry.avatar}" alt="${entry.username}" class="w-16 h-16 rounded-full flex-shrink-0 ring-2 ring-gray-600">

            <!-- User Info -->
            <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-3">
                        <h3 class="text-xl font-bold truncate">@${this.escapeHtml(entry.username)}</h3>
                        <span class="text-cyan-400 font-bold text-lg">LVL: ${entry.level}</span>
                    </div>
                    <div class="text-right">
                        <div class="text-sm text-gray-400">${this.formatNumber(entry.xp)} XP</div>
                        <div class="text-xs text-gray-500">${this.formatNumber(entry.total_messages)} messages</div>
                    </div>
                </div>

                <!-- Progress Bar -->
                <div class="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                    <div class="progress-bar-fill h-full rounded-full" style="width: ${progressPercent}%"></div>
                </div>
                <div class="text-xs text-gray-500 mt-1">
                    ${this.formatNumber(entry.xp_progress)} / ${this.formatNumber(entry.xp_needed)} XP to next level (${progressPercent}%)
                </div>
            </div>
        </div>`;
    }

    /**
     * Format number with commas
     */
    formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    /**
     * Start the web server
     */
    start() {
        return new Promise((resolve, reject) => {
            try {
                this.server = this.app.listen(this.port, () => {
                    console.log(`✅ Web dashboard running on http://localhost:${this.port}`);
                    resolve();
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Stop the web server
     */
    stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    console.log('✅ Web dashboard stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = WebDashboard;
