/**
 * Step 2b — Local Update Preferences
 *
 * Configure how updates are handled in local mode.
 * Manual updates only — toggle for notifications.
 */

import React from 'react';
import type { OnboardingState, SecurityProfile } from './types';
import {
  OnboardingCard,
  StepHeader,
  SelectCard,
  Toggle,
  PrimaryButton,
  GhostButton,
  WarningNote,
} from './components';

interface Props {
  state: OnboardingState;
  onUpdate: (patch: Partial<OnboardingState>) => void;
  onNext: () => void;
  onBack: () => void;
}

const ShieldIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent-primary">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const LockIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-state-zerotrust">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    <circle cx="12" cy="16" r="1" />
  </svg>
);

const LocalConfigStep: React.FC<Props> = ({ state, onUpdate, onNext, onBack }) => {
  const setProfile = (p: SecurityProfile) => onUpdate({ securityProfile: p });

  return (
    <OnboardingCard>
      <StepHeader
        title="Security & Updates"
        subtitle="Configure your security profile and update preferences. These can be changed later in Settings."
        step={{ current: 2, total: 3 }}
      />

      {/* Security Profile */}
      <div className="mb-6">
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted mb-3">Security Profile</h3>
        <div className="grid md:grid-cols-2 gap-3">
          <SelectCard
            selected={state.securityProfile === 'standard'}
            onClick={() => setProfile('standard')}
            icon={<ShieldIcon />}
            title="Standard"
            description="Balanced protection. Real-time monitoring active, vault stays unlocked during your session."
            badge="Recommended"
          />
          <SelectCard
            selected={state.securityProfile === 'zerotrust'}
            onClick={() => setProfile('zerotrust')}
            icon={<LockIcon />}
            title="Zero-Trust"
            description="Maximum security. Vault locks on suspend, frequent re-authentication required."
            badge="High Security"
            accentColor="state-zerotrust"
          />
        </div>
      </div>

      {/* Update preferences */}
      <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-4 mb-6">
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted mb-3">Update Preferences</h3>
        <WarningNote>
          In <strong>Local Mode</strong>, updates must be downloaded and installed manually.
          Darklock Guard will never auto-download or execute code without your explicit action.
        </WarningNote>
        <div className="mt-3">
          <Toggle
            enabled={state.manualUpdateNotifications}
            onChange={(v) => onUpdate({ manualUpdateNotifications: v })}
            label="Update Notifications"
            description="Check for new releases on startup and notify when updates are available"
          />
        </div>
      </div>

      {/* Summary */}
      <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-4 mb-8">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted mb-3">Setup Summary</h4>
        <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-xs">
          <span className="text-text-muted">Mode</span>
          <span className="text-text-secondary font-medium">Local (Offline)</span>
          <span className="text-text-muted">Security Profile</span>
          <span className="text-text-secondary font-medium">{state.securityProfile === 'zerotrust' ? 'Zero-Trust' : 'Standard'}</span>
          <span className="text-text-muted">Vault Encryption</span>
          <span className="text-text-secondary font-mono">DLOCK02 + Argon2id</span>
          <span className="text-text-muted">Updates</span>
          <span className="text-text-secondary font-medium">{state.manualUpdateNotifications ? 'Manual + Notifications' : 'Manual Only'}</span>
        </div>
      </div>

      <div className="flex justify-between">
        <GhostButton onClick={onBack}>Back</GhostButton>
        <PrimaryButton onClick={onNext}>
          Create Vault & Initialize
        </PrimaryButton>
      </div>
    </OnboardingCard>
  );
};

export default LocalConfigStep;
