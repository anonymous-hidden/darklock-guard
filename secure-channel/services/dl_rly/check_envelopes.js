const Database = require('better-sqlite3');
const db = new Database('/home/cayden/discord bot/discord bot/secure-channel/services/dl_rly/data/rly.db');
const rows = db.prepare("SELECT id, sender_id, recipient_id, ciphertext FROM envelopes ORDER BY created_at ASC").all();
console.log('Total:', rows.length);
for (const row of rows) {
  try {
    const env = JSON.parse(row.ciphertext);
    console.log({
      relay_id: row.id.slice(0,8),
      sender: row.sender_id.slice(0,8),
      recipient: row.recipient_id.slice(0,8),
      session_id: env.session_id ? env.session_id.slice(0,8) : null,
      has_x3dh: !!env.x3dh_header,
      ratchet_n: env.ratchet_header ? env.ratchet_header.n : null,
    });
  } catch(e) {
    console.log('PARSE FAIL:', row.id.slice(0,8), e.message);
  }
}
