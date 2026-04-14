import { useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { useServerStore } from '../store/serverStore';
import { useMessageStore } from '../store/messageStore';
import { config } from '../config';
import {
  generateIdentityKeypair,
  encryptPrivateKey,
  decryptPrivateKey,
  hashPasswordForServer,
  hashUsername
} from '../crypto/keyManager';

// Parse a fetch Response safely — never throws on empty/non-JSON bodies
async function parseResponse(res) {
  const text = await res.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

export function useAuth() {
  const auth = useAuthStore();
  const serverStore = useServerStore();
  const messageStore = useMessageStore();

  const register = useCallback(async (username, password) => {
    const keypair = await generateIdentityKeypair();
    const encryptedPrivateKey = await encryptPrivateKey(keypair.privateKey, password);
    const usernameHash = await hashUsername(username);
    const passwordHash = await hashPasswordForServer(password, username);

    const res = await fetch(`${config.apiUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usernameHash,
        passwordHash,
        publicKey: keypair.publicKey,
        encryptedPrivateKey
      })
    });

    const data = await parseResponse(res);

    if (!res.ok) {
      throw new Error(data.error || `Registration failed (${res.status})`);
    }

    // Store tokens in electron-store
    await window.darklock.store.set('accessToken', data.accessToken);
    await window.darklock.store.set('refreshToken', data.refreshToken);
    await window.darklock.store.set('userId', data.userId);

    auth.setAuth({
      userId: data.userId,
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey, // in-memory only
      accessToken: data.accessToken,
      refreshToken: data.refreshToken
    });

    return data;
  }, [auth]);

  const login = useCallback(async (username, password, totpCode) => {
    const usernameHash = await hashUsername(username);
    const passwordHash = await hashPasswordForServer(password, username);

    const res = await fetch(`${config.apiUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameHash, passwordHash, totpCode })
    });

    const data = await parseResponse(res);

    if (!res.ok) {
      if (data.requires2FA) throw new Error('2FA_REQUIRED');
      throw new Error(data.error || `Login failed (${res.status})`);
    }

    // Decrypt private key with password
    const privateKey = await decryptPrivateKey(data.encryptedPrivateKey, password);

    await window.darklock.store.set('accessToken', data.accessToken);
    await window.darklock.store.set('refreshToken', data.refreshToken);
    await window.darklock.store.set('userId', data.userId);

    auth.setAuth({
      userId: data.userId,
      publicKey: data.publicKey,
      privateKey, // in-memory only
      accessToken: data.accessToken,
      refreshToken: data.refreshToken
    });

    return data;
  }, [auth]);

  const refreshTokens = useCallback(async () => {
    const refreshToken = await window.darklock.store.get('refreshToken');
    if (!refreshToken) throw new Error('No refresh token');

    const res = await fetch(`${config.apiUrl}/api/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });

    if (!res.ok) throw new Error('Refresh failed');

    const data = await parseResponse(res);
    await window.darklock.store.set('accessToken', data.accessToken);
    await window.darklock.store.set('refreshToken', data.refreshToken);
    auth.setTokens(data);
    return data;
  }, [auth]);

  const logout = useCallback(async () => {
    try {
      const token = auth.accessToken || await window.darklock.store.get('accessToken');
      await fetch(`${config.apiUrl}/api/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch { /* best effort */ }

    await window.darklock.store.delete('accessToken');
    await window.darklock.store.delete('refreshToken');
    await window.darklock.store.delete('userId');

    auth.logout();
    serverStore.clear();
    messageStore.clearAll();
  }, [auth, serverStore, messageStore]);

  return { register, login, logout, refreshTokens };
}


