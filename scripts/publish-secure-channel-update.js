#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const appPkgPath = path.join(rootDir, 'secure-channel', 'apps', 'dl-secure-channel', 'package.json');

function getManifestPath(channel) {
  return path.join(
    rootDir,
    'darklock',
    'data',
    channel === 'beta' ? 'secure-channel-version-beta.json' : 'secure-channel-version.json',
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function parseArgs(argv) {
  const out = {
    version: '',
    channel: 'stable',
    releaseDate: new Date().toISOString().slice(0, 10),
    downloadUrl: 'https://admin.darklock.net/platform/download/secure-channel',
    changelog: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--version' || arg === '-v') {
      out.version = String(argv[i + 1] || '').trim();
      i += 1;
    } else if (arg === '--channel' || arg === '-c') {
      out.channel = String(argv[i + 1] || '').trim().toLowerCase();
      i += 1;
    } else if (arg === '--beta') {
      out.channel = 'beta';
    } else if (arg === '--stable') {
      out.channel = 'stable';
    } else if (arg === '--date' || arg === '-d') {
      out.releaseDate = String(argv[i + 1] || '').trim();
      i += 1;
    } else if (arg === '--download-url' || arg === '-u') {
      out.downloadUrl = String(argv[i + 1] || '').trim();
      i += 1;
    } else if (arg === '--changelog' || arg === '--note' || arg === '-n') {
      const note = String(argv[i + 1] || '').trim();
      if (note) out.changelog.push(note);
      i += 1;
    }
  }

  return out;
}

function isSemver(v) {
  return /^\d+\.\d+\.\d+$/.test(v);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!['stable', 'beta'].includes(args.channel)) {
    console.error('[publish-secure-channel-update] Invalid channel. Use stable or beta.');
    process.exit(1);
  }

  const manifestPath = getManifestPath(args.channel);

  if (!args.version) {
    const appPkg = readJson(appPkgPath);
    args.version = appPkg.version;
  }

  if (!isSemver(args.version)) {
    console.error('[publish-secure-channel-update] Invalid version. Use semver like 1.2.3');
    process.exit(1);
  }

  let existing = {
    version: args.version,
    releaseDate: args.releaseDate,
    downloadUrl: args.downloadUrl,
    changelog: [],
  };

  if (fs.existsSync(manifestPath)) {
    existing = { ...existing, ...readJson(manifestPath) };
  }

  const manifest = {
    version: args.version,
    releaseDate: args.releaseDate || existing.releaseDate,
    downloadUrl: args.downloadUrl || existing.downloadUrl,
    changelog: args.changelog.length > 0 ? args.changelog : (Array.isArray(existing.changelog) ? existing.changelog : []),
  };

  if (!manifest.downloadUrl) {
    console.error('[publish-secure-channel-update] Missing downloadUrl');
    process.exit(1);
  }

  writeJson(manifestPath, manifest);

  console.log('[publish-secure-channel-update] Manifest updated successfully');
  console.log(`Channel: ${args.channel}`);
  console.log(`Version: ${manifest.version}`);
  console.log(`Release date: ${manifest.releaseDate}`);
  console.log(`Download URL: ${manifest.downloadUrl}`);
  console.log(`Changelog items: ${manifest.changelog.length}`);
  console.log(`Manifest: ${manifestPath}`);
}

main();
