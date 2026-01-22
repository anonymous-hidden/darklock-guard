const fs = require('fs');
const path = require('path');

function latestBackupDir(base) {
  const dirs = fs.readdirSync(base).map(name => ({ name, p: path.join(base, name) }))
    .filter(x => fs.statSync(x.p).isDirectory())
    .sort((a,b) => b.name.localeCompare(a.name));
  return dirs[0]?.p || null;
}

(function main(){
  const backupBase = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupBase)) {
    console.error('No backups folder found.');
    process.exit(1);
  }
  const latest = latestBackupDir(backupBase);
  if (!latest) {
    console.error('No backup directories found.');
    process.exit(1);
  }
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const files = fs.readdirSync(latest);
  for (const f of files) {
    const src = path.join(latest, f);
    const out = path.join(dataDir, f);
    fs.copyFileSync(src, out);
    console.log(`Restored ${src} -> ${out}`);
  }
  console.log('Restore complete.');
})();
