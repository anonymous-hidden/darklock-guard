import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { useMessageStore } from '../store/messageStore';
import { config } from '../config';

export function useWebSocket() {
  const wsRef = useRef(null);
  const reconnectRef = useRef(0);
  const [connectionState, setConnectionState] = useState('disconnected');
  const auth = useAuthStore();
  const messageStore = useMessageStore();

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (!auth.accessToken) return;

    setConnectionState('connecting');
    const ws = new WebSocket(config.wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Send auth frame
      ws.send(JSON.stringify({ type: 'AUTH', token: auth.accessToken }));
      reconnectRef.current = 0;
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      // Report activity to reset inactivity timer
      window.darklock?.window?.activity();

      switch (msg.type) {
        case 'AUTH_OK':
          setConnectionState('connected');
          break;

        case 'AUTH_FAIL':
          setConnectionState('disconnected');
          ws.close();
          break;

        case 'MESSAGE_RECEIVED':
          messageStore.addMessage(msg.channelId, {
            id: msg.messageId,
            channelId: msg.channelId,
            encryptedPayload: msg.encryptedPayload,
            senderPublicKey: msg.senderPublicKey,
            ephemeralKey: msg.ephemeralKey,
            ttl: msg.ttl,
            timestamp: msg.timestamp,
            content: null, // decrypted client-side later
            destroyed: false
          });
          break;

        case 'MESSAGE_DESTROY':
          messageStore.destroyMessage(msg.messageId);
          break;

        case 'TYPING_START':
          messageStore.setTyping(msg.channelId, msg.userId, true);
          break;

        case 'TYPING_STOP':
          messageStore.setTyping(msg.channelId, msg.userId, false);
          break;

        case 'KEY_EXCHANGE':
        case 'SESSION_ROTATE':
        case 'USER_JOIN':
        case 'USER_LEAVE':
        case 'PRESENCE_UPDATE':
        case 'ROOM_STATE':
          // Dispatch to window event for hooks that care
          window.dispatchEvent(new CustomEvent('darklock-ws', { detail: msg }));
          break;

        default:
          break;
      }
    };

    ws.onclose = (event) => {
      setConnectionState('disconnected');
      wsRef.current = null;
      // Don't reconnect on auth failure (4001)
      if (event.code === 4001) return;
      // Exponential backoff reconnect
      const delay = Math.min(1000 * Math.pow(2, reconnectRef.current), 30000);
      reconnectRef.current++;
      setConnectionState('reconnecting');
      setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [auth.accessToken, messageStore]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close(1000);
      wsRef.current = null;
    }
    setConnectionState('disconnected');
  }, []);

  const send = useCallback((message) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Auto-connect when authenticated
  useEffect(() => {
    if (auth.isAuthenticated && !auth.isLocked) {
      connect();
    }
    return () => disconnect();
  }, [auth.isAuthenticated, auth.isLocked, connect, disconnect]);

  return { connectionState, connect, disconnect, send };
}
