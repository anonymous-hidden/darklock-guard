#!/usr/bin/env node

import { readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [inputDirectory, outputFile, publicBaseUrl] = process.argv.slice(2);
if (!inputDirectory || !outputFile || !publicBaseUrl) {
  throw new Error('Usage: prepare-ridgeline-artifacts.mjs <directory> <output.json> <https-base-url>');
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(fullPath) : [fullPath];
  });
}

function architecture(name) {
  if (/-universal\b/i.test(name)) return 'universal';
  if (/-arm64\b/i.test(name)) return 'arm64';
  if (/-ia32\b/i.test(name)) return 'ia32';
  return 'x64';
}

const selected = filesUnder(path.resolve(inputDirectory)).flatMap(filePath => {
  const name = path.basename(filePath);
  if (/\.exe$/i.test(name)) return [{ filePath, platform: 'win32', arch: architecture(name), installerType: 'nsis' }];
  if (/\.zip$/i.test(name) && /mac/i.test(name)) {
    const arch = architecture(name);
    if (arch === 'universal') {
      return [
        { filePath, platform: 'darwin', arch: 'x64', installerType: 'zip' },
        { filePath, platform: 'darwin', arch: 'arm64', installerType: 'zip' },
      ];
    }
    return [{ filePath, platform: 'darwin', arch, installerType: 'zip' }];
  }
  if (/\.AppImage$/i.test(name)) return [{ filePath, platform: 'linux', arch: architecture(name), installerType: 'appimage' }];
  return [];
}).map(artifact => ({
  ...artifact,
  url: new URL(encodeURIComponent(path.basename(artifact.filePath)).replace(/%2F/gi, '/'), `${publicBaseUrl.replace(/\/$/, '')}/`).toString(),
}));

if (selected.length === 0) throw new Error('No updater-compatible artifacts were found');
for (const artifact of selected) {
  if (!statSync(artifact.filePath).isFile()) throw new Error(`Artifact is not a file: ${artifact.filePath}`);
}
writeFileSync(path.resolve(outputFile), `${JSON.stringify(selected, null, 2)}\n`, 'utf8');
