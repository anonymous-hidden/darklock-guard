// Encrypted message relay — NEVER inspects, stores, or logs message content
const rooms = require('./rooms');
const { v4: uuidv4 } = require('uuid');

function relayMessage(senderId, data) {
  const { channelId, encryptedPayload, ttl, ephemeralKey } = data;

  if (!channelId || !encryptedPayload) return;

  const messageId = uuidv4();
  const timestamp = Date.now();

  // Relay encrypted payload to all room members — server never decodes
  rooms.broadcastToRoom(channelId, senderId, {
    type: 'MESSAGE_RECEIVED',
    messageId,
    channelId,
    encryptedPayload,     // opaque ciphertext — server cannot read this
    ttl: ttl || 0,
    senderPublicKey: data.senderPublicKey,
    ephemeralKey,
    timestamp
  });

  // If TTL is set, schedule destroy notification (server only sends the ID, no content)
  if (ttl && ttl > 0) {
    setTimeout(() => {
      rooms.broadcastToRoom(channelId, null, {
        type: 'MESSAGE_DESTROY',
        messageId
      });
    }, ttl * 1000);
  }
}

module.exports = { relayMessage };
