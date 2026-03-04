/**
 * Step 2a — Local Password Creation
 *
 * Secure master password creation for local-only vault.
 * Argon2id KDF, irrecoverable, minimum 12 chars with complexity requirements.
 */

import React from 'react';
import type { OnboardingState } from './types';
import { validatePassword } from './utils';
import {
  OnboardingCard,
  StepHeader,
  PasswordInput,
  PrimaryButton,
  GhostButton,
  ErrorBanner,
  WarningNote,
} from './components';

interface Props {
  state: OnboardingState;
  onUpdate: (patch: Partial<OnboardingState>) => void;
  onNext: () => void;
  onBack: () => void;
}

const LocalPasswordStep: React.FC<Props> = ({ state, onUpdate, onNext, onBack }) => {
  const passwordError = state.password ? validatePassword(state.password) : null;
  const mismatch = state.confirmPassword.length > 0 && state.password !== state.confirmPassword;
  const canProceed =
    state.password.length >= 12 &&
    !passwordError &&
    state.password === state.confirmPassword;

  return (
    <OnboardingCard>
      <StepHeader
        title="Create Vault Password"
        subtitle="This master password encrypts your vault using Argon2id key derivation. Choose something strong — it cannot be recovered."
        step={{ current: 1, total: 3 }}
      />

      {state.error && <ErrorBanner message={state.error} onDismiss={() => onUpdate({ error: null })} />}

      <div className="space-y-5 mb-8">
        <div>
          <label className="block text-xs font-medium text-text-muted uppercase tracking-wider mb-2">Master Password</label>
          <PasswordInput
            value={state.password}
            onChange={(v) => onUpdate({ password: v })}
            placeholder="Enter a strong master password"
            showStrength
            autoFocus
          />
          {passwordError && state.password.length > 0 && (
            <p className="text-xs text-semantic-warning mt-2 flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {passwordError}
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-text-muted uppercase tracking-wider mb-2">Confirm Password</label>
          <PasswordInput
            value={state.confirmPassword}
            onChange={(v) => onUpdate({ confirmPassword: v })}
            placeholder="Confirm your master password"
          />
          {mismatch && (
            <p className="text-xs text-semantic-error mt-2">Passwords do not match</p>
          )}
        </div>

        {/* Password requirements */}
        <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted mb-3">Requirements</h4>
          <div className="grid grid-cols-2 gap-2">
            {[
              { met: state.password.length >= 12, text: '12+ characters' },
              { met: /[A-Z]/.test(state.password), text: 'Uppercase letter' },
              { met: /[a-z]/.test(state.password), text: 'Lowercase letter' },
              { met: /\d/.test(state.password), text: 'Number' },
              { met: /[^A-Za-z0-9]/.test(state.password), text: 'Special character' },
              { met: state.password.length >= 16, text: '16+ chars (recommended)' },
            ].map((req) => (
              <div key={req.text} className="flex items-center gap-2 text-xs">
                <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center transition-colors duration-200 ${
                  req.met ? 'bg-semantic-success/20' : 'bg-white/[0.04]'
                }`}>
                  {req.met ? (
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="text-semantic-success">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-text-muted/40" />
                  )}
                </div>
                <span className={req.met ? 'text-text-secondary' : 'text-text-muted'}>{req.text}</span>
              </div>
            ))}
          </div>
        </div>

        <WarningNote>
          <strong className="text-semantic-warning">Irrecoverable.</strong> Your vault is encrypted with Argon2id key derivation.
          There is no password reset, no recovery key, and no backdoor. If you lose this password, your vault data is permanently inaccessible.
        </WarningNote>
      </div>

      {/* Crypto details */}
      <div className="flex items-center gap-3 mb-8 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-primary shrink-0">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <p className="text-[11px] text-text-muted leading-relaxed">
          <span className="font-mono text-text-secondary">DLOCK02</span> vault format &middot;
          <span className="font-mono text-text-secondary"> Argon2id</span> KDF &middot;
          <span className="font-mono text-text-secondary"> Ed25519</span> signing &middot;
          <span className="font-mono text-text-secondary"> BLAKE3</span> integrity
        </p>
      </div>

      <div className="flex justify-between">
        <GhostButton onClick={onBack}>Back</GhostButton>
        <PrimaryButton onClick={onNext} disabled={!canProceed}>
          Continue
        </PrimaryButton>
      </div>
    </OnboardingCard>
  );
};

export default LocalPasswordStep;
