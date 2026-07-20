/* ──────────────────────────────────────────────────────────
 *  Login Screen — first screen after install
 *  Darklock email/password login
 *  "Create Account" flows to onboarding
 * ────────────────────────────────────────────────────────── */

import React, { useState, useMemo } from 'react';
import { Button, Input } from '../components/Shared.js';
import { IconShieldCheck, IconMail, IconLock, IconEye, IconEyeOff, IconKey, IconFingerprint, IconSettings } from '../components/Icons.js';
import { useAuthStore } from '../stores/authStore.js';
import { useConnectionStore } from '../stores/connectionStore.js';
import { clearStoresIfUserChanged } from '../stores/clearUserData.js';
import { seedDevData } from '../devSeed.js';
import { initCrypto, deriveVaultKey, createKdfParams, generateSalt, fromBase64 } from '@darklock/channel-crypto';
import { loadVault, loadKdfParams, saveVault, saveKdfParams, vaultExists as checkVaultExists } from '../crypto/vault.js';
import { loadVaultKeys, loadPersistedSessions } from '../crypto/e2eeSessions.js';
import { useLoginScreenStore } from '../stores/loginScreenStore.js';
import { LoginSettings } from '../components/LoginSettings.js';
import ridgelineScImg from '../assets/ridgeline-sc.png';
import './Login.css';

const DEVICE_ID_STORAGE_KEY = 'ridgeline:device-id';

function getLoginDeviceHeaders(): Record<string, string> {
  try {
    let deviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (!deviceId) {
      deviceId = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
    }

    return {
      'X-Ridgeline-Device-ID': deviceId,
      'X-Device-Platform': navigator.platform || 'desktop',
    };
  } catch {
    return { 'X-Device-Platform': navigator.platform || 'desktop' };
  }
}

async function createDevIdentityMaterial() {
  const {
    generateIdentityKey,
    createSignedPreKey,
    generateOneTimePreKeys,
    toBase64,
  } = await import('@darklock/channel-crypto');

  const identityKeyPair = await generateIdentityKey();
  const { spk, secretKey: spkSecret } = await createSignedPreKey(identityKeyPair.secretKey, 1);
  const { keys: otpks, secrets: otpkSecrets } = await generateOneTimePreKeys(1, 20);

  // Load secrets into the in-memory E2EE manager so this dev session can encrypt/decrypt.
  loadVaultKeys({
    identityKeyPair: {
      publicKey: toBase64(identityKeyPair.publicKey),
      secretKey: toBase64(identityKeyPair.secretKey),
    },
    signedPreKey: {
      keyId: spk.keyId,
      publicKey: spk.publicKey,
      secretKey: toBase64(spkSecret),
      signature: spk.signature,
    },
    oneTimePreKeys: otpks.map((k: { keyId: number; publicKey: string }) => ({
      keyId: k.keyId,
      publicKey: k.publicKey,
      secretKey: toBase64(otpkSecrets.get(k.keyId)!),
    })),
  });

  return identityKeyPair;
}

async function createAndLoadIdentityMaterial(userId?: string) {
  const {
    generateIdentityKey,
    createSignedPreKey,
    generateOneTimePreKeys,
    toBase64,
  } = await import('@darklock/channel-crypto');

  const identityKeyPair = await generateIdentityKey();
  const { spk, secretKey: spkSecret } = await createSignedPreKey(identityKeyPair.secretKey, 1);
  const { keys: otpks, secrets: otpkSecrets } = await generateOneTimePreKeys(1, 20);

  const vaultMaterial = {
    identityKeyPair: {
      publicKey: toBase64(identityKeyPair.publicKey),
      secretKey: toBase64(identityKeyPair.secretKey),
    },
    signedPreKey: {
      keyId: spk.keyId,
      publicKey: spk.publicKey,
      secretKey: toBase64(spkSecret),
      signature: spk.signature,
    },
    oneTimePreKeys: otpks.map((k: { keyId: number; publicKey: string }) => ({
      keyId: k.keyId,
      publicKey: k.publicKey,
      secretKey: toBase64(otpkSecrets.get(k.keyId)!),
    })),
  };

  loadVaultKeys(vaultMaterial, userId);
  return { identityKeyPair, vaultMaterial };
}

