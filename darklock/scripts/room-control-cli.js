#!/usr/bin/env node
/**
 * Room Control - admin CLI
 * =========================
 *
 *   node darklock/scripts/room-control-cli.js gen [--label="for Alex"]   # generate a password
 *   node darklock/scripts/room-control-cli.js list                        # list passwords (no plaintext)
 *   node darklock/scripts/room-control-cli.js revoke <id>                 # revoke a password
 *   node darklock/scripts/room-control-cli.js url                         # print the hidden URL slug
 *   node darklock/scripts/room-control-cli.js rotate-url                  # rotate the slug (invalidates URL)
 *   node darklock/scripts/room-control-cli.js logs [--limit=50]           # show recent action log
 *
 * The plaintext password is shown ONCE on `gen` -- it is bcrypt-hashed in DB.
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const db = require('../utils/database');
const store = require('../utils/room-control-store');

function parseArgs(argv) {
    const positional = [];
    const flags = {};
    for (const a of argv) {
        if (a.startsWith('--')) {
            const eq = a.indexOf('=');
            if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
            else flags[a.slice(2)] = true;
        } else {
            positional.push(a);
        }
    }
    return { positional, flags };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const cmd = args.positional[0];

    await db.initialize();
    await store.init();

    switch (cmd) {
        case 'gen': {
            const label = args.flags.label || null;
            const length = parseInt(args.flags.length, 10) || 250;
            const result = await store.createPassword({ length, label });
            const slug = await store.getSlug();
            const host = args.flags.host || process.env.DARKLOCK_PUBLIC_HOST || 'darklock.net';
            console.log('');
            console.log('============================================================');
            console.log(' NEW ROOM CONTROL PASSWORD');
            console.log('============================================================');
            console.log(' ID      :', result.id);
            console.log(' Length  :', result.length);
            if (label) console.log(' Label   :', label);
            console.log(' URL     : https://' + host + '/r/' + slug);
            console.log('');
            console.log(' PASSWORD (copy now -- not shown again):');
            console.log('');
            console.log(result.plain);
            console.log('');
            console.log(' Rules: first IP to redeem this password binds it.');
            console.log('        Sharing the password with another IP will fail.');
            console.log('============================================================');
            break;
        }
        case 'list': {
            const rows = await store.listActivePasswords();
            console.log(`Total: ${rows.length}`);
            for (const r of rows) {
                console.log(
                    `  #${r.id}  [${r.status.padEnd(8)}]  ${r.preview}  len=${r.length}  ` +
                    `created=${r.created_at}` +
                    (r.label ? `  label="${r.label}"` : '') +
                    (r.claimed_ip ? `  ip=${r.claimed_ip} user=${r.claimed_username || '-'}` : '')
                );
            }
            break;
        }
        case 'revoke': {
            const id = parseInt(args.positional[1], 10);
            if (!id) { console.error('usage: revoke <id>'); process.exit(1); }
            await store.revokePassword(id);
            console.log(`Password #${id} revoked.`);
            break;
        }
        case 'url': {
            const slug = await store.getSlug();
            const host = args.flags.host || process.env.DARKLOCK_PUBLIC_HOST || 'darklock.net';
            console.log('https://' + host + '/r/' + slug);
            break;
        }
        case 'rotate-url': {
            const slug = await store.rotateSlug();
            console.log('New slug:', slug);
            console.log('All existing bookmarks are now broken. Re-share the new URL.');
            break;
        }
        case 'logs': {
            const limit = parseInt(args.flags.limit, 10) || 50;
            const rows = await store.recentLogs(limit);
            for (const r of rows.reverse()) {
                const ok = r.success ? 'OK ' : 'ERR';
                console.log(
                    `[${r.created_at}] ${ok}  ${(r.username || '?').padEnd(16)} ` +
                    `${r.ip.padEnd(15)}  ${r.action}  ${r.params || ''}`
                );
            }
            break;
        }
        default:
            console.log('Commands: gen [--label=... --length=250] | list | revoke <id> | url | rotate-url | logs [--limit=N]');
    }

    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
