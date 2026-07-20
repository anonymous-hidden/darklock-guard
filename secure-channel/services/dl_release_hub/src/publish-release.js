import { randomUUID, sign } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CHANNELS, VERSION, canonicalJson, safeSegment, sha256File, sha512File } from './common.js';

const dataDir = process.env.RELEASE_HUB_DATA_DIR ?? '/var/lib/ridgeline-release-hub';
const signingKeyPath = process.env.RELEASE_HUB_SIGNING_KEY ?? '/etc/ridgeline-release-hub/keys/ridgeline-update-signing.pem';
const publicBaseUrl = process.env.RELEASE_HUB_PUBLIC_URL ?? 'https://releases.darklock.net/ridgeline';
const keyId = process.env.RELEASE_HUB_KEY_ID ?? 'ridgeline-pi-release-2026-07';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function fail(message) { console.error(`publish rejected: ${message}`); process.exit(1); }
function writeAtomic(file, content) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o750 });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, content, { mode: 0o640 });
  renameSync(temp, file);
}
function required(value, label) { if (!value) fail(`${label} is required`); return value; }
function ymlScalar(yml, key) {
  const match = yml.match(new RegExp(`^\\s*${key}:\\s*["']?([^\\r\\n"']+)["']?\\s*$`, 'm'));
  return match?.[1]?.trim();
}
function parseLatestYml(yml) {
  const version = ymlScalar(yml, 'version');
  const sha512 = ymlScalar(yml, 'sha512');
  const sizeText = ymlScalar(yml, 'size');
  const pathValue = ymlScalar(yml, 'path');
  if (!version || !sha512 || !sizeText || !pathValue || !VERSION.test(version) || !safeSegment(pathValue)) fail('latest.yml is incomplete');
  const size = Number(sizeText);
  if (!Number.isSafeInteger(size) || size <= 0) fail('latest.yml filesize is invalid');
  return { version, sha512, size, path: pathValue };
}
function manifestWithImmutablePath(yml, immutablePath) {
  return yml
    .replace(/^path:\s*.*$/m, `path: ${immutablePath}`)
    .replace(/^(\s*-\s+url:\s*).*$/m, `$1${immutablePath}`);
}

const channel = required(argument('--channel'), '--channel');
const releaseDir = path.resolve(required(argument('--release-dir'), '--release-dir'));
const classification = argument('--classification') ?? 'patch';
const urgency = argument('--urgency') ?? 'recommended';
const minimumSupportedVersion = argument('--minimum-supported-version');
const title = argument('--title') ?? 'Ridgeline update';
const summary = argument('--summary') ?? 'Stability and security improvements.';
if (!CHANNELS.has(channel)) fail('channel must be stable or beta');
if (!['patch', 'minor', 'major', 'security', 'hotfix'].includes(classification)) fail('classification is invalid');
if (!['recommended', 'required', 'emergency'].includes(urgency)) fail('urgency is invalid');
if (!existsSync(signingKeyPath)) fail('signing key is missing');

const ymlPath = path.join(releaseDir, 'latest.yml');
if (!existsSync(ymlPath)) fail('release directory must contain latest.yml');
const yml = readFileSync(ymlPath, 'utf8');
const manifest = parseLatestYml(yml);
if (minimumSupportedVersion && !VERSION.test(minimumSupportedVersion)) fail('minimum-supported-version is invalid');
const artifactPath = path.join(releaseDir, manifest.path);
if (!existsSync(artifactPath)) fail(`artifact ${manifest.path} is missing`);
const artifact = readFileSync(artifactPath);
if (artifact.length !== manifest.size || sha512File(artifact) !== manifest.sha512) fail('artifact does not match latest.yml');

const immutablePath = `releases/${channel}/${manifest.version}/${manifest.path}`;
const artifactDir = path.join(dataDir, 'artifacts', channel, manifest.version);
const destination = path.join(artifactDir, manifest.path);
mkdirSync(artifactDir, { recursive: true, mode: 0o750 });
if (existsSync(destination)) {
  if (sha256File(readFileSync(destination)) !== sha256File(artifact)) fail('an immutable artifact already exists with different content');
} else {
  copyFileSync(artifactPath, destination, 0);
}

const policyPath = path.join(dataDir, 'channels', channel, 'policy.json');
let sequence = 1;
if (existsSync(policyPath)) {
  try { sequence = Number(JSON.parse(readFileSync(policyPath, 'utf8')).payload?.metadataSequence ?? 0) + 1; } catch { fail('existing policy is unreadable'); }
}
const now = new Date();
const policy = {
  schemaVersion: 1, keyId, releaseId: randomUUID(), metadataSequence: sequence, app: 'ridgeline', version: manifest.version,
  channel, classification, urgency, minimumSupportedVersion: minimumSupportedVersion ?? manifest.version,
  publishedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(), revoked: false,
  rollout: { percentage: 100, seed: randomUUID(), paused: false },
  releaseNotes: { title: title.slice(0, 160), summary: summary.slice(0, 1000), highlights: [], fixes: [], security: [] },
  artifacts: [{ platform: 'win32', arch: 'x64', installerType: 'nsis', url: `${publicBaseUrl}/${immutablePath}`, size: artifact.length, sha256: sha256File(artifact), sha512: sha512File(artifact) }],
};
const signature = sign(null, Buffer.from(canonicalJson(policy), 'utf8'), readFileSync(signingKeyPath)).toString('base64');
writeAtomic(path.join(dataDir, 'channels', channel, 'latest.yml'), manifestWithImmutablePath(yml, immutablePath));
writeAtomic(policyPath, JSON.stringify({ payload: policy, signature }));
console.log(JSON.stringify({ published: true, channel, version: manifest.version, sequence, artifact: immutablePath }));
