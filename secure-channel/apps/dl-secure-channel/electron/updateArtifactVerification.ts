import { createHash } from 'crypto';
import { createReadStream } from 'fs';

export async function verifyDownloadedArtifact(
  filePath: string,
  expectedSize: number,
  expectedSha256: string,
): Promise<'verified' | 'artifact_size_mismatch' | 'artifact_hash_mismatch'> {
  const actual = await new Promise<{ digest: string; size: number }>((resolve, reject) => {
    const hash = createHash('sha256');
    let size = 0;
    const stream = createReadStream(filePath);
    stream.on('data', (chunk: Buffer) => { size += chunk.length; hash.update(chunk); });
    stream.on('error', reject);
    stream.on('end', () => resolve({ digest: hash.digest('hex'), size }));
  });
  if (actual.size !== expectedSize) return 'artifact_size_mismatch';
  if (actual.digest !== expectedSha256.toLowerCase()) return 'artifact_hash_mismatch';
  return 'verified';
}
