const { verifyToken } = require('../middleware/auth');
const rooms = require('./rooms');
const { relayMessage } = require('./relay');
const users = require('../db/users');
const { isValidUUID } = require('../utils/sanitize');

function handleConnection(ws, req) {
  let userId = null;
  let authenticated = false;

  // 30-second auth timeout
  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      ws.send(JSON.stringify({ type: 'AUTH_FAIL', error: 'Authentication timeout' }));
      ws.close(4001, 'Auth timeout');
    }
  }, 30000);

  // Heartbeat
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (!msg || !msg.type) return;

    // AUTH must be first message
    if (!authenticated) {
      if (msg.type === 'AUTH') {
        const payload = verifyToken(msg.token);
        if (!payload) {
          ws.send(JSON.stringify({ type: 'AUTH_FAIL', error: 'Invalid token' }));
          ws.close(4001, 'Invalid token');
          return;
        }
        userId = payload.sub;
        authenticated = true;
        clearTimeout(authTimeout);
        users.updateLastSeen(userId);
        ws.send(JSON.stringify({ type: 'AUTH_OK', userId }));
      }
      return;
    }

    // All subsequent messages require auth
    handleMessage(ws, userId, msg);
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
    if (userId) {
      rooms.leaveAllRooms(userId, ws);
      // Broadcast offline to all connections
      broadcastPresence(userId, 'offline');
    }
  });

  ws.on('error', () => {
    clearTimeout(authTimeout);
    if (userId) {
      rooms.leaveAllRooms(userId, ws);
    }
  });
}

function handleMessage(ws, userId, msg) {
  // Add random timing jitter (10-50ms)
  const jitter = 10 + Math.floor(Math.random() * 40);

  setTimeout(() => {
    switch (msg.type) {
      case 'JOIN_CHANNEL':
        handleJoinChannel(ws, userId, msg);
        break;

      case 'LEAVE_CHANNEL':
        handleLeaveChannel(userId, msg);
        break;

      case 'SEND_MESSAGE':
        relayMessage(userId, msg);
        break;

      case 'KEY_EXCHANGE':
        handleKeyExchange(userId, msg);
        break;

      case 'SESSION_ROTATE':
        handleSessionRotate(userId, msg);
        break;

      case 'TYPING_START':
        if (msg.channelId) {
          rooms.broadcastToRoom(msg.channelId, userId, {
            type: 'TYPING_START',
            channelId: msg.channelId,
            userId
          });
        }
        break;

      case 'TYPING_STOP':
        if (msg.channelId) {
          rooms.broadcastToRoom(msg.channelId, userId, {
            type: 'TYPING_STOP',
            channelId: msg.channelId,
            userId
          });
        }
        break;

      case 'PRESENCE_UPDATE':
        broadcastPresence(userId, msg.status || 'online');
        break;

      default:
        break;
    }
  }, jitter);
}

function handleJoinChannel(ws, userId, msg) {
  if (!msg.channelId || !isValidUUID(msg.channelId)) return;

  // Verify membership via DB
  const members = users.getChannelMembers(msg.channelId);
  const isMember = members.some(m => m.id === userId);
  if (!isMember) {
    ws.send(JSON.stringify({ type: 'ERROR', error: 'Not a member of this channel' }));
    return;
  }

  rooms.joinRoom(msg.channelId, userId, ws);

  // Notify others
  rooms.broadcastToRoom(msg.channelId, userId, {
    type: 'USER_JOIN',
    channelId: msg.channelId,
    userId
  });

  // Send current room members to the joiner
  const roomMembers = rooms.getRoomMembers(msg.channelId);
  ws.send(JSON.stringify({
    type: 'ROOM_STATE',
    channelId: msg.channelId,
    members: roomMembers
  }));

  broadcastPresence(userId, 'online');
}

function handleLeaveChannel(userId, msg) {
  if (!msg.channelId) return;
  rooms.leaveRoom(msg.channelId, userId);
  rooms.broadcastToRoom(msg.channelId, userId, {
    type: 'USER_LEAVE',
    channelId: msg.channelId,
    userId
  });
}

function handleKeyExchange(userId, msg) {
  if (!msg.targetUserId || !msg.ephemeralPublicKey) return;
  rooms.sendToUser(msg.targetUserId, {
    type: 'KEY_EXCHANGE',
    userId,
    ephemeralPublicKey: msg.ephemeralPublicKey
  });
}

function handleSessionRotate(userId, msg) {
  if (!msg.channelId || !msg.newEphemeralKey) return;
  rooms.setEphemeralKey(msg.channelId, userId, msg.newEphemeralKey);
  rooms.broadcastToRoom(msg.channelId, userId, {
    type: 'SESSION_ROTATE',
    userId,
    newEphemeralKey: msg.newEphemeralKey
  });
}

function broadcastPresence(userId, status) {
  const onlineUsers = rooms.getOnlineUsers();
  const message = { type: 'PRESENCE_UPDATE', userId, status };
  for (const uid of onlineUsers) {
    if (uid !== userId) {
      rooms.sendToUser(uid, message);
    }
  }
}

// Heartbeat interval — ping all clients every 30s
function startHeartbeat(wss) {
  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);

  wss.on('close', () => clearInterval(interval));
}

module.exports = { handleConnection, startHeartbeat };
