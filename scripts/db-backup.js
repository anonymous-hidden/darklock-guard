const fs = require('fs');
const path = require('path');

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

(function main(){
  const dataDir = path.join(process.cwd(), 'data');
  ensureDir(dataDir);
  const backupDir = path.join(process.cwd(), 'backups');
  ensureDir(backupDir);

  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.sqlite') || f.endsWith('.db'));
  if (files.length === 0) {
    console.log('No database files found in data/.');
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const dest = path.join(backupDir, `db-backup-${stamp}`);
  ensureDir(dest);
  for (const f of files) {
    const src = path.join(dataDir, f);
    const out = path.join(dest, f);
    fs.copyFileSync(src, out);
    console.log(`Backed up ${src} -> ${out}`);
  }
  console.log('Backup complete.');
})();
