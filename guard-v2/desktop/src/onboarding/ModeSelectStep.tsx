/**
 * Step 1 — Mode Selection
 *
 * Two large selectable cards: Local Mode vs Online (Connected) Mode.
 * First screen the user sees on fresh install.
 */

import React from 'react';
import type { OnboardingState, OperationMode } from './types';
import {
  OnboardingCard,
  StepHeader,
  SelectCard,
  PrimaryButton,
} from './components';

const LocalIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent-primary">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    <circle cx="12" cy="16" r="1" />
  </svg>
);

const OnlineIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent-secondary">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

interface Props {
  state: OnboardingState;
  onUpdate: (patch: Partial<OnboardingState>) => void;
  onNext: () => void;
}

const ModeSelectStep: React.FC<Props> = ({ state, onUpdate, onNext }) => {
  const setMode = (mode: OperationMode) => onUpdate({ mode });

  return (
    <OnboardingCard>
      {/* Brand mark */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-accent-primary/10 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-primary">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight">Darklock Guard</h1>
          <p className="text-[11px] text-text-muted uppercase tracking-[0.15em]">First-Time Setup</p>
        </div>
      </div>

      <StepHeader
        title="Choose Your Mode"
        subtitle="Select how Darklock Guard operates on this device. This determines how your vault is managed and whether data syncs remotely."
      />

      <div className="grid md:grid-cols-2 gap-4 mb-8">
        <SelectCard
          selected={state.mode === 'local'}
          onClick={() => setMode('local')}
          icon={<LocalIcon />}
          title="Local Mode"
          description="All data stays on this device. Vault is encrypted locally with your master password. No account or internet connection required."
          badge="Maximum Privacy"
        />
        <SelectCard
          selected={state.mode === 'online'}
          onClick={() => setMode('online')}
          icon={<OnlineIcon />}
          title="Online Mode"
          description="Link to your Darklock account. Monitor devices from the web dashboard. Automatic updates and remote policy sync."
          badge="Multi-Device"
          accentColor="accent-secondary"
        />
      </div>

      {/* Security comparison */}
      <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-4 mb-8">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-text-muted mb-3">Security Comparison</h4>
        <div className="grid grid-cols-3 gap-3 text-[12px]">
          <div className="text-text-muted font-medium">Feature</div>
          <div className="text-accent-primary font-medium text-center">Local</div>
          <div className="text-accent-secondary font-medium text-center">Online</div>

          <div className="text-text-secondary">Vault encryption</div>
          <div className="text-center text-semantic-success">✓</div>
          <div className="text-center text-semantic-success">✓</div>

          <div className="text-text-secondary">File integrity scanning</div>
          <div className="text-center text-semantic-success">✓</div>
          <div className="text-center text-semantic-success">✓</div>

          <div className="text-text-secondary">Automatic updates</div>
          <div className="text-center text-text-muted">Manual</div>
          <div className="text-center text-semantic-success">✓</div>

          <div className="text-text-secondary">Remote monitoring</div>
          <div className="text-center text-text-muted">—</div>
          <div className="text-center text-semantic-success">✓</div>

          <div className="text-text-secondary">Account required</div>
          <div className="text-center text-semantic-success">No</div>
          <div className="text-center text-text-muted">Yes</div>

          <div className="text-text-secondary">Internet required</div>
          <div className="text-center text-semantic-success">No</div>
          <div className="text-center text-semantic-warning">For sync</div>
        </div>
      </div>

      <div className="flex justify-end">
        <PrimaryButton onClick={onNext} disabled={!state.mode}>
          Continue
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </PrimaryButton>
      </div>
    </OnboardingCard>
  );
};

export default ModeSelectStep;
