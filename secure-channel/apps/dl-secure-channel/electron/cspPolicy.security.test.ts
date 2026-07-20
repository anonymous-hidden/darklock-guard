import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildConnectSrc, buildContentSecurityPolicy } from './cspPolicy';

describe('desktop CSP security policy', () => {
  it('production connect-src is pinned and excludes bare schemes', () => {
    const connectSrc = buildConnectSrc(false);

    expect(connectSrc).toContain("https://ids.darklock.net");
    expect(connectSrc).toContain('wss://rly.darklock.net');
    expect(connectSrc).toContain('https://rly.darklock.net');
    expect(connectSrc).toContain('http://192.168.50.150:4100');
    expect(connectSrc).toContain('ws://192.168.50.150:4101');
    expect(connectSrc).toContain('https://admin.darklock.net');
    expect(connectSrc).toContain('https://api.giphy.com');

    expect(connectSrc).not.toMatch(/\swss:(?:\s|;|$)/);
    expect(connectSrc).not.toMatch(/\shttps:(?:\s|;|$)/);
    expect(connectSrc).not.toContain('localhost');
    expect(connectSrc).not.toContain('127.0.0.1');
  });

  it('production CSP snapshot has no wildcard connect-src schemes', () => {
    expect(buildContentSecurityPolicy(false)).toMatchInlineSnapshot(
      '"default-src \'self\'; script-src \'self\' \'wasm-unsafe-eval\'; style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com; connect-src \'self\' blob: http://192.168.50.150:4100 ws://192.168.50.150:4101 https://ids.darklock.net wss://rly.darklock.net https://rly.darklock.net https://admin.darklock.net https://api.giphy.com; img-src \'self\' data: blob: https://*.tenor.com https://*.giphy.com https://i.scdn.co; font-src \'self\' https://fonts.gstatic.com; media-src \'self\' blob: https://*.tenor.com https://*.giphy.com; object-src \'none\'; frame-src \'none\'; base-uri \'none\'; form-action \'none\';"',
    );
  });

  it('applies the production policy directly to packaged file content', () => {
    const indexPath = fileURLToPath(new URL('../index.html', import.meta.url));
    const html = readFileSync(indexPath, 'utf8');
    const expected = `http-equiv="Content-Security-Policy" content="${buildContentSecurityPolicy(false)}"`;

    expect(html).toContain(expected);
    expect(buildContentSecurityPolicy(false)).not.toContain("'unsafe-eval'");
    expect(buildContentSecurityPolicy(false)).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});
