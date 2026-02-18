/**
 * Step 5 — Welcome Screen
 *
 * Vault created successfully. Show welcome message and summary,
 * then offer to take the guided tour or skip to dashboard.
 */

import React from 'react';
import type { OnboardingState } from './types';
import { OnboardingCard, PrimaryButton, GhostButton } from './components';

interface Props {
  state: OnboardingState;
  onStartTour: () => void;
  onSkip: () => void;
}

const WelcomeStep: React.FC<Props> = ({ state, onStartTour, onSkip }) => {
  return (
    <OnboardingCard>
      <div className="text-center py-4">
        {/* Success icon with animated ring */}
        <div className="relative w-20 h-20 mx-auto mb-6">
          <div className="absolute inset-0 rounded-full bg-semantic-success/10 animate-[ping_2s_ease-in-out_1]" />
          <div className="absolute inset-0 rounded-full bg-semantic-success/5 flex items-center justify-center border border-semantic-success/20">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-semantic-success">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>

        <h2 className="text-2xl font-bold mb-2">Welcome to Darklock Guard</h2>
        <p className="text-sm text-text-secondary mb-8 max-w-md mx-auto leading-relaxed">
          Your vault is encrypted and ready. Real-time file integrity monitoring is active.
          Your system is now protected.
        </p>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-3 max-w-lg mx-auto mb-8">
          {[
            {
              label: 'Mode',
              value: state.mode === 'local' ? 'Local' : 'Online',
              icon: state.mode === 'local' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-primary">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-primary">
                  <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              ),
            },
            {
              label: 'Profile',
              value: state.securityProfile === 'zerotrust' ? 'Zero-Trust' : 'Standard',
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-primary">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              ),
            },
            {
              label: 'Vault',
              value: 'DLOCK02',
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-primary">
                  <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              ),
            },
          ].map((stat) => (
            <div key={stat.label} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
              <div className="flex items-center justify-center mb-2">{stat.icon}</div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-0.5">{stat.label}</div>
              <div className="text-xs font-semibold">{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Divider with text */}
        <div className="flex items-center gap-3 mb-6 max-w-xs mx-auto">
          <div className="flex-1 h-px bg-white/[0.06]" />
          <span className="text-[11px] text-text-muted uppercase tracking-wider">Get Started</span>
          <div className="flex-1 h-px bg-white/[0.06]" />
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <PrimaryButton onClick={onStartTour} className="min-w-[180px]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" />
            </svg>
            Take the Tour
          </PrimaryButton>
          <GhostButton onClick={onSkip}>
            Skip to Dashboard
          </GhostButton>
        </div>
      </div>
    </OnboardingCard>
  );
};

export default WelcomeStep;
