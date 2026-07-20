/* ──────────────────────────────────────────────────────────
 *  Onboarding Screen — first-time setup
 *  Creates identity keys, sets master password, shows
 *  recovery phrase.
 * ────────────────────────────────────────────────────────── */

import { useState } from 'react';
import { Button, Input } from '../components/Shared.js';
import { IconKey, IconCheck, IconCopy, IconUser, IconMail } from '../components/Icons.js';
import { useAuthStore } from '../stores/authStore.js';
import { useProfileStore } from '../stores/profileStore.js';
import { useConnectionStore } from '../stores/connectionStore.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { clearStoresIfUserChanged } from '../stores/clearUserData.js';
import type { Bytes, IdentityKeyPair, KdfParams } from '../types.js';
import { RIDGELINE_SECURITY_CAPABILITIES } from '@darklock/ridgeline-security-capabilities';
import {
  initCrypto, deriveVaultKey, generateSalt, createKdfParams,
  generateIdentityKey, createSignedPreKey, generateOneTimePreKeys,
  buildPreKeyBundle, toBase64, wipeAll,
  generateMnemonic, } from '@darklock/channel-crypto';
import { saveVault, saveKdfParams, saveOnboardingCompletion, saveRecoveryBackup } from '../crypto/vault.js';
import './Onboarding.css';

type Step = 'welcome' | 'account' | 'recovery' | 'confirm' | 'preferences' | 'ready';

