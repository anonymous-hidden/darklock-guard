import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSignedEnvelope, canonicalJson } from './sign-ridgeline-policy.mjs';

test('release signer covers artifact digests and product policy', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ridgeline-release-test-'));
  try {
    const artifactPath = path.join(directory, 'Ridgeline-2.0.1-win-x64.exe');
    const artifactsPath = path.join(directory, 'artifacts.json');
    const notesPath = path.join(directory, 'notes.json');
    writeFileSync(artifactPath, 'verified installer fixture');
    writeFileSync(artifactsPath, JSON.stringify([{
      filePath: artifactPath,
      platform: 'win32',
      arch: 'x64',
      installerType: 'nsis',
      url: 'https://releases.darklock.net/ridgeline/Ridgeline-2.0.1-win-x64.exe',
    }]));
    writeFileSync(notesPath, JSON.stringify({ title: 'Ridgeline 2.0.1', summary: 'Test', highlights: [], fixes: [], security: [] }));
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const envelope = await buildSignedEnvelope({
      'artifacts-json': artifactsPath,
      'notes-json': notesPath,
      version: '2.0.1',
      classification: 'patch',
      channel: 'stable',
      urgency: 'recommended',
      'metadata-sequence': '1',
    }, privateKey);
    assert.equal(envelope.payload.artifacts[0].size, 26);
    assert.match(envelope.payload.artifacts[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(verify(null, Buffer.from(canonicalJson(envelope.payload)), publicKey, Buffer.from(envelope.signature, 'base64')), true);
    envelope.payload.rollout.percentage = 5;
    assert.equal(verify(null, Buffer.from(canonicalJson(envelope.payload)), publicKey, Buffer.from(envelope.signature, 'base64')), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('production release workflow publishes artifacts before manifests and policy', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const workflow = readFileSync(path.join(root, '.github', 'workflows', 'release-ridgeline.yml'), 'utf8');
  assert.ok(workflow.indexOf('Upload immutable artifacts first') < workflow.indexOf('Publish framework updater manifests'));
  assert.ok(workflow.indexOf('Publish framework updater manifests') < workflow.indexOf('Publish signed policy last'));
});
