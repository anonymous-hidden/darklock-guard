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
     * Generate leaderboard HTML - polished DarkLock design
     */
    generateLeaderboardHTML(guildName, guildIcon, leaderboard) {
        const totalXp = leaderboard.reduce((sum, e) => sum + (e.xp || 0), 0);
        const avgLevel = leaderboard.length ? Math.round(leaderboard.reduce((s, e) => s + (e.level || 0), 0) / leaderboard.length) : 0;
        const top1 = leaderboard[0] || null;
        const top2 = leaderboard[1] || null;
        const top3 = leaderboard[2] || null;
        const rest  = leaderboard.slice(3);

        const podiumCard = (entry, rank) => {
            if (!entry) return '';
            const medals = { 1: { color: '#FFD700', glow: 'rgba(255,215,0,0.35)', icon: '👑', border: '#FFD700', labelColor: '#FFD700' },
                             2: { color: '#C0C0C0', glow: 'rgba(192,192,192,0.3)',  icon: '🥈', border: '#C0C0C0', labelColor: '#C0C0C0' },
                             3: { color: '#CD7F32', glow: 'rgba(205,127,50,0.3)',   icon: '🥉', border: '#CD7F32', labelColor: '#CD7F32' } };
            const m = medals[rank];
            const order = rank === 1 ? 'order-2' : rank === 2 ? 'order-1' : 'order-3';
            const scale = rank === 1 ? 'scale-y-100' : 'scale-y-90 mt-6';
            return `
            <div class="podium-card ${order} flex flex-col items-center gap-3 px-4 py-6 rounded-2xl relative" style="background:rgba(255,255,255,0.03);border:1px solid ${m.border}30;box-shadow:0 4px 40px ${m.glow};">
                <div class="absolute -top-4 text-3xl">${m.icon}</div>
                <div class="relative">
                    <img src="${entry.avatar}" alt="${this.escapeHtml(entry.username)}" class="w-20 h-20 rounded-full object-cover" style="border:3px solid ${m.color};box-shadow:0 0 20px ${m.glow};">
                    <div class="absolute -bottom-2 -right-2 w-8 h-8 rounded-full flex items-center justify-center text-sm font-black text-black" style="background:${m.color};">${rank}</div>
                </div>
                <div class="text-center mt-2">
                    <div class="font-bold text-lg truncate max-w-[140px]" title="${this.escapeHtml(entry.username)}" style="color:${m.labelColor};">${this.escapeHtml(entry.username)}</div>
                    <div class="text-xs mt-1" style="color:rgba(255,255,255,0.5);">Level ${entry.level}</div>
                </div>
                <div class="text-center">
                    <div class="font-black text-xl" style="color:${m.color};">${this.formatNumber(entry.xp)}</div>
                    <div class="text-xs" style="color:rgba(255,255,255,0.4);">total XP</div>
                </div>
                <!-- mini progress -->
                <div class="w-full rounded-full overflow-hidden" style="height:4px;background:rgba(255,255,255,0.08);">
                    <div style="height:100%;width:${entry.progress_percent || 0}%;background:${m.color};border-radius:9999px;transition:width .6s ease;"></div>
                </div>
            </div>`;
        };

        const rowEntry = (entry) => {
            const rankColor = entry.rank <= 10 ? '#00d4ff' : 'rgba(255,255,255,0.35)';
            return `
            <div class="lb-row group flex items-center gap-4 px-6 py-4 rounded-xl transition-all duration-200" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);">
                <!-- rank -->
                <div class="w-9 text-center flex-shrink-0">
                    <span class="text-base font-black" style="color:${rankColor};">#${entry.rank}</span>
                </div>
                <!-- avatar -->
                <img src="${entry.avatar}" alt="${this.escapeHtml(entry.username)}" class="w-11 h-11 rounded-full flex-shrink-0 object-cover" style="border:2px solid rgba(0,212,255,0.2);">
                <!-- name + bar -->
                <div class="flex-1 min-w-0">
                    <div class="flex items-baseline gap-2 mb-1.5">
                        <span class="font-semibold truncate text-sm" style="color:rgba(255,255,255,0.9);">${this.escapeHtml(entry.username)}</span>
                        <span class="text-xs font-bold flex-shrink-0" style="color:#00d4ff;">Lv.${entry.level}</span>
                    </div>
                    <div class="w-full rounded-full overflow-hidden" style="height:5px;background:rgba(255,255,255,0.07);">
                        <div class="xp-bar" style="height:100%;width:0%;border-radius:9999px;transition:width .8s ease;background:linear-gradient(90deg,#00d4ff,#7c3aed);" data-width="${entry.progress_percent || 0}"></div>
                    </div>
                </div>
                <!-- xp + msgs -->
                <div class="text-right flex-shrink-0 hidden sm:block">
                    <div class="text-sm font-bold" style="color:rgba(255,255,255,0.85);">${this.formatNumber(entry.xp)} <span style="color:rgba(255,255,255,0.3);font-weight:400;">XP</span></div>
                    <div class="text-xs" style="color:rgba(255,255,255,0.3);">${this.formatNumber(entry.total_messages || 0)} msgs</div>
                </div>
            </div>`;
        };

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.escapeHtml(guildName)} — Leaderboard</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
    <style>
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        :root{
            --bg:#07070f;
            --surface:rgba(255,255,255,0.03);
            --border:rgba(255,255,255,0.07);
            --accent:#00d4ff;
            --purple:#7c3aed;
            --text:rgba(255,255,255,0.87);
            --muted:rgba(255,255,255,0.4);
        }
        html{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;}
        body{min-height:100vh;overflow-x:hidden;}

        /* animated bg mesh */
        .bg-mesh{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;}
        .bg-mesh::before{
            content:'';position:absolute;inset:-50%;
            background:
                radial-gradient(ellipse 60% 50% at 20% 20%, rgba(0,212,255,0.07) 0%, transparent 60%),
                radial-gradient(ellipse 50% 60% at 80% 80%, rgba(124,58,237,0.07) 0%, transparent 60%),
                radial-gradient(ellipse 40% 40% at 60% 10%, rgba(0,255,136,0.04) 0%, transparent 50%);
            animation:meshMove 20s ease-in-out infinite alternate;
        }
        @keyframes meshMove{from{transform:scale(1) rotate(0deg);}to{transform:scale(1.1) rotate(6deg);}}

        /* layout */
        .page{position:relative;z-index:1;max-width:860px;margin:0 auto;padding:40px 20px 80px;}

        /* header */
        .header{display:flex;flex-direction:column;align-items:center;gap:14px;margin-bottom:48px;text-align:center;}
        .guild-icon{width:88px;height:88px;border-radius:50%;object-fit:cover;border:3px solid rgba(0,212,255,0.35);box-shadow:0 0 40px rgba(0,212,255,0.2);}
        .guild-icon-placeholder{width:88px;height:88px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:36px;background:linear-gradient(135deg,rgba(0,212,255,0.15),rgba(124,58,237,0.15));border:3px solid rgba(0,212,255,0.35);}
        .guild-name{font-size:clamp(26px,5vw,40px);font-weight:900;background:linear-gradient(135deg,#fff 30%,var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1.1;}
        .header-sub{font-size:15px;color:var(--muted);letter-spacing:.04em;display:flex;align-items:center;gap:8px;}
        .dot{width:5px;height:5px;border-radius:50%;background:var(--accent);display:inline-block;}

        /* stat cards */
        .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:40px;}
        .stat-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:20px 16px;text-align:center;}
        .stat-value{font-size:clamp(22px,4vw,30px);font-weight:900;margin-bottom:4px;}
        .stat-label{font-size:12px;color:var(--muted);font-weight:500;letter-spacing:.05em;text-transform:uppercase;}

        /* section title */
        .section-title{font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:16px;display:flex;align-items:center;gap:10px;}
        .section-title::after{content:'';flex:1;height:1px;background:var(--border);}

        /* podium */
        .podium{display:flex;align-items:flex-end;justify-content:center;gap:14px;margin-bottom:40px;flex-wrap:wrap;}
        .podium-card{flex:1;min-width:140px;max-width:200px;}
        .podium-card.order-1{order:1;}
        .podium-card.order-2{order:2;}
        .podium-card.order-3{order:3;}

        /* list */
        .lb-list{display:flex;flex-direction:column;gap:7px;}
        .lb-row{cursor:default;}
        .lb-row:hover{background:rgba(0,212,255,0.05) !important;border-color:rgba(0,212,255,0.2) !important;transform:translateX(3px);}

        /* footer */
        .footer{text-align:center;margin-top:56px;color:var(--muted);font-size:13px;display:flex;flex-direction:column;align-items:center;gap:8px;}
        .footer-brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;color:rgba(255,255,255,0.6);}
        .footer-brand span{color:var(--accent);}

        /* empty */
        .empty{text-align:center;padding:60px 20px;color:var(--muted);}
        .empty-icon{font-size:52px;margin-bottom:16px;}

        @media(max-width:520px){
            .stats{grid-template-columns:repeat(3,1fr);}
            .stat-value{font-size:20px;}
            .podium{gap:8px;}
            .podium-card{min-width:110px;}
        }
    </style>