const DEV_TEST_ACCOUNTS = [
  {
    username: 'ridgeline.user.one',
    email: 'ridgeline.user.one@testing.darklock.net',
    password: 'RidgelineTest!2026A',
    userId: 'ridgeline-user-one',
    displayName: 'Ridgeline User One',
  },
  {
    username: 'ridgeline.user.two',
    email: 'ridgeline.user.two@testing.darklock.net',
    password: 'RidgelineTest!2026B',
    userId: 'ridgeline-user-two',
    displayName: 'Ridgeline User Two',
  },
] as const;

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { setScreen, unlock } = useAuthStore();
  const idsUrl = useConnectionStore(s => s.idsUrl);

  const [showSettings, setShowSettings] = useState(false);
  const lt = useLoginScreenStore(s => s.get());

  // 2FA state
  const [needs2fa, setNeeds2fa] = useState(false);
  const [pendingToken, setPendingToken] = useState('');
  const [pending2faUser, setPending2faUser] = useState<{ userId: string; displayName: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [verifying2fa, setVerifying2fa] = useState(false);

  const normalized2faCode = totpCode.trim();
  const canVerify2fa = /^\d{6}$/.test(normalized2faCode) || /^[A-Za-z0-9-]{8,64}$/.test(normalized2faCode);



  /** Complete login with session data (shared by normal + 2FA flows) */
  const completeLogin = async (data: { userId: string; displayName: string; token: string; systemRole?: string | null }) => {
    await initCrypto();

    // Skip Argon2id entirely if there is no vault on this device.
    // 256 MiB Argon2id will crash or hang mobile browsers when there's nothing to decrypt.
    const hasLocalVault = await checkVaultExists(data.userId);

    let encryptionKey: Uint8Array = new Uint8Array(32); // placeholder
    let kdfParams: any = null;
    let vaultData = null;

    if (hasLocalVault) {
      // Vault is present on device — derive key and decrypt it
      const savedKdf = await loadKdfParams(data.userId);
      if (savedKdf) {
        kdfParams = savedKdf;
        const derived = await deriveVaultKey(password, savedKdf);
        encryptionKey = derived.encryptionKey;
      } else {
        // KDF params missing but vault exists (shouldn't happen, but handle gracefully)
        const salt = await generateSalt();
        kdfParams = createKdfParams(salt);
        const derived = await deriveVaultKey(password, kdfParams);
        encryptionKey = derived.encryptionKey;
      }
      // Load and decrypt vault to get real identity keys
      vaultData = await loadVault(data.userId, encryptionKey);
      if (!vaultData) {
        throw new Error('Local vault could not be unlocked on this device.');
      }
    } else {
      // No vault on this device (e.g. first login on mobile PWA).
      // Skip key derivation — placeholder keys will be used.
      const salt = await generateSalt();
      kdfParams = createKdfParams(salt);
    }
    let identityKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array };

    if (vaultData) {
      identityKeyPair = {
        publicKey: fromBase64(vaultData.identityKeyPair.publicKey),
        secretKey: fromBase64(vaultData.identityKeyPair.secretKey),
      };
      // Load SPK/OPK secrets into E2EE session manager (pass userId to persist bundle for reloads)
      loadVaultKeys(vaultData, data.userId);
      // Restore persisted ratchet sessions so E2EE survives page refreshes
      await loadPersistedSessions(data.userId, encryptionKey);

      // Background: re-register E2EE bundle on IDS if missing.
      // Covers accounts created before the key server was live, or after a server migration.
      // Skip if vault has placeholder keys (all-zero identity key ⇒ no real crypto was generated).
      const idKeyBytes = fromBase64(vaultData.identityKeyPair.publicKey);
      const isPlaceholder = idKeyBytes.every((b: number) => b === 0);
      if (!isPlaceholder) {
        void (async () => {
        try {
          const bundleCheck = await fetch(
            `${idsUrl}/v1/keys/bundle/${encodeURIComponent(data.userId)}`,
            {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${data.token}`,
              },
              signal: AbortSignal.timeout(8_000),
            },
          );
          // Also re-register when bundle identity key doesn't match local vault
          // (e.g. vault was reset with new keys but old bundle still exists on IDS).
          let needsRegister = bundleCheck.status === 404;
          if (!needsRegister && bundleCheck.ok) {
            try {
              const bundleData = await bundleCheck.clone().json();
              const remoteIK = (bundleData.bundle ?? bundleData)?.identityKey;
              needsRegister = remoteIK !== vaultData.identityKeyPair.publicKey;
            } catch { /* if parse fails, re-register to be safe */ needsRegister = true; }
          }
          console.log('[SECURITY_LOGIN_BUNDLE_CHECK_COMPLETED]');
          if (needsRegister) {
            const regRes = await fetch(`${idsUrl}/v1/keys/register`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${data.token}`,
              },
              body: JSON.stringify({
                userId: data.userId,
                identityKey: vaultData.identityKeyPair.publicKey,
                signedPreKey: {
                  keyId: vaultData.signedPreKey.keyId,
                  publicKey: vaultData.signedPreKey.publicKey,
                  signature: vaultData.signedPreKey.signature,
                  createdAt: Date.now(),
                },
                oneTimePreKeys: vaultData.oneTimePreKeys.map(
                  (k: { keyId: number; publicKey: string }) => ({ keyId: k.keyId, publicKey: k.publicKey }),
                ),
              }),
              signal: AbortSignal.timeout(8_000),
            });
            if (regRes.ok) {
              console.log('[SECURITY_LOGIN_BUNDLE_REGISTERED]');
            } else {
              console.error('[SECURITY_LOGIN_BUNDLE_REGISTRATION_FAILED]');
            }
          }
          // Always push the public bundle to cross-device sync so secondary devices
          // (e.g. mobile PWA with no local vault) can restore it after IDS data loss.
          try {
            const bundleToSync = {
              identityKey: vaultData.identityKeyPair.publicKey,
              signedPreKey: {
                keyId: vaultData.signedPreKey.keyId,
                publicKey: vaultData.signedPreKey.publicKey,
                signature: vaultData.signedPreKey.signature,
              },
              oneTimePreKeys: vaultData.oneTimePreKeys.map(
                (k: { keyId: number; publicKey: string }) => ({ keyId: k.keyId, publicKey: k.publicKey }),
              ),
            };
            await fetch(`${idsUrl}/v1/sync/${encodeURIComponent(data.userId)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.token}` },
              body: JSON.stringify({ key: 'e2eeBundle', value: bundleToSync }),
              signal: AbortSignal.timeout(8_000),
            });
            console.log('[SECURITY_LOGIN_BUNDLE_SYNCED]');
          } catch { /* non-fatal */ }
        } catch (err) {
          console.error('[SECURITY_LOGIN_BUNDLE_CHECK_FAILED]');
        }
      })();
      }
    } else {
      // First login on this device: create real local key material, persist vault,
      // and register the fresh bundle so E2EE can send immediately.
      const created = await createAndLoadIdentityMaterial(data.userId);
      identityKeyPair = created.identityKeyPair;
      await saveVault(data.userId, created.vaultMaterial, encryptionKey);
      await saveKdfParams(data.userId, kdfParams);

      try {
        const regRes = await fetch(`${idsUrl}/v1/keys/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.token}` },
          body: JSON.stringify({
            userId: data.userId,
            identityKey: created.vaultMaterial.identityKeyPair.publicKey,
            signedPreKey: {
              keyId: created.vaultMaterial.signedPreKey.keyId,
              publicKey: created.vaultMaterial.signedPreKey.publicKey,
              signature: created.vaultMaterial.signedPreKey.signature,
              createdAt: Date.now(),
            },
            oneTimePreKeys: created.vaultMaterial.oneTimePreKeys.map(k => ({ keyId: k.keyId, publicKey: k.publicKey })),
          }),
          signal: AbortSignal.timeout(8_000),
        });
        if (!regRes.ok) {
          console.error('[SECURITY_INITIAL_BUNDLE_REGISTRATION_FAILED]');
        }
      } catch (err) {
        console.error('[SECURITY_INITIAL_BUNDLE_REGISTRATION_ERROR]');
      }
    }

    // Flush stale per-user stores if switching accounts
    clearStoresIfUserChanged(data.userId);

    unlock({
      userId: data.userId,
      displayName: data.displayName,
      encryptionKey,
      identityKeyPair,
      kdfParams,
      sessionToken: data.token,
      systemRole: data.systemRole ?? null,
    });
  };

  const handleDarklockLogin = async () => {
    const identifierInput = email.trim();
    if (!identifierInput) { setError('Enter your email or username'); return; }
    if (!password) { setError('Enter your password'); return; }
    setLoading(true);
    setError('');
    try {
      const lowerIdentifier = identifierInput.toLowerCase();
      const isEmailLogin = lowerIdentifier.includes('@');
      const normalizedUserId = lowerIdentifier.replace(/[^a-z0-9._-]/g, '');

      if (!isEmailLogin && !normalizedUserId) {
        setError('Invalid email or username');
        setLoading(false);
        return;
      }

      // Dev test accounts: prefer real IDS login/register so local behaves like production.
      if (import.meta.env.DEV) {
        const matched = DEV_TEST_ACCOUNTS.find(a => a.username === lowerIdentifier && a.password === password);
        if (matched) {
          try {
            // Ensure account exists on IDS (idempotent). Ignore 409 conflicts.
            await fetch(`${idsUrl}/v1/auth/register`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: matched.userId,
                email: matched.email,
                displayName: matched.displayName,
                password: matched.password,
              }),
            }).catch(() => undefined);

            // Use real server token for sync + keys + protected APIs.
            const loginRes = await fetch(`${idsUrl}/v1/auth/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getLoginDeviceHeaders() },
              body: JSON.stringify({ userId: matched.userId, password: matched.password }),
            });
            const loginData = await loginRes.json().catch(() => null);
            if (loginRes.ok && loginData?.token) {
              await completeLogin({
                userId: loginData.userId ?? matched.userId,
                displayName: loginData.displayName ?? matched.displayName,
                token: loginData.token,
                systemRole: loginData.systemRole ?? null,
              });
              seedDevData(matched.userId);
              return;
            }
          } catch {
            // Fall through to local-only dev bootstrap below.
          }

          // Offline fallback: keep local testing available without IDS.
          await initCrypto();
          const salt = await generateSalt();
          const kdfParams = createKdfParams(salt);
          const identityKeyPair = await createDevIdentityMaterial();
          clearStoresIfUserChanged(matched.userId);
          unlock({
            userId: matched.userId,
            displayName: matched.displayName,
            encryptionKey: new Uint8Array(32),
            identityKeyPair,
            kdfParams,
            sessionToken: `dev-local-${matched.userId}`,
            systemRole: null,
          });
          seedDevData(matched.userId);
          return;
        }
      }

      let res: Response;
      try {
        const loginPayload = isEmailLogin
          ? { email: lowerIdentifier, password }
          : { userId: normalizedUserId, password };

        res = await fetch(`${idsUrl}/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getLoginDeviceHeaders() },
          body: JSON.stringify(loginPayload),
        });
      } catch {
        setError('Cannot reach Ridgeline servers. Check your connection.');
        return;
      }

      const data = await res.json();

      if (res.status === 401) {
        setError('Invalid username or password.');
        return;
      }
      if (res.status === 429) {
        setError(data.error === 'account_locked'
          ? 'Account locked due to too many failed attempts. Try again in 15 minutes.'
          : 'Too many login attempts. Please wait a moment.');
        return;
      }
      if (!res.ok) {
        setError(data.error === 'missing_fields'
          ? 'Enter both username and password.'
          : 'Server error. Try again later.');
        return;
      }

      // 2FA required — show code entry
      if (data.requires2fa) {
        setPendingToken(data.pendingToken);
        setPending2faUser({ userId: data.userId, displayName: data.displayName });
        setNeeds2fa(true);
        return;
      }

      await completeLogin(data);
    } catch (err) {
      setError(`Login error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  // ── DEV BYPASS ─────────────────────────────────────────────────────────
  // Only compiled-in when Vite runs in dev mode (never in production builds).
  const handleDevBypass = import.meta.env.DEV
    ? async () => {
        setLoading(true);
        setError('');
      try {
        // Prefer a real IDS session in development. This keeps people search,
        // friend requests, and messaging on the same backend as the desktop app.
        const account = DEV_TEST_ACCOUNTS[0];
        try {
          await fetch(`${idsUrl}/v1/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: account.userId,
              email: account.email,
              displayName: account.displayName,
              password: account.password,
            }),
          });
          const loginResponse = await fetch(`${idsUrl}/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getLoginDeviceHeaders() },
            body: JSON.stringify({ userId: account.userId, password: account.password }),
          });
          const loginData = await loginResponse.json().catch(() => null);
          if (loginResponse.ok && loginData?.token) {
            await completeLogin({
              userId: loginData.userId ?? account.userId,
              displayName: loginData.displayName ?? account.displayName,
              token: loginData.token,
              systemRole: loginData.systemRole ?? null,
            });
            seedDevData(account.userId);
            return;
          }
        } catch {
          // Keep the existing offline fallback available when IDS is unavailable.
        }

        await initCrypto();
          const salt = await generateSalt();
          const kdfParams = createKdfParams(salt);
          const identityKeyPair = await createDevIdentityMaterial();
          const DEV_USER_ID = 'dev-user-0000';
          clearStoresIfUserChanged(DEV_USER_ID);
          unlock({
            userId: DEV_USER_ID,
            displayName: 'Dev User',
            encryptionKey: new Uint8Array(32),
            identityKeyPair,
            kdfParams,
            sessionToken: 'dev-bypass-token',
            systemRole: null,
          });
          seedDevData(DEV_USER_ID);
        } catch (err) {
          setError(`Dev bypass error: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          setLoading(false);
        }
      }
    : undefined;

  const handle2faVerify = async () => {
    if (!canVerify2fa) return;
    setVerifying2fa(true);
    setError('');
    try {
      const res = await fetch(`${idsUrl}/v1/auth/2fa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getLoginDeviceHeaders() },
        body: JSON.stringify({ pendingToken, code: normalized2faCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError('Invalid code. Try again or use a backup code.');
        setTotpCode('');
        return;
      }
      await completeLogin(data);
    } catch {
      setError('Cannot reach Ridgeline servers.');
    } finally {
      setVerifying2fa(false);
    }
  };

  /* ── Luminance helper: returns 0–1 perceived brightness of a hex/rgb color ── */
  function parseLuminance(color: string): number | null {
    let r: number, g: number, b: number;
    // #rgb or #rrggbb
    const hex = color.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      const h = hex[1];
      if (h.length === 3)      { r = parseInt(h[0]+h[0],16); g = parseInt(h[1]+h[1],16); b = parseInt(h[2]+h[2],16); }
      else if (h.length >= 6)  { r = parseInt(h.slice(0,2),16); g = parseInt(h.slice(2,4),16); b = parseInt(h.slice(4,6),16); }
      else return null;
    } else {
      // rgb(r,g,b) or rgba(r,g,b,a)
      const rgb = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (rgb) { r = +rgb[1]; g = +rgb[2]; b = +rgb[3]; }
      else return null;
    }
    // Relative luminance (sRGB)
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  /* Grab the first color stop from a CSS gradient (good enough for contrast) */
  function firstGradientColor(grad: string): string | null {
    const m = grad.match(/#[0-9a-f]{3,8}|rgba?\([^)]+\)/i);
    return m ? m[0] : null;
  }

  /* ── Build dynamic styles from theme ── */
  const screenStyle: React.CSSProperties = {};
  if (lt.bgMode === 'solid')    screenStyle.background = lt.bgColor;
  if (lt.bgMode === 'gradient') screenStyle.background = lt.bgGradient;
  if (lt.bgMode === 'image')    { screenStyle.backgroundImage = `url(${lt.bgImage})`; screenStyle.backgroundSize = 'cover'; screenStyle.backgroundPosition = 'center'; }

  const overlayStyle: React.CSSProperties = lt.bgMode !== 'default'
    ? { position: 'absolute', inset: 0, background: lt.bgOverlayColor, opacity: lt.bgOverlayOpacity, pointerEvents: 'none', backdropFilter: lt.bgBlur > 0 ? `blur(${lt.bgBlur}px)` : undefined }
    : {};

  const cardStyle: React.CSSProperties = {};
  if (lt.cardStyle !== 'none') {
    const alpha = Math.round(lt.cardBgOpacity * 255).toString(16).padStart(2, '0');
    cardStyle.background = lt.cardBg.startsWith('#') ? lt.cardBg + alpha : lt.cardBg;
    if (lt.cardBorder !== 'transparent') cardStyle.border = `1px solid ${lt.cardBorder}`;
    cardStyle.borderRadius = lt.cardRadius;
    if (lt.cardShadow > 0) cardStyle.boxShadow = `0 ${lt.cardShadow / 2}px ${lt.cardShadow}px rgba(0,0,0,0.4)`;
    if (lt.cardGlow > 0) cardStyle.boxShadow = `${cardStyle.boxShadow ? cardStyle.boxShadow + ',' : ''} 0 0 ${lt.cardGlow}px ${lt.cardGlowColor}`;
    if (lt.cardStyle === 'glass' && lt.cardBlur > 0) { cardStyle.backdropFilter = `blur(${lt.cardBlur}px)`; (cardStyle as any).WebkitBackdropFilter = `blur(${lt.cardBlur}px)`; }
  } else {
    cardStyle.background = 'transparent';
    cardStyle.border = 'none';
    cardStyle.boxShadow = 'none';
  }
  if (lt.cardMaxWidth) cardStyle.maxWidth = lt.cardMaxWidth;

  /* ── Auto text color: derive from effective background luminance ── */
  const autoColors = useMemo(() => {
    // Determine the effective surface color text sits on
    let surfaceColor: string | null = null;

    // If card is visible and opaque enough, use card bg
    if (lt.cardStyle !== 'none' && lt.cardBgOpacity > 0.5) {
      surfaceColor = lt.cardBg;
    } else {
      // Use screen background
      if (lt.bgMode === 'solid')         surfaceColor = lt.bgColor;
      else if (lt.bgMode === 'gradient') surfaceColor = firstGradientColor(lt.bgGradient);
      else if (lt.bgMode === 'image')    surfaceColor = lt.bgOverlayColor; // best guess
      else                               surfaceColor = '#0a0a0f'; // default dark
    }

    const lum = surfaceColor ? parseLuminance(surfaceColor) : null;
    // If we can't parse, assume dark background
    const isLight = lum !== null && lum > 0.5;

    return {
      primary:   isLight ? '#111111' : '#e8e8f0',
      secondary: isLight ? '#333333' : '#aaaaaa',
      muted:     isLight ? '#555555' : '#888888',
      faint:     isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)',
      faintHard: isLight ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.4)',
      isLight,
    };
  }, [lt.bgMode, lt.bgColor, lt.bgGradient, lt.bgOverlayColor, lt.cardStyle, lt.cardBg, lt.cardBgOpacity]);

  const logoIcons: Record<string, React.ReactNode> = {
    shield:      <span style={{ display: 'block', width: lt.logoSize, height: lt.logoSize, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}><img src={ridgelineScImg} width={lt.logoSize} height={lt.logoSize} style={{ objectFit: 'cover', objectPosition: 'center 20%', display: 'block', imageRendering: '-webkit-optimize-contrast' } as React.CSSProperties} /></span>,
    lock:        <IconLock size={lt.logoSize} />,
    key:         <IconKey size={lt.logoSize} />,
    fingerprint: <IconFingerprint size={lt.logoSize} />,
    eye:         <IconEye size={lt.logoSize} />,
    image:       lt.logoImage ? <img src={lt.logoImage} width={lt.logoSize} height={lt.logoSize} style={{ objectFit: 'contain', borderRadius: 4 }} /> : <IconShieldCheck size={lt.logoSize} />,
  };

  const logoContainerStyle: React.CSSProperties = {
    color: lt.logoColor,
  };

  const layoutAlign = lt.layout === 'top' ? 'flex-start' : lt.layout === 'bottom' ? 'flex-end' : 'center';

  /* CSS custom props for input/button theming */
  const themeVars: Record<string, string> = {
    '--login-input-bg': lt.inputBg,
    '--login-input-border': lt.inputBorder,
    '--login-input-radius': `${lt.inputRadius}px`,
    '--login-input-color': lt.inputTextColor || autoColors.primary,
    '--login-btn-bg': lt.buttonColor,
    '--login-btn-color': lt.buttonTextColor,
    '--login-btn-radius': `${lt.buttonRadius}px`,
    '--login-auto-text': autoColors.primary,
    '--login-auto-muted': autoColors.muted,
    '--login-auto-faint': autoColors.faint,
  };

  return (
    <div className="login-screen" style={{ ...screenStyle, ...themeVars as any, alignItems: 'center', justifyContent: layoutAlign }}>
      {lt.bgMode !== 'default' && <div style={overlayStyle} />}

      {/* Settings gear */}
      <button className="login-settings-btn" onClick={() => setShowSettings(true)} title="Customize login screen">
        <IconSettings size={20} />
      </button>

      {showSettings && <LoginSettings onClose={() => setShowSettings(false)} />}

      <div className="login-card dl-animate-slideUp" style={cardStyle}>
        {/* ── Logo ─────────────── */}
        <div className="login-logo">
          <div
            className={`login-logo__icon login-logo__icon--${lt.logoAnimation}`}
            style={logoContainerStyle}
          >
            {logoIcons[lt.logoStyle] ?? <IconShieldCheck size={lt.logoSize} />}
          </div>
          <h1 className="login-logo__title" style={{ color: lt.titleColor || autoColors.primary, fontSize: lt.titleSize }}>{lt.titleText || 'RIDGELINE'}</h1>
          <p className="login-logo__subtitle" style={{ color: lt.subtitleColor || autoColors.muted }}>{lt.subtitleText || 'Ridgeline encrypted direct messaging'}</p>
        </div>

        {needs2fa ? (
          /* ── 2FA Code Entry ────── */
          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handle2faVerify();
            }}
          >
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <IconLock size={24} />
              <h3 style={{ margin: '8px 0 4px', fontSize: '1rem', color: autoColors.primary }}>Two-Factor Authentication</h3>
              <p style={{ fontSize: '0.8rem', color: autoColors.muted }}>
                Enter the 6-digit code from your authenticator app
                {pending2faUser && <>, or a backup code</>}
              </p>
            </div>
            <Input
              type="text"
              placeholder="000000 or backup code"
              value={totpCode}
              onChange={(e) => { setTotpCode(e.target.value.trimStart().slice(0, 64)); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handle2faVerify()}
              autoComplete="one-time-code"
              style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: /^\d{0,6}$/.test(normalized2faCode) ? '0.3em' : '0.08em', textTransform: /^\d{0,6}$/.test(normalized2faCode) ? 'none' : 'uppercase' }}
            />
            {error && <p className="login-error">{error}</p>}
            <Button
              variant="primary"
              size="lg"
              type="submit"
              loading={verifying2fa}
              disabled={!canVerify2fa}
              style={{ width: '100%' }}
            >
              {verifying2fa ? 'Verifying\u2026' : 'Verify'}
            </Button>
            <button
              className="login-link"
              type="button"
              onClick={() => { setNeeds2fa(false); setPendingToken(''); setTotpCode(''); setError(''); }}
              style={{ marginTop: 8 }}
            >
              &larr; Back to login
            </button>
          </form>
        ) : (
        <>
        {/* ── Email + Password ── */}
        <form
          className="login-form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleDarklockLogin();
          }}
        >
          <Input
            type="text"
            placeholder="Email or username"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && handleDarklockLogin()}
            icon={<IconMail size={16} />}
            autoComplete="username"
          />
          <Input
            type={showPw ? 'text' : 'password'}
            placeholder="Password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && handleDarklockLogin()}
            icon={<IconLock size={16} />}
            rightIcon={
              <button
                type="button"
                className="login-pw-toggle"
                onClick={() => setShowPw(!showPw)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                aria-pressed={showPw}
              >
                {showPw ? <IconEyeOff size={16} /> : <IconEye size={16} />}
              </button>
            }
            autoComplete="current-password"
          />
          {error && <p className="login-error">{error}</p>}
          <Button
            variant="primary"
            size="lg"
            type="submit"
            loading={loading}
            disabled={!email.trim() || !password}
            style={{ width: '100%' }}
          >
            {loading ? 'Signing in\u2026' : 'Sign In'}
          </Button>
        </form>

        {/* ── Dev bypass (dev mode only) ── */}
        {import.meta.env.DEV && handleDevBypass && (
          <div style={{ marginTop: 8, textAlign: 'center' }}>
            <button
              className="login-link"
              type="button"
              onClick={handleDevBypass}
              style={{ fontSize: '11px', opacity: 0.5, borderTop: '1px dashed currentColor', paddingTop: 8, width: '100%' }}
            >
              ⚡ Dev bypass (skip login)
            </button>
          </div>
        )}

        {/* ── Forgot + Create ── */}
        <div className="login-links">
          <button className="login-link" type="button">
            Forgot password?
          </button>
          <span className="login-links__separator">{"\u00B7"}</span>
          <button className="login-link login-link--accent" type="button" onClick={() => setScreen('onboarding')}>
            Create a Ridgeline account
          </button>
        </div>
        </>
        )}

        {/* ── Footer ──────────── */}
        <div className="login-footer">
          {lt.showEncBadge && (
            <span className="login-footer__text" style={{ color: lt.footerColor || autoColors.faintHard }}>
              <IconLock size={12} />
              Direct-message encryption {"\u00B7"} Local key protection
            </span>
          )}
          {lt.footerText && (
            <span className="login-footer__custom" style={{ color: lt.footerColor || autoColors.muted, fontSize: '11px', marginTop: 4 }}>
              {lt.footerText}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
