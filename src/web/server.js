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
            const medals = {
                1: { color: '#FFD700', glow: 'rgba(255,215,0,0.25)', glowStrong: 'rgba(255,215,0,0.12)', icon: '👑', grad: 'linear-gradient(135deg, rgba(255,215,0,0.15) 0%, rgba(255,180,0,0.05) 100%)', border: 'rgba(255,215,0,0.3)', labelColor: '#FFD700' },
                2: { color: '#C0C0C0', glow: 'rgba(192,192,192,0.2)', glowStrong: 'rgba(192,192,192,0.08)', icon: '🥈', grad: 'linear-gradient(135deg, rgba(192,192,192,0.1) 0%, rgba(160,160,160,0.04) 100%)', border: 'rgba(192,192,192,0.25)', labelColor: '#d4d4d4' },
                3: { color: '#CD7F32', glow: 'rgba(205,127,50,0.2)', glowStrong: 'rgba(205,127,50,0.08)', icon: '🥉', grad: 'linear-gradient(135deg, rgba(205,127,50,0.12) 0%, rgba(180,100,30,0.04) 100%)', border: 'rgba(205,127,50,0.25)', labelColor: '#e0a060' }
            };
            const m = medals[rank];
            const order = rank === 1 ? 'order-2' : rank === 2 ? 'order-1' : 'order-3';
            const lift = rank === 1 ? '' : 'margin-top:24px;';
            const avatarSize = rank === 1 ? 104 : 88;
            const avatarClass = rank === 1 ? 'w-[104px] h-[104px]' : 'w-[88px] h-[88px]';
            return `
            <div class="podium-card ${order}" style="${lift}">
                <div class="podium-inner">
                    <div class="podium-glow" style="background:radial-gradient(circle at 50% 0%, ${m.glowStrong} 0%, transparent 70%);"></div>
                    <div class="podium-content" style="background:${m.grad};border:1px solid ${m.border};backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);">
                        <div class="podium-medal">${m.icon}</div>
                        <div class="podium-avatar-wrap" style="width:${avatarSize}px;height:${avatarSize}px;">
                            <img src="${entry.avatar}" alt="${this.escapeHtml(entry.username)}" class="${avatarClass} rounded-full object-cover" style="border:3px solid ${m.color};box-shadow:0 0 20px ${m.glow}, 0 0 60px ${m.glowStrong};">
                            <div class="podium-rank-badge" style="background:${m.color};box-shadow:0 2px 8px ${m.glow};">${rank}</div>
                        </div>
                        <div class="podium-info">
                            <div class="podium-username" title="${this.escapeHtml(entry.username)}" style="color:${m.labelColor};">${this.escapeHtml(entry.username)}</div>
                            <div class="podium-level">Level ${entry.level}</div>
                        </div>
                        <div class="podium-xp-block">
                            <div class="podium-xp-value" style="color:${m.color};">${this.formatNumber(entry.xp)}</div>
                            <div class="podium-xp-label">XP</div>
                        </div>
                        <div class="podium-bar-track">
                            <div class="podium-bar-fill" style="width:${entry.progress_percent || 0}%;background:linear-gradient(90deg, ${m.color}, ${m.color}88);"></div>
                        </div>
                    </div>
                </div>
            </div>`;
        };

        const rowEntry = (entry) => {
            const isTop10 = entry.rank <= 10;
            const rankColor = isTop10 ? '#00d4ff' : 'rgba(255,255,255,0.35)';
            const accentBorder = isTop10 ? 'rgba(0,212,255,0.12)' : 'rgba(255,255,255,0.04)';
            return `
            <div class="lb-row" style="border-left:3px solid ${accentBorder};">
                <div class="lb-row-rank" style="color:${rankColor};">#${entry.rank}</div>
                <div class="lb-row-avatar-wrap">
                    <img src="${entry.avatar}" alt="${this.escapeHtml(entry.username)}" class="lb-row-avatar" style="border-color:${isTop10 ? 'rgba(0,212,255,0.3)' : 'rgba(255,255,255,0.08)'};">
                </div>
                <div class="lb-row-info">
                    <div class="lb-row-name-line">
                        <span class="lb-row-name">${this.escapeHtml(entry.username)}</span>
                        <span class="lb-row-level">Lv.${entry.level}</span>
                    </div>
                    <div class="lb-row-bar-track">
                        <div class="xp-bar lb-row-bar-fill" data-width="${entry.progress_percent || 0}"></div>
                    </div>
                </div>
                <div class="lb-row-stats">
                    <div class="lb-row-xp">${this.formatNumber(entry.xp)} <span class="lb-row-xp-label">XP</span></div>
                    <div class="lb-row-msgs">${this.formatNumber(entry.total_messages || 0)} msgs</div>
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
            --bg:#06060e;
            --surface:rgba(255,255,255,0.025);
            --border:rgba(255,255,255,0.06);
            --accent:#00d4ff;
            --purple:#7c3aed;
            --text:rgba(255,255,255,0.88);
            --muted:rgba(255,255,255,0.4);
        }
        html{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;}
        body{min-height:100vh;overflow-x:hidden;}

        /* animated bg mesh */
        .bg-mesh{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;}
        .bg-mesh::before{
            content:'';position:absolute;inset:-50%;
            background:
                radial-gradient(ellipse 60% 50% at 20% 20%, rgba(0,212,255,0.06) 0%, transparent 60%),
                radial-gradient(ellipse 50% 60% at 80% 80%, rgba(124,58,237,0.06) 0%, transparent 60%),
                radial-gradient(ellipse 40% 40% at 60% 10%, rgba(0,255,136,0.03) 0%, transparent 50%);
            animation:meshMove 22s ease-in-out infinite alternate;
        }
        @keyframes meshMove{from{transform:scale(1) rotate(0deg);}to{transform:scale(1.08) rotate(4deg);}}

        /* layout */
        .page{position:relative;z-index:1;max-width:880px;margin:0 auto;padding:48px 24px 80px;}

        /* header */
        .header{display:flex;flex-direction:column;align-items:center;gap:14px;margin-bottom:48px;text-align:center;}
        .guild-icon{width:88px;height:88px;border-radius:50%;object-fit:cover;border:3px solid rgba(0,212,255,0.3);box-shadow:0 0 40px rgba(0,212,255,0.15), 0 0 80px rgba(0,212,255,0.05);}
        .guild-icon-placeholder{width:88px;height:88px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:36px;background:linear-gradient(135deg,rgba(0,212,255,0.15),rgba(124,58,237,0.15));border:3px solid rgba(0,212,255,0.3);}
        .guild-name{font-size:clamp(26px,5vw,40px);font-weight:900;background:linear-gradient(135deg,#fff 30%,var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1.1;}
        .header-sub{font-size:14px;color:var(--muted);letter-spacing:.06em;display:flex;align-items:center;gap:8px;text-transform:uppercase;font-weight:600;}
        .dot{width:5px;height:5px;border-radius:50%;background:var(--accent);display:inline-block;box-shadow:0 0 6px var(--accent);}

        /* stat cards */
        .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:44px;}
        .stat-card{
            background:linear-gradient(135deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.01) 100%);
            border:1px solid rgba(255,255,255,0.06);
            border-radius:16px;padding:22px 16px;text-align:center;
            backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
            transition:transform .2s ease, border-color .2s ease;
        }
        .stat-card:hover{transform:translateY(-2px);border-color:rgba(255,255,255,0.12);}
        .stat-value{font-size:clamp(22px,4vw,30px);font-weight:900;margin-bottom:4px;}
        .stat-label{font-size:11px;color:var(--muted);font-weight:600;letter-spacing:.08em;text-transform:uppercase;}

        /* section title */
        .section-title{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:18px;display:flex;align-items:center;gap:12px;}
        .section-title::after{content:'';flex:1;height:1px;background:linear-gradient(90deg, var(--border), transparent);}

        /* ===== PODIUM ===== */
        .podium{display:flex;align-items:flex-end;justify-content:center;gap:20px;margin-bottom:48px;flex-wrap:wrap;}
        .podium-card{flex:1;min-width:180px;max-width:250px;}
        .podium-card.order-1{order:1;}
        .podium-card.order-2{order:2;}
        .podium-card.order-3{order:3;}
        .podium-inner{position:relative;border-radius:20px;overflow:visible;}
        .podium-glow{position:absolute;inset:-20px;border-radius:20px;pointer-events:none;z-index:0;filter:blur(20px);}
        .podium-content{
            position:relative;z-index:1;
            display:flex;flex-direction:column;align-items:center;gap:14px;
            padding:32px 20px 24px;border-radius:20px;
            transition:transform .3s ease, box-shadow .3s ease;
        }
        .podium-card:hover .podium-content{transform:translateY(-4px);box-shadow:0 12px 40px rgba(0,0,0,0.3);}
        .podium-medal{font-size:32px;margin-bottom:-4px;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.4));}
        .podium-avatar-wrap{position:relative;margin:0 auto;flex-shrink:0;}
        .podium-avatar-wrap img{display:block;width:100%;height:100%;object-fit:cover;border-radius:50%;}
        .podium-rank-badge{
            position:absolute;bottom:-4px;right:-4px;
            width:30px;height:30px;border-radius:50%;
            display:flex;align-items:center;justify-content:center;
            font-size:13px;font-weight:900;color:#000;
            border:2px solid rgba(0,0,0,0.3);
        }
        .podium-info{text-align:center;}
        .podium-username{font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px;}
        .podium-level{font-size:13px;color:rgba(255,255,255,0.45);margin-top:2px;font-weight:500;}
        .podium-xp-block{text-align:center;}
        .podium-xp-value{font-size:24px;font-weight:900;line-height:1;}
        .podium-xp-label{font-size:11px;color:rgba(255,255,255,0.35);font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-top:2px;}
        .podium-bar-track{width:100%;height:4px;border-radius:4px;background:rgba(255,255,255,0.06);overflow:hidden;}
        .podium-bar-fill{height:100%;border-radius:4px;transition:width .6s ease;}

        /* ===== ROW ENTRIES ===== */
        .lb-list{display:flex;flex-direction:column;gap:6px;}
        .lb-row{
            display:flex;align-items:center;gap:14px;
            padding:14px 18px;border-radius:14px;
            background:rgba(255,255,255,0.02);
            border:1px solid rgba(255,255,255,0.04);
            border-left:3px solid transparent;
            transition:all .2s ease;cursor:default;
        }
        .lb-row:hover{
            background:rgba(0,212,255,0.04);
            border-color:rgba(0,212,255,0.15);
            border-left-color:rgba(0,212,255,0.4) !important;
            transform:translateX(3px);
        }
        .lb-row-rank{width:36px;text-align:center;font-size:15px;font-weight:900;flex-shrink:0;}
        .lb-row-avatar-wrap{flex-shrink:0;width:44px;height:44px;}
        .lb-row-avatar{width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid;display:block;}
        .lb-row-info{flex:1;min-width:0;}
        .lb-row-name-line{display:flex;align-items:baseline;gap:8px;margin-bottom:6px;}
        .lb-row-name{font-weight:600;font-size:14px;color:rgba(255,255,255,0.9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .lb-row-level{font-size:12px;font-weight:700;color:#00d4ff;flex-shrink:0;}
        .lb-row-bar-track{width:100%;height:4px;border-radius:4px;background:rgba(255,255,255,0.06);overflow:hidden;}
        .lb-row-bar-fill{height:100%;width:0%;border-radius:4px;background:linear-gradient(90deg,#00d4ff,#7c3aed);transition:width .8s ease;}
        .lb-row-stats{text-align:right;flex-shrink:0;}
        .lb-row-xp{font-size:14px;font-weight:700;color:rgba(255,255,255,0.85);}
        .lb-row-xp-label{font-weight:400;color:rgba(255,255,255,0.3);font-size:12px;}
        .lb-row-msgs{font-size:11px;color:rgba(255,255,255,0.3);margin-top:2px;}
        @media(max-width:580px){.lb-row-stats{display:none;}}

        /* footer */
        .footer{text-align:center;margin-top:56px;color:var(--muted);font-size:13px;display:flex;flex-direction:column;align-items:center;gap:8px;}
        .footer-brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;color:rgba(255,255,255,0.6);}
        .footer-brand span{color:var(--accent);}

        /* empty */
        .empty{text-align:center;padding:60px 20px;color:var(--muted);}
        .empty-icon{font-size:52px;margin-bottom:16px;}

        /* entrance animation */
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
        .podium-card{animation:fadeUp .5s ease backwards;}
        .podium-card.order-1{animation-delay:.1s;}
        .podium-card.order-2{animation-delay:0s;}
        .podium-card.order-3{animation-delay:.2s;}
        .lb-row{animation:fadeUp .35s ease backwards;}
        .stat-card{animation:fadeUp .4s ease backwards;}
        .stat-card:nth-child(1){animation-delay:0s;}
        .stat-card:nth-child(2){animation-delay:.06s;}
        .stat-card:nth-child(3){animation-delay:.12s;}

        @media(max-width:520px){
            .stats{grid-template-columns:repeat(3,1fr);gap:8px;}
            .stat-value{font-size:20px;}
            .stat-card{padding:16px 10px;border-radius:12px;}
            .podium{gap:10px;}
            .podium-card{min-width:130px;}
            .podium-content{padding:24px 14px 18px;}
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
        }, 200);
    });
    // Stagger row animations
    document.querySelectorAll('.lb-row').forEach((row, i) => {
        row.style.animationDelay = (0.05 * i) + 's';
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
