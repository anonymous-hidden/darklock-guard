/**
 * Add test team member
 */

const db = require('./darklock/utils/database');

async function addTestMember() {
    try {
        await db.initialize();
        
        const email = 'admin@darklock.net';
        const username = 'Cayden';
        const role = 'owner';
        const discordId = '123456789';
        const now = new Date().toISOString();
        
        // Check if already exists
        const existing = await db.get('SELECT * FROM team_members WHERE email = ?', [email]);
        if (existing) {
            console.log('✅ Team member already exists:', email);
        } else {
            await db.run(
                'INSERT INTO team_members (email, username, role, discord_id, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)',
                [email, username, role, discordId, 'system', now]
            );
            console.log('✅ Added test team member:', email, 'as', role);
        }
        
        // Verify
        const members = await db.all('SELECT * FROM team_members');
        console.log(`\n📊 Total team members: ${members.length}`);
        members.forEach(m => {
            console.log(`   - ${m.username} (${m.email}) - ${m.role}`);
        });
        
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

addTestMember();