export function OnboardingScreen() {
  const [step, setStep] = useState<Step>('welcome');
  const [email, setEmail] = useState('');
  const [accountId, setAccountId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [accountErrors, setAccountErrors] = useState<Record<string, string>>({});
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const recoveryWords = recoveryPhrase ? recoveryPhrase.split(' ') : [];
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  // session token saved after registration so confirm step can use it
  const [sessionToken, setSessionToken] = useState('');
  // Pick 4 random positions to verify (fixed on mount)
  const [verifyIndices] = useState<number[]>(() => {
    const indices: number[] = [];
    while (indices.length < 4) {
      const n = Math.floor(Math.random() * 12);
      if (!indices.includes(n)) indices.push(n);
    }
    return indices.sort((a, b) => a - b);
  });
  const [verifyInputs, setVerifyInputs] = useState<string[]>(['', '', '', '']);
  const [preparedSetup, setPreparedSetup] = useState<{
    encryptionKey: Bytes;
    identityKeyPair: IdentityKeyPair;
    kdfParams: KdfParams;
  } | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<'dark' | 'midnight' | 'amoled'>('dark');
  const [showPreviews, setShowPreviews] = useState(true);
  const { unlock, setVaultExists, setScreen } = useAuthStore();
  const profileStore = useProfileStore();
  const idsUrl = useConnectionStore(s => s.idsUrl);
  const setTheme = useSettingsStore(s => s.setTheme);
  const notificationContent = useSettingsStore(s => s.notificationContent);
  const toggleNotificationContent = useSettingsStore(s => s.toggleNotificationContent);

  const normalizedEmail = email.trim().toLowerCase();

  const clearAccountError = (field: string) => {
    setAccountErrors(current => {
      const { [field]: _removed, ...remaining } = current;
      return remaining;
    });
  };

  /** Step 1: validate fields, check availability, register account, then advance */
  const handleCreateAccount = async () => {
    if (loading) return;
    const nextErrors: Record<string, string> = {};
    if (!displayName.trim()) nextErrors.displayName = 'Enter a display name.';
    if (!normalizedEmail) nextErrors.email = 'Enter your email address.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedEmail)) {
      nextErrors.email = 'Enter a valid email address.';
    }
    if (password.length < 12) nextErrors.password = 'Use at least 12 characters.';
    if (confirm && password !== confirm) nextErrors.confirm = 'Passwords do not match.';
    if (!termsAccepted) nextErrors.terms = 'Agree to the Terms of Service and Privacy Policy to continue.';
    if (Object.keys(nextErrors).length > 0) {
      setAccountErrors(nextErrors);
      setError('');
      return;
    }

    setError('');
    setAccountErrors({});
    setLoading(true);
    try {
      // Register account on IDS server
      const regRes = await fetch(`${idsUrl}/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, displayName: displayName.trim(), password }),
      });
      const regData = await regRes.json().catch(() => ({}));
      if (regRes.status === 409) { setAccountErrors({ email: 'An account with this email already exists.' }); return; }
      if (!regRes.ok) {
        if (regRes.status === 429) setError('Too many attempts. Wait a moment before trying again.');
        else if (regData.error === 'invalid_email') setAccountErrors({ email: 'Enter a valid email address.' });
        else if (regData.error === 'password_too_short') setAccountErrors({ password: 'Use at least 12 characters.' });
        else setError('Ridgeline could not create your account. Check your connection and try again.');
        return;
      }

      // Auto-login to get session token
      const loginRes = await fetch(`${idsUrl}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, password }),
      });
      const loginData = await loginRes.json();
      if (!loginRes.ok) throw new Error('auto_login_failed');

      const resolvedUserId = String(loginData.userId || '').trim();
      if (!resolvedUserId) throw new Error('invalid_user_id');

      sessionStorage.removeItem('dl-session-token'); // clean up any stale entry (HIGH-2)
      setSessionToken(loginData.token);
      setAccountId(resolvedUserId);

      profileStore.setUsername(resolvedUserId);
      profileStore.setDisplayName(displayName.trim());

      // Generate BIP39-compatible 12-word recovery phrase (MED-1)
      await initCrypto();
      const phrase = await generateMnemonic();
      setRecoveryPhrase(phrase);

      setStep('recovery');
    } catch {
      setError('Ridgeline could not create your account. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyPhrase = () => {
    navigator.clipboard.writeText(recoveryPhrase);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /** Step 3: verify recovery words, register pre-key bundle, encrypt recovery backup, unlock */
  const handleConfirmRecovery = async () => {
    if (!accountId) {
      setError('Account setup is incomplete. Please return to the first step.');
      return;
    }

    const allMatch = verifyIndices.every((wordIndex, i) =>
      verifyInputs[i].trim().toLowerCase() === recoveryWords[wordIndex].toLowerCase()
    );
    if (!allMatch) {
      setError('One or more words are incorrect. Check your recovery phrase and try again.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      // CRIT-2 + HIGH-1: Real crypto via dl-crypto (Argon2id + Ed25519 identity)
      await initCrypto();

      // Derive local encryption key from password using Argon2id (HIGH-1)
      const salt = await generateSalt();
      const kdfParams = createKdfParams(salt);
      const { encryptionKey: encKey } = await deriveVaultKey(password, kdfParams);

      // CRIT-2: Generate real Ed25519 identity key pair
      const identityKeyPair = await generateIdentityKey();

      // Create signed pre-key and one-time pre-keys for X3DH
      const { spk, secretKey: spkSecret } = await createSignedPreKey(identityKeyPair.secretKey, 1);
      const { keys: otpks, secrets: otpkSecrets } = await generateOneTimePreKeys(1, 20);
      const bundle = buildPreKeyBundle(identityKeyPair.publicKey, spk, otpks);

      // ── Persist secret keys to encrypted local vault ──
      const vaultKeys = {
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
        oneTimePreKeys: otpks.map(k => ({
          keyId: k.keyId,
          publicKey: k.publicKey,
          secretKey: toBase64(otpkSecrets.get(k.keyId)!),
        })),
      };
      await saveVault(accountId, vaultKeys, encKey);
      await saveKdfParams(accountId, kdfParams);

      // ── MED-1: Recovery phrase → AEAD-encrypted identity backup ──
      // Derive a separate recovery key from the mnemonic using Argon2id
      // with a DIFFERENT salt than the password KDF.
      const recoverySalt = await generateSalt();
      const recoveryKdfParams = createKdfParams(recoverySalt);
      const { encryptionKey: recoveryKey } = await deriveVaultKey(recoveryPhrase, recoveryKdfParams);
      await saveRecoveryBackup(accountId, identityKeyPair, recoveryKey);
      // Also persist the recovery KDF params (needed to re-derive on restore)
      await (window as any).electronAPI.vaultWrite(
        `${accountId}.recovery-kdf.json`,
        JSON.stringify(recoveryKdfParams),
      );
      wipeAll(recoveryKey);

      // Register pre-key bundle on IDS (for E2EE messaging)
      await fetch(`${idsUrl}/v1/keys/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          userId: accountId,
          identityKey: bundle.identityKey,
          signedPreKey: {
            keyId: bundle.signedPreKey.keyId,
            publicKey: bundle.signedPreKey.publicKey,
            signature: bundle.signedPreKey.signature,
            createdAt: Date.now(),
          },
          oneTimePreKeys: bundle.oneTimePreKeys.map(k => ({
            keyId: k.keyId,
            publicKey: k.publicKey,
          })),
        }),
      });

      // Wipe ephemeral secret material from memory (vault has a copy now)
      wipeAll(spkSecret);
      for (const [, sec] of otpkSecrets) wipeAll(sec);

      setPreparedSetup({ encryptionKey: encKey, identityKeyPair, kdfParams });
      setStep('preferences');
    } catch {
      setError('Setup failed. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const finishSetup = async () => {
    if (!preparedSetup) return;

    setLoading(true);
    setError('');
    try {
      setTheme(selectedTheme);
      if (notificationContent !== showPreviews) toggleNotificationContent();
      const appVersion = await window.electronAPI?.getVersion?.() ?? '2.0.0';
      await saveOnboardingCompletion(accountId, preparedSetup.encryptionKey, {
        schemaVersion: 1,
        completed: true,
        completedAt: new Date().toISOString(),
        appVersion,
        completedSteps: ['welcome', 'account', 'security', 'preferences', 'ready'],
      });
      setVaultExists(true);
      clearStoresIfUserChanged(accountId);
      unlock({
        userId: accountId,
        displayName: displayName || 'You',
        encryptionKey: preparedSetup.encryptionKey,
        identityKeyPair: preparedSetup.identityKeyPair,
        kdfParams: preparedSetup.kdfParams,
        sessionToken,
        systemRole: null,
      });
    } catch {
      setError('Ridgeline could not finish secure local setup. No account data was changed.');
    } finally {
      setLoading(false);
    }
  };

  const STEPS = [
    ['welcome', 'Welcome'],
    ['account', 'Account'],
    ['security', 'Security'],
    ['preferences', 'Preferences'],
    ['ready', 'Ready'],
  ] as const;
  const activeStep = step === 'recovery' || step === 'confirm' ? 'security' : step;

  return (
    <div className="onboarding-screen">
      <div className="onboarding-card dl-animate-slideUp">
        {/* ── Progress ─────────── */}
        <div className="onboarding-progress">
          {STEPS.map(([id, label], i) => (
            <div
              key={id}
              className={`onboarding-progress__dot ${
                activeStep === id ? 'onboarding-progress__dot--active' :
                STEPS.findIndex(([stepId]) => stepId === activeStep) > i ? 'onboarding-progress__dot--done' : ''
              }`}
            ><span>{label}</span></div>
          ))}
        </div>

        {/* ── Step 1: Create Account ── */}
        {step === 'welcome' && (
          <div className="onboarding-step onboarding-step--welcome dl-animate-fadeIn">
            <img className="onboarding-brand-mark" src="/icon.png" alt="Ridgeline" />
            <p className="onboarding-eyebrow">A DARKLOCK PRODUCT</p>
            <h1 className="onboarding-title">Welcome to Ridgeline</h1>
            <p className="onboarding-desc">Private messaging, built by Darklock. Let&apos;s finish preparing the app for this device.</p>
            <p className="onboarding-copy">Ridgeline keeps your private conversations separated from ordinary social platforms.</p>
            <Button variant="primary" size="lg" onClick={() => setStep('account')} style={{ width: '100%' }}>Continue</Button>
            <button className="onboarding-back-link" type="button" onClick={() => setScreen('login')}>I already have an account</button>
          </div>
        )}

        {step === 'account' && (
          <div className="onboarding-step onboarding-step--account dl-animate-fadeIn">
            <div className="onboarding-icon">
              <IconUser size={36} />
            </div>
            <div className="onboarding-account-intro">
              <h1 className="onboarding-title">Create your account</h1>
              <p className="onboarding-desc">Join Ridgeline and set up your private messaging identity.</p>
            </div>
            <div className="onboarding-account-panel">
              <Input
                label="Display name"
                placeholder="How others see you"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setError('');
                  clearAccountError('displayName');
                }}
                error={accountErrors.displayName}
                aria-invalid={Boolean(accountErrors.displayName)}
                maxLength={32}
                autoComplete="name"
              />
              <Input
                label="Email address"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError('');
                  clearAccountError('email');
                }}
                error={accountErrors.email}
                aria-invalid={Boolean(accountErrors.email)}
                icon={<IconMail size={14} />}
                maxLength={120}
                autoComplete="email"
              />
              <div>
                <Input
                  type={showPw ? 'text' : 'password'}
                  label="Password"
                  placeholder="Create a strong password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError('');
                    clearAccountError('password');
                    if (confirm && e.target.value !== confirm) {
                      setAccountErrors(current => ({ ...current, confirm: 'Passwords do not match.' }));
                    } else {
                      clearAccountError('confirm');
                    }
                  }}
                  error={accountErrors.password}
                  aria-invalid={Boolean(accountErrors.password)}
                  autoComplete="new-password"
                  rightIcon={
                    <button
                      type="button"
                      className="onboarding-pw-toggle"
                      onClick={() => setShowPw(v => !v)}
                      aria-label={showPw ? 'Hide password' : 'Show password'}
                    >
                      {showPw
                        ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      }
                    </button>
                  }
                />
                <p className={`onboarding-account-requirement ${password.length >= 12 ? 'is-satisfied' : ''}`}>
                  Use at least 12 characters.
                </p>
              </div>
              <Input
                type={showConfirm ? 'text' : 'password'}
                label="Confirm password"
                placeholder="Enter password again"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setError('');
                  if (e.target.value && e.target.value !== password) {
                    setAccountErrors(current => ({ ...current, confirm: 'Passwords do not match.' }));
                  } else {
                    clearAccountError('confirm');
                  }
                }}
                error={accountErrors.confirm}
                aria-invalid={Boolean(accountErrors.confirm)}
                autoComplete="new-password"
                rightIcon={
                  <button
                    type="button"
                    className="onboarding-pw-toggle"
                    onClick={() => setShowConfirm(v => !v)}
                    aria-label={showConfirm ? 'Hide confirmation password' : 'Show confirmation password'}
                  >
                    {showConfirm
                      ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    }
                  </button>
                }
              />
              <label className={`onboarding-account-terms ${accountErrors.terms ? 'onboarding-account-terms--error' : ''}`}>
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => {
                    setTermsAccepted(e.target.checked);
                    if (e.target.checked) clearAccountError('terms');
                  }}
                  aria-describedby={accountErrors.terms ? 'onboarding-terms-error' : undefined}
                />
                <span>
                  I agree to the <a href="https://darklock.io/terms" target="_blank" rel="noreferrer">Terms of Service</a> and <a href="https://darklock.io/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
                </span>
              </label>
              {accountErrors.terms && <p id="onboarding-terms-error" className="onboarding-account-inline-error" role="alert">{accountErrors.terms}</p>}
              {error && <p className="onboarding-error" role="alert" aria-live="assertive">{error}</p>}
              <Button
                variant="primary" size="lg"
                onClick={handleCreateAccount}
                loading={loading}
                disabled={loading || !normalizedEmail || !displayName.trim() || password.length < 12 || !confirm || password !== confirm || !termsAccepted}
                style={{ width: '100%' }}
              >
                {loading ? 'Creating account\u2026' : 'Create account'}
              </Button>
              <button className="onboarding-back-link" type="button" onClick={() => setScreen('login')}>
                Already have an account? <span>Sign in</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Recovery Phrase ── */}
        {step === 'recovery' && (
          <div className="onboarding-step dl-animate-fadeIn">
            <div className="onboarding-icon" style={{ color: 'var(--dl-warning, #f59e0b)' }}>
              <IconKey size={36} />
            </div>
            <h2 className="onboarding-title">Save Your Recovery Phrase</h2>
            <p className="onboarding-desc">
              Write these 12 words down on paper and store them somewhere safe.
              This phrase can restore your identity keys if you forget your password.
            </p>
            <div className="recovery-grid">
              {recoveryWords.map((word, i) => (
                <div key={i} className="recovery-word">
                  <span className="recovery-word__num">{i + 1}</span>
                  <span className="recovery-word__text">{word}</span>
                </div>
              ))}
            </div>
            <div className="onboarding-actions">
              <Button variant="ghost" size="md" onClick={handleCopyPhrase}
                icon={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}>
                {copied ? 'Copied' : 'Copy to clipboard'}
              </Button>
              <Button variant="primary" size="lg" onClick={() => setStep('confirm')} style={{ width: '100%' }}>
                I wrote it down
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Confirm Recovery ── */}
        {step === 'confirm' && (
          <div className="onboarding-step dl-animate-fadeIn">
            <h2 className="onboarding-title">Verify Recovery Phrase</h2>
            <p className="onboarding-desc">
              Enter the words at the positions shown to confirm you saved your phrase.
            </p>
            <div className="onboarding-form">
              {verifyIndices.map((wordIndex, i) => (
                <Input
                  key={wordIndex}
                  label={`Word #${wordIndex + 1}`}
                  placeholder={`Enter word ${wordIndex + 1}`}
                  value={verifyInputs[i]}
                  onChange={(e) => {
                    setError('');
                    const next = [...verifyInputs];
                    next[i] = e.target.value;
                    setVerifyInputs(next);
                  }}
                  autoComplete="off"
                  spellCheck={false}
                />
              ))}
              {error && <p className="onboarding-error">{error}</p>}
              <Button
                variant="primary" size="lg"
                onClick={handleConfirmRecovery}
                loading={loading}
                disabled={verifyInputs.some(v => !v.trim())}
                style={{ width: '100%' }}
              >
                {loading ? 'Finalising setup\u2026' : 'Complete Setup'}
              </Button>
            </div>
          </div>
        )}

        {step === 'preferences' && (
          <div className="onboarding-step dl-animate-fadeIn">
            <p className="onboarding-eyebrow">DEVICE PREFERENCES</p>
            <h2 className="onboarding-title">Make Ridgeline yours</h2>
            <p className="onboarding-desc">These choices remain available in Settings after setup.</p>
            <div className="onboarding-preferences">
              <div className="onboarding-preference">
                <span>Theme</span>
                <div className="onboarding-theme-options" role="radiogroup" aria-label="Theme">
                  {(['dark', 'midnight', 'amoled'] as const).map((theme) => (
                    <button key={theme} type="button" role="radio" aria-checked={selectedTheme === theme}
                      className={selectedTheme === theme ? 'is-selected' : ''} onClick={() => setSelectedTheme(theme)}>
                      {theme === 'amoled' ? 'AMOLED' : theme[0].toUpperCase() + theme.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <label className="onboarding-toggle">
                <input type="checkbox" checked={showPreviews} onChange={(event) => setShowPreviews(event.target.checked)} />
                <span>Show message previews in notifications</span>
              </label>
              <p className="onboarding-hint">Automatic updates remain protected by Ridgeline&apos;s verified update service.</p>
            </div>
            <Button variant="primary" size="lg" onClick={() => setStep('ready')} style={{ width: '100%' }}>Continue</Button>
          </div>
        )}

        {step === 'ready' && (
          <div className="onboarding-step dl-animate-fadeIn">
            <div className="onboarding-icon"><IconCheck size={36} /></div>
            <p className="onboarding-eyebrow">SETUP COMPLETE</p>
            <h2 className="onboarding-title">Your Ridgeline is ready</h2>
            <p className="onboarding-desc">Signed in as {displayName || accountId}. Your local device identity is ready.</p>
            <div className="onboarding-security-list">
              <span>Direct messages <b>{RIDGELINE_SECURITY_CAPABILITIES.dmE2eeSupported ? 'End-to-end encrypted' : 'Not configured'}</b></span>
              <span>Local vault <b>{preparedSetup ? 'Encrypted and ready' : 'Not configured'}</b></span>
              <span>Group messaging <b>{RIDGELINE_SECURITY_CAPABILITIES.groupE2eeSupported ? 'End-to-end encrypted' : 'Not configured'}</b></span>
              <span>Updates <b>Verified release service</b></span>
            </div>
            {error && <p className="onboarding-error">{error}</p>}
            <Button variant="primary" size="lg" onClick={finishSetup} loading={loading} style={{ width: '100%' }}>
              {loading ? 'Opening Ridgeline…' : 'Open Ridgeline'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
