/**
 * Step 3a — Online Authentication
 *
 * Login or Register for Darklock Cloud.
 * Tabbed interface for existing users vs new signups.
 */

import React, { useState } from 'react';
import type { AuthTab, OnboardingState } from './types';
import { validateEmail, validateUsername, validatePassword } from './utils';
import { platformFetch } from '../lib/api-client';
import {
  OnboardingCard,
  StepHeader,
  TextInput,
  PasswordInput,
  PrimaryButton,
  GhostButton,
  ErrorBanner,
} from './components';

interface Props {
  state: OnboardingState;
  onUpdate: (patch: Partial<OnboardingState>) => void;
  onNext: () => void;
}

const OnlineAuthStep: React.FC<Props> = ({ state, onUpdate, onNext }) => {
  const [localError, setLocalError] = useState<string | null>(null);
  const tab = state.authTab;
  const setTab = (t: AuthTab) => {
    onUpdate({ authTab: t, error: null });
    setLocalError(null);
  };

  const handleLogin = async () => {
    setLocalError(null);
    if (!validateEmail(state.email)) {
      setLocalError('Please enter a valid email address');
      return;
    }
    if (!state.authPassword) {
      setLocalError('Please enter your password');
      return;
    }
    onUpdate({ loading: true, error: null });
    try {
      const res = await platformFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: state.email, password: state.authPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');
      localStorage.setItem('darklock_auth_token', data.token);
      onUpdate({
        sessionToken: data.token,
        loading: false,
      });
      onNext();
    } catch (err: any) {
      onUpdate({ loading: false });
      setLocalError(err.message || 'Connection failed. Check your network.');
    }
  };

  const handleRegister = async () => {
    setLocalError(null);
    const usernameErr = validateUsername(state.username);
    if (usernameErr) { setLocalError(usernameErr); return; }
    if (!validateEmail(state.email)) { setLocalError('Please enter a valid email address'); return; }
    const pwErr = validatePassword(state.authPassword);
    if (pwErr) { setLocalError(pwErr); return; }
    if (state.authPassword !== state.authConfirmPassword) {
      setLocalError('Passwords do not match');
      return;
    }

    onUpdate({ loading: true, error: null });
    try {
      const res = await platformFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username: state.username,
          email: state.email,
          password: state.authPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      localStorage.setItem('darklock_auth_token', data.token);
      onUpdate({
        sessionToken: data.token,
        loading: false,
      });
      onNext();
    } catch (err: any) {
      onUpdate({ loading: false });
      setLocalError(err.message || 'Connection failed. Check your network.');
    }
  };

  return (
    <OnboardingCard>
      <StepHeader
        title="Darklock Cloud"
        subtitle="Sign in to enable remote management, encrypted cloud sync, and real-time threat intelligence."
        step={{ current: 1, total: 2 }}
      />

      {/* Tab switcher */}
      <div className="flex border-b border-white/[0.06] mb-6">
        {(['login', 'register'] as AuthTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`
              flex-1 pb-3 text-sm font-medium transition-all duration-200 relative
              ${tab === t ? 'text-accent-primary' : 'text-text-muted hover:text-text-secondary'}
            `}
          >
            {t === 'login' ? 'Sign In' : 'Create Account'}
            {tab === t && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-primary rounded-full" />
            )}
          </button>
        ))}
      </div>

      {(localError || state.error) && (
        <div className="mb-4">
          <ErrorBanner
            message={localError || state.error!}
            onDismiss={() => { setLocalError(null); onUpdate({ error: null }); }}
          />
        </div>
      )}

      {tab === 'login' ? (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wider">Email</label>
            <TextInput
              value={state.email}
              onChange={(v) => onUpdate({ email: v })}
              placeholder="you@example.com"
              type="email"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wider">Password</label>
            <PasswordInput
              value={state.authPassword}
              onChange={(v) => onUpdate({ authPassword: v })}
              placeholder="Your password"
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <a href="https://darklock.net/forgot-password" target="_blank" rel="noopener noreferrer" className="text-accent-primary hover:underline">
              Forgot password?
            </a>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wider">Username</label>
            <TextInput
              value={state.username}
              onChange={(v) => onUpdate({ username: v })}
              placeholder="your_username"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wider">Email</label>
            <TextInput
              value={state.email}
              onChange={(v) => onUpdate({ email: v })}
              placeholder="you@example.com"
              type="email"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wider">Password</label>
            <PasswordInput
              value={state.authPassword}
              onChange={(v) => onUpdate({ authPassword: v })}
              placeholder="Min 12 characters"
              showStrength
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wider">Confirm Password</label>
            <PasswordInput
              value={state.authConfirmPassword}
              onChange={(v) => onUpdate({ authConfirmPassword: v })}
              placeholder="Repeat your password"
            />
          </div>
        </div>
      )}

      <div className="flex justify-end mt-8">
        <PrimaryButton
          onClick={tab === 'login' ? handleLogin : handleRegister}
          loading={state.loading}
        >
          {tab === 'login' ? 'Sign In' : 'Create Account'}
        </PrimaryButton>
      </div>

      <p className="text-center text-[11px] text-text-muted mt-6">
        Your credentials are transmitted over TLS and never stored locally in plaintext.
      </p>
    </OnboardingCard>
  );
};

export default OnlineAuthStep;
