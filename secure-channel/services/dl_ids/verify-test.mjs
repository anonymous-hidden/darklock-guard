import Database from 'better-sqlite3';
import * as crypto from 'crypto';

const fromB64u = (s) => Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'), 'base64');
const spkiHeader = Buffer.from('302a300506032b6570032100','hex');

const db = new Database('data/ids.db');
for (const u of db.prepare('SELECT id, username, identity_pubkey FROM users').all()) {
  const dev = db.prepare('SELECT device_id FROM devices WHERE user_id = ?').get(u.id);
  if (!dev) continue;
  const spk = db.prepare('SELECT spk_pubkey, spk_sig FROM signed_prekeys WHERE device_id = ?').get(dev.device_id);
  if (!spk) continue;

  const ikBuf  = fromB64u(u.identity_pubkey);
  const spkBuf = fromB64u(spk.spk_pubkey);
  const sigBuf = fromB64u(spk.spk_sig);

  console.log(`=== ${u.username}: ik=${ikBuf.length}B spk=${spkBuf.length}B sig=${sigBuf.length}B`);
  try {
    const pubKey = crypto.createPublicKey({ key: Buffer.concat([spkiHeader, ikBuf]), format: 'der', type: 'spki' });
    const ok = crypto.verify(null, spkBuf, pubKey, sigBuf);
    console.log(`  Signature valid: ${ok}`);
  } catch(e) {
    console.log(`  Error: ${e.message}`);
  }
}
db.close();
