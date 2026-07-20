#!/usr/bin/env node

import { createHash, createPrivateKey, sign } from 'node:crypto';
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const appPackage = JSON.parse(readFileSync(path.join(root, 'secure-channel', 'apps', 'dl-secure-channel', 'package.json'), 'utf8'));

export function canonicalJson(value) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  throw new Error('Metadata contains an unsupported value');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid argument: ${key || ''}`);
    args[key.slice(2)] = value;
  }
  return args;
}

async function hashFile(filePath) {
  const sha256 = createHash('sha256');
  const sha512 = createHash('sha512');
  let size = 0;
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', chunk => { size += chunk.length; sha256.update(chunk); sha512.update(chunk); });
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return { size, sha256: sha256.digest('hex'), sha512: sha512.digest('base64') };
}

function readSigningKey() {
  const encoded = process.env.RIDGELINE_UPDATE_SIGNING_KEY_B64;
  if (!encoded) throw new Error('RIDGELINE_UPDATE_SIGNING_KEY_B64 is required');
  const pem = Buffer.from(encoded, 'base64').toString('utf8');
  return createPrivateKey(pem);
}

export async function buildSignedEnvelope(args, signingKey = readSigningKey()) {
  const manifestPath = path.resolve(args['artifacts-json']);
  const artifactInputs = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(artifactInputs) || artifactInputs.length === 0) throw new Error('Artifact manifest is empty');
  const artifacts = [];
  for (const input of artifactInputs) {
    const filePath = path.resolve(input.filePath);
    const digest = await hashFile(filePath);
    const url = new URL(input.url);
    if (url.protocol !== 'https:') throw new Error('Artifact URLs must use HTTPS');
    artifacts.push({
      platform: input.platform,
      arch: input.arch,
      installerType: input.installerType,
      url: url.toString(),
      ...digest,
    });
  }

  const publishedAt = new Date(args['published-at'] || Date.now());
  const expiresAt = new Date(args['expires-at'] || publishedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  const notes = JSON.parse(readFileSync(path.resolve(args['notes-json']), 'utf8'));
  const version = args.version || appPackage.version;
  if ((args.channel || 'stable') === 'stable' && version.includes('-')) throw new Error('Stable releases require a stable semantic version');
  if ((args.channel || 'stable') === 'beta' && !/-beta\.[0-9]+$/.test(version)) throw new Error('Beta releases require a -beta.N version');
  const payload = {
    schemaVersion: 1,
    keyId: process.env.RIDGELINE_UPDATE_KEY_ID || 'ridgeline-release-2026-01',
    releaseId: args['release-id'] || `ridgeline-${args.channel || 'stable'}-${version}`,
    metadataSequence: Number(args['metadata-sequence'] || 1),
    app: 'ridgeline',
    version,
    channel: args.channel || 'stable',
    classification: args.classification,
    urgency: args.urgency || 'recommended',
    minimumSupportedVersion: args['minimum-supported-version'] || version,
    publishedAt: publishedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    revoked: args.revoked === 'true',
    rollout: {
      percentage: Number(args.rollout || 100),
      seed: args['rollout-seed'] || `ridgeline-${args.channel || 'stable'}-${version}`,
      paused: args.paused === 'true',
    },
    releaseNotes: notes,
    artifacts,
  };
  if (!['patch', 'minor', 'major', 'security', 'hotfix'].includes(payload.classification)) throw new Error('A valid --classification is required');
  if (!['recommended', 'required', 'emergency'].includes(payload.urgency)) throw new Error('Invalid urgency');
  if (![1, 5, 25, 50, 100].includes(payload.rollout.percentage)) throw new Error('Invalid rollout percentage');
  if (!Number.isSafeInteger(payload.metadataSequence) || payload.metadataSequence < 1) throw new Error('Invalid metadata sequence');
  const signature = sign(null, Buffer.from(canonicalJson(payload), 'utf8'), signingKey).toString('base64');
  return { payload, signature };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['artifacts-json'] || !args['notes-json'] || !args.output) throw new Error('--artifacts-json, --notes-json, and --output are required');
  const envelope = await buildSignedEnvelope(args);
  writeFileSync(path.resolve(args.output), `${JSON.stringify(envelope, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`Signed Ridgeline ${envelope.payload.version} metadata with ${envelope.payload.keyId}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
