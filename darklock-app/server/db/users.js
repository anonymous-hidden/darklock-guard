const { getDb } = require('./schema');
const { v4: uuidv4 } = require('uuid');

function createUser({ usernameHash, passwordHash, publicKey, encryptedPrivateKey }) {
  const db = getDb();
  const id = uuidv4();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO users (id, username_hash, password_hash, public_key, encrypted_private_key, created_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, usernameHash, passwordHash, publicKey, encryptedPrivateKey, now, now);
  return { id, publicKey, created_at: now };
}

function findByUsernameHash(usernameHash) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE username_hash = ?').get(usernameHash);
}

function findById(id) {
  const db = getDb();
  return db.prepare('SELECT id, username_hash, public_key, created_at, last_seen, totp_secret FROM users WHERE id = ?').get(id);
}

function updateLastSeen(id) {
  const db = getDb();
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), id);
}

function setTotpSecret(id, secret) {
  const db = getDb();
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, id);
}

function deleteUser(id) {
  const db = getDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

function getPublicKey(id) {
  const db = getDb();
  const row = db.prepare('SELECT public_key FROM users WHERE id = ?').get(id);
  return row ? row.public_key : null;
}

// Server management
function createServer({ name, ownerId }) {
  const db = getDb();
  const id = uuidv4();
  const inviteCode = uuidv4().replace(/-/g, '').slice(0, 8);
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO servers (id, name, owner_id, invite_code, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, ownerId, inviteCode, now);
  // Create default general channel
  const channelId = uuidv4();
  db.prepare('INSERT INTO channels (id, server_id, name, type) VALUES (?, ?, ?, ?)')
    .run(channelId, id, 'general', 'text');
  // Owner membership
  db.prepare('INSERT INTO memberships (user_id, server_id, role) VALUES (?, ?, ?)')
    .run(ownerId, id, 'owner');
  return { id, name, inviteCode, channelId };
}

function getServersByUser(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT s.* FROM servers s
    JOIN memberships m ON m.server_id = s.id
    WHERE m.user_id = ?
  `).all(userId);
}

function getServerChannels(serverId) {
  const db = getDb();
  return db.prepare('SELECT * FROM channels WHERE server_id = ?').all(serverId);
}

function getChannelMembers(channelId) {
  const db = getDb();
  return db.prepare(`
    SELECT u.id, u.username_hash, u.public_key, u.last_seen, m.role
    FROM users u
    JOIN memberships m ON m.user_id = u.id
    JOIN channels c ON c.server_id = m.server_id
    WHERE c.id = ?
  `).all(channelId);
}

function getServerByInvite(inviteCode) {
  const db = getDb();
  return db.prepare('SELECT * FROM servers WHERE invite_code = ?').get(inviteCode);
}

function addMembership(userId, serverId, role = 'member') {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO memberships (user_id, server_id, role) VALUES (?, ?, ?)')
    .run(userId, serverId, role);
}

function getMembership(userId, serverId) {
  const db = getDb();
  return db.prepare('SELECT * FROM memberships WHERE user_id = ? AND server_id = ?').get(userId, serverId);
}

function getServerMembers(serverId) {
  const db = getDb();
  return db.prepare(`
    SELECT u.id, u.username_hash, u.public_key, u.last_seen, m.role
    FROM users u
    JOIN memberships m ON m.user_id = u.id
    WHERE m.server_id = ?
  `).all(serverId);
}

// Refresh tokens
function storeRefreshToken(userId, tokenHash, expiresAt) {
  const db = getDb();
  const id = uuidv4();
  db.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
    .run(id, userId, tokenHash, expiresAt);
}

function findRefreshToken(tokenHash) {
  const db = getDb();
  return db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ? AND expires_at > ?')
    .get(tokenHash, Math.floor(Date.now() / 1000));
}

function deleteRefreshTokensByUser(userId) {
  const db = getDb();
  db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId);
}

function deleteRefreshToken(tokenHash) {
  const db = getDb();
  db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(tokenHash);
}

module.exports = {
  createUser, findByUsernameHash, findById, updateLastSeen,
  setTotpSecret, deleteUser, getPublicKey,
  createServer, getServersByUser, getServerChannels,
  getChannelMembers, getServerByInvite, addMembership,
  getMembership, getServerMembers,
  storeRefreshToken, findRefreshToken, deleteRefreshTokensByUser, deleteRefreshToken
};
