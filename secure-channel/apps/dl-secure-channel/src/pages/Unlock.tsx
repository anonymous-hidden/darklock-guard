/* ──────────────────────────────────────────────────────────
 *  Unlock Screen — master password entry
 * ────────────────────────────────────────────────────────── */

import { useState, useRef, useEffect } from 'react';
import { Button, Input } from '../components/Shared.js';
import { IconLock, IconShieldCheck } from '../components/Icons.js';
import { useAuthStore } from '../stores/authStore.js';
import { useConnectionStore } from '../stores/connectionStore.js';
import { useProfileStore } from '../stores/profileStore.js';
import { initCrypto, deriveVaultKey, fromBase64 } from '@darklock/channel-crypto';
import { loadVault, loadKdfParams } from '../crypto/vault.js';
import { loadVaultKeys, loadPersistedSessions } from '../crypto/e2eeSessions.js';
import './Unlock.css';

export function UnlockScreen() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { unlock, setScreen, vaultExists, userId, displayName: savedDisplayName } = useAuthStore();
  const idsUrl = useConnectionStore(s => s.idsUrl);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!vaultExists) setScreen('login');
  }, [vaultExists, setScreen]);

  const handleUnlock = async () => {
    if (!password.trim()) {
      setError('Enter your master password');
      return;
    }
    setLoading(true);
    setError('');

    try {
      await initCrypto();

      if (!userId) {
        setError('No account found. Please log in.');
        setScreen('login');
        return;
      }

      // 1. Load saved KDF params
      const savedKdf = await loadKdfParams(userId);
      if (!savedKdf) {
        setError('No vault key data found. Please log in again.');
        setScreen('login');
        return;
      }

      // 2. Derive encryption key from password + saved KDF
      const { encryptionKey } = await deriveVaultKey(password, savedKdf);

      // 3. Attempt to decrypt vault — this verifies the password
      const vaultData = await loadVault(userId, encryptionKey);
      if (!vaultData) {
        setError('Incorrect password');
        setLoading(false);
        return;
      }

      // 4. Re-authenticate with IDS to get a fresh session token
      let sessionToken = '';
      try {
        const res = await fetch(`${idsUrl}/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            password,
            last_known_identity_pubkey: vaultData.identityKeyPair?.publicKey,
          }),
        });
        const data = await res.json();
        if (res.ok && data.token) {
          sessionToken = data.token;
        }
        // If server is unreachable, continue offline — token will be empty
        // but the user can still view local messages
      } catch {
        // Offline mode — continue without session token
      }

      // 5. Load identity keys from vault
      const identityKeyPair = {
        publicKey: fromBase64(vaultData.identityKeyPair.publicKey),
        secretKey: fromBase64(vaultData.identityKeyPair.secretKey),
      };
      loadVaultKeys(vaultData, userId);
      await loadPersistedSessions(userId, encryptionKey);

      useProfileStore.getState().setUsername(userId);
      useProfileStore.getState().setDisplayName(savedDisplayName || userId);

      unlock({
        userId,
        displayName: savedDisplayName || userId,
        encryptionKey,
        identityKeyPair,
        kdfParams: savedKdf,
        sessionToken,
      });
    } catch {
      setError('Incorrect password or corrupted vault');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="unlock-screen">
      <div className="unlock-card dl-animate-slideUp">
        <div className="unlock-logo">
          <div className="unlock-logo__icon">
            <IconShieldCheck size={32} />
          </div>
          <h1 className="unlock-logo__title">Secure Channel</h1>
          <p className="unlock-logo__subtitle">Ridgeline encrypted direct messaging</p>
        </div>

        <div className="unlock-form">
          <Input
            ref={inputRef}
            type="password"
            placeholder="Master password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
            error={error}
            icon={<IconLock size={16} />}
            autoComplete="off"
            spellCheck={false}
          />

          <Button
            variant="primary"
            size="lg"
            onClick={handleUnlock}
            loading={loading}
            disabled={!password.trim()}
            style={{ width: '100%' }}
          >
            {loading ? 'Deriving keys...' : 'Unlock Vault'}
          </Button>
        </div>

        <div className="unlock-footer">
          <span className="unlock-footer__text">
            <IconLock size={12} />
            Encrypted with Argon2id + XChaCha20-Poly1305
          </span>
        </div>
      </div>
    </div>
  );
}
