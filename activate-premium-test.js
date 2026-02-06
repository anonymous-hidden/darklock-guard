/**
 * Manually Activate Premium for Testing
 * Use this script to activate premium without Stripe webhooks in test mode
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'security_bot.db');
const db = new sqlite3.Database(dbPath);

// User ID to activate premium for
const USER_ID = '1158225052840509531'; // niceman69400000
const GUILD_ID = '1398384429079986306'; // Your test guild

console.log('🔧 Activating Premium for Testing...');
console.log(`User ID: ${USER_ID}`);
console.log(`Guild ID: ${GUILD_ID}`);

const now = Math.floor(Date.now() / 1000);
const oneYearFromNow = now + (365 * 24 * 60 * 60);

// Step 1: Check/ensure user exists in users table
db.get(
    `SELECT * FROM users WHERE discord_id = ?`,
    [USER_ID],
    (err, user) => {
        if (err) {
            console.error('❌ Error checking user:', err);
            db.close();
            return;
        }

        const userEmail = user?.email || 'test@darklock.net';
        console.log(`📧 User email: ${userEmail}`);

        // Step 2: Create or update user record
        if (!user) {
            console.log('Creating user record...');
            db.run(
                `INSERT INTO users (discord_id, email, is_pro, created_at) VALUES (?, ?, 1, ?)`,
                [USER_ID, userEmail, now],
                (err) => {
                    if (err) console.warn('User creation error:', err);
                }
            );
        } else {
            console.log('Updating user to premium...');
            db.run(
                `UPDATE users SET is_pro = 1 WHERE discord_id = ?`,
                [USER_ID],
                (err) => {
                    if (err) console.warn('User update error:', err);
                }
            );
        }

        // Step 3: Check existing subscription
        db.get(
            `SELECT * FROM stripe_subscriptions WHERE user_id = ? OR customer_email = ?`,
            [USER_ID, userEmail],
            (err, row) => {
                if (err) {
                    console.error('❌ Error checking subscription:', err);
                    db.close();
                    return;
                }

                if (row) {
                    console.log('\n✓ Existing subscription found:', row.subscription_id);
                    console.log('Updating to active...');
                    
                    db.run(
                        `UPDATE stripe_subscriptions 
                         SET status = 'active', 
                             plan_type = 'yearly',
                             current_period_end = ?,
                             updated_at = ?
                         WHERE subscription_id = ?`,
                        [oneYearFromNow, now, row.subscription_id],
                        (err) => {
                            if (err) {
                                console.error('❌ Error updating subscription:', err);
                            } else {
                                console.log('\n✅ Premium activated successfully!');
                                console.log('📅 Expires:', new Date(oneYearFromNow * 1000).toLocaleDateString());
                                console.log('\n🔄 Please refresh your dashboard to see premium features unlocked.');
                            }
                            db.close();
                        }
                    );
                } else {
                    console.log('\n⚠️ No subscription found, creating new subscription...');
                    
                    db.run(
                        `INSERT INTO stripe_subscriptions 
                         (subscription_id, customer_id, customer_email, user_id, status, plan_type, current_period_start, current_period_end, guild_id, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            'sub_test_' + Date.now(),
                            'cus_test_' + Date.now(),
                            userEmail,
                            USER_ID,
                            'active',
                            'yearly',
                            now,
                            oneYearFromNow,
                            GUILD_ID,
                            now,
                            now
                        ],
                        (err) => {
                            if (err) {
                                console.error('❌ Error creating subscription:', err);
                            } else {
                                console.log('\n✅ Premium activated successfully!');
                                console.log('📅 Expires:', new Date(oneYearFromNow * 1000).toLocaleDateString());
                                console.log('\n🔄 Please refresh your dashboard to see premium features unlocked.');
                            }
                            db.close();
                        }
                    );
                }
            }
        );
    }
);
