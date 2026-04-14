import React, { useEffect, useState } from 'react';
import { useAuthStore } from './store/authStore';
import Login from './pages/Login';
import Register from './pages/Register';
import MainApp from './pages/MainApp';

export default function App() {
  const { isAuthenticated, isLocked } = useAuthStore();
  const [page, setPage] = useState('login');

  // Listen for lock events from Electron main process
  useEffect(() => {
    const cleanup = window.darklock?.onLock(() => {
      useAuthStore.getState().lock();
    });
    return cleanup;
  }, []);

  // Auto-login check from stored tokens
  useEffect(() => {
    (async () => {
      try {
        const token = await window.darklock?.store?.get('accessToken');
        const userId = await window.darklock?.store?.get('userId');
        if (token && userId) {
          // We have tokens but need password to decrypt private key
          // Show lock screen or login
          setPage('login');
        }
      } catch {
        // No stored session
      }
    })();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        useAuthStore.getState().lock();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (isAuthenticated && !isLocked) {
    return <MainApp />;
  }

  if (page === 'register') {
    return <Register onSwitch={() => setPage('login')} />;
  }

  return <Login onSwitch={() => setPage('register')} />;
}