</head>
<body>
<div class="bg-mesh"></div>
<div class="page">

    <!-- Header -->
    <div class="header">
        ${guildIcon
            ? `<img src="${guildIcon}" alt="Server Icon" class="guild-icon">`
            : `<div class="guild-icon-placeholder">🛡️</div>`}
        <div class="guild-name">${this.escapeHtml(guildName)}</div>
        <div class="header-sub"><span class="dot"></span> XP Leaderboard <span class="dot"></span></div>
    </div>

    <!-- Stats -->
    <div class="stats">
        <div class="stat-card">
            <div class="stat-value" style="color:#00d4ff;">${leaderboard.length.toLocaleString()}</div>
            <div class="stat-label">Members Ranked</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" style="color:#00ff88;">${top1 ? 'Lv.' + top1.level : '—'}</div>
            <div class="stat-label">Top Level</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" style="color:#a78bfa;">${this.formatCompact(totalXp)}</div>
            <div class="stat-label">Total XP Earned</div>
        </div>
    </div>

    ${leaderboard.length === 0 ? `
    <div class="empty">
        <div class="empty-icon">📊</div>
        <div style="font-size:18px;font-weight:700;margin-bottom:8px;">No rankings yet</div>
        <div>Start chatting to earn XP and appear on the leaderboard!</div>
    </div>` : `

    <!-- Podium (top 3) -->
    ${(top1 || top2 || top3) ? `
    <div class="section-title">Top Performers</div>
    <div class="podium">
        ${podiumCard(top2, 2)}
        ${podiumCard(top1, 1)}
        ${podiumCard(top3, 3)}
    </div>` : ''}

    <!-- Rest of rankings -->
    ${rest.length > 0 ? `
    <div class="section-title">Rankings</div>
    <div class="lb-list">
        ${rest.map(e => rowEntry(e)).join('')}
    </div>` : ''}
    `}

    <!-- Footer -->
    <div class="footer">
        <div class="footer-brand">🛡️ Powered by <span>DarkLock</span></div>
        <div>Updated ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
    </div>

</div>
<script>
    // Animate XP bars on load
    requestAnimationFrame(() => {
        setTimeout(() => {
            document.querySelectorAll('.xp-bar').forEach(bar => {
                bar.style.width = bar.dataset.width + '%';
            });
        }, 120);
    });
</script>
</body>
</html>`;
    }

    /**
     * Format number with commas
     */
    formatNumber(num) {
        return (num || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    /**
     * Format large numbers compactly (e.g. 12400 → 12.4K)
     */
    formatCompact(num) {
        if (!num) return '0';
        if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
        return num.toString();
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
