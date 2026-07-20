import { createHash } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyDownloadedArtifact } from './updateArtifactVerification';

const directories: string[] = [];
afterEach(() => { while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true }); });

function fixture(contents: string) {
  const directory = mkdtempSync(path.join(tmpdir(), 'ridgeline-artifact-'));
  directories.push(directory);
  const file = path.join(directory, 'update.exe');
  writeFileSync(file, contents);
  return file;
}

describe('downloaded artifact verification', () => {
  it('accepts an exact size and digest match', async () => {
    const contents = 'signed update fixture';
    const file = fixture(contents);
    const digest = createHash('sha256').update(contents).digest('hex');
    await expect(verifyDownloadedArtifact(file, Buffer.byteLength(contents), digest)).resolves.toBe('verified');
  });

  it('rejects modified content and wrong sizes', async () => {
    const file = fixture('modified update');
    await expect(verifyDownloadedArtifact(file, 15, 'a'.repeat(64))).resolves.toBe('artifact_hash_mismatch');
    await expect(verifyDownloadedArtifact(file, 99, 'a'.repeat(64))).resolves.toBe('artifact_size_mismatch');
  });
});
