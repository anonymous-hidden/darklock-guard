import { useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { useMessageStore } from '../store/messageStore';
import { useCrypto } from './useCrypto';

export function useMessages(wsSend) {
  const auth = useAuthStore();
  const messageStore = useMessageStore();
  const { encrypt, decrypt } = useCrypto();

  const sendMessage = useCallback(async (channelId, plaintext, recipientPublicKeys, ttl = 0) => {
    // Encrypt for each recipient
    for (const recipientPk of recipientPublicKeys) {
      const { payload, needsRotation } = await encrypt(plaintext, recipientPk);

      wsSend({
        type: 'SEND_MESSAGE',
        channelId,
        encryptedPayload: payload,
        ttl,
        senderPublicKey: auth.publicKey,
        ephemeralKey: payload.ephemeralKey
      });

      if (needsRotation) {
        wsSend({
          type: 'SESSION_ROTATE',
          channelId,
          newEphemeralKey: payload.ephemeralKey
        });
      }
    }

    // Add to local store as our own message (already decrypted)
    const id = crypto.randomUUID();
    messageStore.addMessage(channelId, {
      id,
      channelId,
      content: plaintext,
      senderPublicKey: auth.publicKey,
      senderId: auth.userId,
      ttl,
      timestamp: Date.now(),
      isOwn: true,
      destroyed: false
    });

    // Set up TTL self-destruct timer
    if (ttl > 0) {
      setTimeout(() => {
        messageStore.destroyMessage(id);
      }, ttl * 1000);
    }
  }, [auth.publicKey, auth.userId, encrypt, wsSend, messageStore]);

  const decryptIncoming = useCallback(async (message) => {
    if (message.content !== null || message.destroyed) return message;
    try {
      const plaintext = await decrypt(message.encryptedPayload, message.senderPublicKey);
      return { ...message, content: plaintext };
    } catch {
      return { ...message, content: '[decryption failed]' };
    }
  }, [decrypt]);

  const startTyping = useCallback((channelId) => {
    wsSend({ type: 'TYPING_START', channelId });
  }, [wsSend]);

  const stopTyping = useCallback((channelId) => {
    wsSend({ type: 'TYPING_STOP', channelId });
  }, [wsSend]);

  return { sendMessage, decryptIncoming, startTyping, stopTyping };
}
