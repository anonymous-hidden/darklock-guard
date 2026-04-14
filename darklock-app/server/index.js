require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const helmet = require('helmet');
const cors = require('cors');
const { authMiddleware } = require('./middleware/auth');
const { authLimiter, generalLimiter } = require('./middleware/rateLimit');
const { handleConnection, startHeartbeat } = require('./ws/handler');
const users = require('./db/users');
const { getDb } = require('./db/schema');
const { isValidUUID, sanitizeServerName } = require('./utils/sanitize');

const PORT = parseInt(process.env.PORT, 10) || 4200;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const server = http.createServer(app);

// Security headers — disable CSP on this API-only server (no HTML served).
// CSP is a browser document policy; it doesn't apply to API endpoints and
// would incorrectly block Electron renderer fetch calls if set here.
app.use(helmet({ contentSecurityPolicy: false }));
// This is a desktop app — the renderer runs either as file:// (production) or
// from a Vite localhost dev server (development). Allow all localhost origins;
// there is no external web context to protect against.
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || /^http:\/\/localhost(:\d+)?$/.test(origin))
}));
app.use(express.json({ limit: '1mb' }));
app.use(generalLimiter);

// Initialize database
getDb();

// ── Auth routes ──
app.use('/api/register', authLimiter, require('./auth/register'));
app.use('/api/login', authLimiter, require('./auth/login'));
app.use('/api/refresh', authLimiter, require('./auth/refresh'));
app.use('/api/logout', require('./auth/logout'));

// ── Health check ──
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ── Server management (requires auth) ──
app.post('/api/servers', authMiddleware, (req, res) => {
  const name = sanitizeServerName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Server name required' });
  const server = users.createServer({ name, ownerId: req.userId });
  res.status(201).json(server);
});

app.get('/api/servers', authMiddleware, (req, res) => {
  const servers = users.getServersByUser(req.userId);
  res.json(servers);
});

app.get('/api/servers/:serverId/channels', authMiddleware, (req, res) => {
  if (!isValidUUID(req.params.serverId)) return res.status(400).json({ error: 'Invalid server ID' });
  const membership = users.getMembership(req.userId, req.params.serverId);
  if (!membership) return res.status(403).json({ error: 'Not a member' });
  const channels = users.getServerChannels(req.params.serverId);
  res.json(channels);
});

app.get('/api/servers/:serverId/members', authMiddleware, (req, res) => {
  if (!isValidUUID(req.params.serverId)) return res.status(400).json({ error: 'Invalid server ID' });
  const membership = users.getMembership(req.userId, req.params.serverId);
  if (!membership) return res.status(403).json({ error: 'Not a member' });
  const members = users.getServerMembers(req.params.serverId);
  res.json(members);
});

app.post('/api/servers/join', authMiddleware, (req, res) => {
  const { inviteCode } = req.body;
  if (!inviteCode) return res.status(400).json({ error: 'Invite code required' });
  const server = users.getServerByInvite(inviteCode);
  if (!server) return res.status(404).json({ error: 'Invalid invite code' });
  users.addMembership(req.userId, server.id);
  res.json({ serverId: server.id, name: server.name });
});

// ── User info ──
app.get('/api/users/:userId/public-key', authMiddleware, (req, res) => {
  if (!isValidUUID(req.params.userId)) return res.status(400).json({ error: 'Invalid user ID' });
  const publicKey = users.getPublicKey(req.params.userId);
  if (!publicKey) return res.status(404).json({ error: 'User not found' });
  res.json({ publicKey });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const user = users.findById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    id: user.id,
    usernameHash: user.username_hash,
    publicKey: user.public_key,
    has2FA: !!user.totp_secret,
    createdAt: user.created_at
  });
});

// ── 2FA setup ──
app.post('/api/2fa/setup', authMiddleware, (req, res) => {
  const { authenticator } = require('otplib');
  const QRCode = require('qrcode');
  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(req.userId, 'DarkLock', secret);
  QRCode.toDataURL(otpauth, (err, dataUrl) => {
    if (err) return res.status(500).json({ error: 'QR generation failed' });
    res.json({ secret, qrCode: dataUrl });
  });
});

app.post('/api/2fa/verify', authMiddleware, (req, res) => {
  const { authenticator } = require('otplib');
  const { secret, code } = req.body;
  if (!secret || !code) return res.status(400).json({ error: 'Secret and code required' });
  const isValid = authenticator.check(code, secret);
  if (!isValid) return res.status(401).json({ error: 'Invalid code' });
  users.setTotpSecret(req.userId, secret);
  res.json({ success: true });
});

app.post('/api/2fa/disable', authMiddleware, (req, res) => {
  users.setTotpSecret(req.userId, null);
  res.json({ success: true });
});

// ── WebSocket server ──
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  handleConnection(ws, req);
});

startHeartbeat(wss);

// ── Start ──
server.listen(PORT, HOST, () => {
  console.log(`DarkLock server running on ${HOST}:${PORT}`);
  console.log(`WebSocket endpoint: ws://${HOST}:${PORT}/ws`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  const { close } = require('./db/schema');
  wss.close();
  close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  const { close } = require('./db/schema');
  wss.close();
  close();
  process.exit(0);
});
