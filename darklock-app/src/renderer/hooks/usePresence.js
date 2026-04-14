import { useState, useEffect, useCallback } from 'react';

export function usePresence(wsSend) {
  const [onlineUsers, setOnlineUsers] = useState(new Map());

  useEffect(() => {
    const handler = (event) => {
      const msg = event.detail;
      if (msg.type === 'PRESENCE_UPDATE') {
        setOnlineUsers(prev => {
          const next = new Map(prev);
          if (msg.status === 'offline') {
            next.delete(msg.userId);
          } else {
            next.set(msg.userId, msg.status);
          }
          return next;
        });
      }
      if (msg.type === 'USER_JOIN') {
        setOnlineUsers(prev => new Map(prev).set(msg.userId, 'online'));
      }
      if (msg.type === 'USER_LEAVE') {
        setOnlineUsers(prev => {
          const next = new Map(prev);
          next.delete(msg.userId);
          return next;
        });
      }
    };
    window.addEventListener('darklock-ws', handler);
    return () => window.removeEventListener('darklock-ws', handler);
  }, []);

  const setStatus = useCallback((status) => {
    wsSend({ type: 'PRESENCE_UPDATE', status });
  }, [wsSend]);

  const getStatus = useCallback((userId) => {
    return onlineUsers.get(userId) || 'offline';
  }, [onlineUsers]);

  return { onlineUsers, setStatus, getStatus };
}
