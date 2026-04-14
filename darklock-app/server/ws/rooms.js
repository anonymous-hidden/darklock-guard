// In-memory room/channel state — no persistence
// Maps channelId → Set of { userId, ws, ephemeralKey }
const rooms = new Map();
const userConnections = new Map(); // userId → Set of ws

function joinRoom(channelId, userId, ws) {
  if (!rooms.has(channelId)) {
    rooms.set(channelId, new Map());
  }
  rooms.get(channelId).set(userId, { ws, ephemeralKey: null });

  if (!userConnections.has(userId)) {
    userConnections.set(userId, new Set());
  }
  userConnections.get(userId).add(ws);
}

function leaveRoom(channelId, userId) {
  const room = rooms.get(channelId);
  if (room) {
    const member = room.get(userId);
    if (member) {
      const conns = userConnections.get(userId);
      if (conns) {
        conns.delete(member.ws);
        if (conns.size === 0) userConnections.delete(userId);
      }
    }
    room.delete(userId);
    if (room.size === 0) rooms.delete(channelId);
  }
}

function leaveAllRooms(userId, ws) {
  for (const [channelId, room] of rooms) {
    const member = room.get(userId);
    if (member && member.ws === ws) {
      room.delete(userId);
      if (room.size === 0) rooms.delete(channelId);
    }
  }
  const conns = userConnections.get(userId);
  if (conns) {
    conns.delete(ws);
    if (conns.size === 0) userConnections.delete(userId);
  }
}

function getRoomMembers(channelId) {
  const room = rooms.get(channelId);
  if (!room) return [];
  return Array.from(room.entries()).map(([userId, data]) => ({
    userId,
    ephemeralKey: data.ephemeralKey
  }));
}

function setEphemeralKey(channelId, userId, ephemeralKey) {
  const room = rooms.get(channelId);
  if (room && room.has(userId)) {
    room.get(userId).ephemeralKey = ephemeralKey;
  }
}

function broadcastToRoom(channelId, senderId, message) {
  const room = rooms.get(channelId);
  if (!room) return;
  const payload = JSON.stringify(message);
  for (const [userId, { ws }] of room) {
    if (userId !== senderId && ws.readyState === 1) {
      ws.send(payload);
    }
  }
}

function sendToUser(userId, message) {
  const conns = userConnections.get(userId);
  if (!conns) return false;
  const payload = JSON.stringify(message);
  let sent = false;
  for (const ws of conns) {
    if (ws.readyState === 1) {
      ws.send(payload);
      sent = true;
    }
  }
  return sent;
}

function isUserOnline(userId) {
  const conns = userConnections.get(userId);
  if (!conns) return false;
  for (const ws of conns) {
    if (ws.readyState === 1) return true;
  }
  return false;
}

function getOnlineUsers() {
  const online = [];
  for (const [userId, conns] of userConnections) {
    for (const ws of conns) {
      if (ws.readyState === 1) {
        online.push(userId);
        break;
      }
    }
  }
  return online;
}

module.exports = {
  joinRoom, leaveRoom, leaveAllRooms, getRoomMembers,
  setEphemeralKey, broadcastToRoom, sendToUser,
  isUserOnline, getOnlineUsers
};
