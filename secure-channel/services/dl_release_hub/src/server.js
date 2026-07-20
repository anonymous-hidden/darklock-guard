import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { CHANNELS, safeSegment } from './common.js';

const host = process.env.RELEASE_HUB_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.RELEASE_HUB_PORT ?? '4102', 10);
const dataDir = process.env.RELEASE_HUB_DATA_DIR ?? '/var/lib/ridgeline-release-hub';
const maxTelemetryBytes = 4 * 1024;

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'",
    'Cross-Origin-Resource-Policy': 'same-site',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  res.end(body);
}

function safePath(...parts) {
  const result = path.resolve(dataDir, ...parts);
  const root = `${path.resolve(dataDir)}${path.sep}`;
  return result.startsWith(root) ? result : null;
}

function jsonFile(res, file) {
  if (!existsSync(file)) return send(res, 200, '{"available":false}', { 'Content-Type': 'application/json; charset=utf-8' });
  return send(res, 200, readFileSync(file), { 'Content-Type': 'application/json; charset=utf-8' });
}

function latestManifest(res, channel) {
  const file = safePath('channels', channel, 'latest.yml');
  if (!file || !existsSync(file)) return send(res, 404, 'Not found\n', { 'Content-Type': 'text/plain; charset=utf-8' });
  return send(res, 200, readFileSync(file), { 'Content-Type': 'text/yaml; charset=utf-8', 'Cache-Control': 'no-cache' });
}

function artifact(res, channel, version, filename, method) {
  if (!CHANNELS.has(channel) || !safeSegment(version) || !safeSegment(filename)) {
    return send(res, 404, 'Not found\n', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  const file = safePath('artifacts', channel, version, filename);
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    return send(res, 404, 'Not found\n', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  const stat = statSync(file);
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': stat.size,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-site',
  });
  if (method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://release-hub.local');
  if (method === 'GET' && url.pathname === '/health') return send(res, 200, '{"ok":true}', { 'Content-Type': 'application/json; charset=utf-8' });
  if (method === 'GET' && url.pathname === '/ridgeline/policy/latest') {
    const channel = url.searchParams.get('channel') ?? 'stable';
    if (!CHANNELS.has(channel)) return send(res, 400, '{"error":"invalid_channel"}', { 'Content-Type': 'application/json; charset=utf-8' });
    return jsonFile(res, safePath('channels', channel, 'policy.json'));
  }
  if (method === 'GET' && (url.pathname === '/ridgeline/latest.yml' || url.pathname === '/ridgeline/stable.yml')) return latestManifest(res, 'stable');
  if (method === 'GET' && url.pathname === '/ridgeline/beta.yml') return latestManifest(res, 'beta');
  const match = /^\/ridgeline\/releases\/(stable|beta)\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if ((method === 'GET' || method === 'HEAD') && match) return artifact(res, match[1], match[2], match[3], method);
  if (method === 'POST' && url.pathname === '/ridgeline/telemetry') {
    let bytes = 0;
    req.on('data', chunk => { bytes += chunk.length; if (bytes > maxTelemetryBytes) req.destroy(); });
    req.on('end', () => send(res, 204, ''));
    return;
  }
  return send(res, 404, 'Not found\n', { 'Content-Type': 'text/plain; charset=utf-8' });
});

server.requestTimeout = 15_000;
server.headersTimeout = 16_000;
server.listen(port, host, () => console.log(`Ridgeline release hub listening on ${host}:${port}`));
