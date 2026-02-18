#!/bin/bash
echo "=== CHECKING MAINTENANCE ENABLED STATUS ==="
python3 -c "
import sqlite3
conn = sqlite3.connect('/home/cayden/discord bot/discord bot/darklock/data/darklock.db')
cur = conn.cursor()
cur.execute('SELECT scope, enabled, updated_at FROM maintenance_state ORDER BY scope')
rows = cur.fetchall()
print()
for scope, enabled, updated in rows:
    status = '✅ ENABLED' if enabled == 1 else '❌ DISABLED'
    print(f'{scope:20} {status:15} (updated: {updated})')
print()
conn.close()
"
