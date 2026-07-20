#!/usr/bin/env node
const { execSync } = require('node:child_process');

const forbiddenPatterns = [
  /(^|\/)\.env($|\.)/i,
  /\.keystore$/i,
  /\.jks$/i,
  /\.p12$/i,
  /(^|\/).*\.(pem|key|crt)$/i,
  /\.sqlite3?$/i,
  /\.db$/i,
];

const allowed = new Set([
  '.env.example',
]);

function isForbidden(path) {
  if (allowed.has(path)) return false;
  return forbiddenPatterns.some((re) => re.test(path));
}

function main() {
  let tracked = '';
  try {
    tracked = execSync('git ls-files', { encoding: 'utf8' });
  } catch (err) {
    console.error('[check-no-secrets] failed to list tracked files');
    process.exit(1);
  }

  const hits = tracked
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(isForbidden);

  if (hits.length > 0) {
    console.error('[check-no-secrets] Forbidden tracked files detected:');
    for (const f of hits) console.error(` - ${f}`);
    process.exit(1);
  }

  console.log('[check-no-secrets] OK');
}

main();
