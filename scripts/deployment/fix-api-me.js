const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/dashboard/dashboard.js');
let content = fs.readFileSync(filePath, 'utf8');

// Find and replace the /api/me endpoint to fetch fresh role from DB
const oldPattern = /this\.app\.get\('\/api\/me', \(req, res\) => \{[\s\S]*?\/\/ authenticateToken middleware[\s\S]*?res\.json\(\{[\s\S]*?role: req\.user\.role \|\| 'viewer'[\s\S]*?\}\);[\s\S]*?\}\);/;

const newCode = `this.app.get('/api/me', async (req, res) => {
            // authenticateToken middleware already applied via /api/* route above
            console.log('[/api/me] REQUEST - User:', req.user?.username);
            
            // Fetch fresh role from database (in case it was updated after login)
            let freshRole = req.user.role || 'viewer';
            try {
                const dbUser = await this.bot.database.get(
                    'SELECT role FROM admin_users WHERE username = ?',
                    [req.user.username?.toLowerCase()]
                );
                if (dbUser && dbUser.role) {
                    freshRole = dbUser.role;
                    console.log('[/api/me] Fresh role from DB:', freshRole);
                }
            } catch (e) {
                console.warn('[/api/me] Could not fetch fresh role:', e.message);
            }
            
            res.json({
                success: true,
                user: {
                    id: req.user.userId,
                    userId: req.user.userId,
                    username: req.user.username,
                    globalName: req.user.globalName,
                    avatar: req.user.avatar,
                    role: freshRole,
                    guilds: req.user.guilds || []
                }
            });
        })`;

if (oldPattern.test(content)) {
    content = content.replace(oldPattern, newCode);
    fs.writeFileSync(filePath, content);
    console.log('✅ Successfully updated /api/me endpoint to fetch fresh role from DB');
} else {
    console.log('❌ Could not find the /api/me endpoint pattern');
    // Try a simpler replacement
    const simpleOld = "role: req.user.role || 'viewer'";
    const simpleNew = "role: freshRole";
    if (content.includes(simpleOld)) {
        console.log('Found simple pattern, but need full replacement');
    }
}
