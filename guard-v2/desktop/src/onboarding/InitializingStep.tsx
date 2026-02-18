/**
 * Step 4 — Initializing Vault (Local Mode)
 *
 * Animated vault creation screen.
 * Calls init_vault, shows progress stages, then advances.
 */

import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { OnboardingState } from './types';
import { OnboardingCard, ErrorBanner, PrimaryButton } from './components';

interface Props {
  state: OnboardingState;
  onUpdate: (patch: Partial<OnboardingState>) => void;
  onNext: () => void;
}

const STAGES = [
  { label: 'Deriving encryption key (Argon2id)…', duration: 1200 },
  { label: 'Generating Ed25519 device keypair…', duration: 800 },
  { label: 'Creating DLOCK02 vault…', duration: 600 },
  { label: 'Initializing integrity baseline…', duration: 500 },
  { label: 'Securing IPC channel…', duration: 400 },
];

const InitializingStep: React.FC<Props> = ({ state, onUpdate, onNext }) => {
  const [stageIdx, setStageIdx] = useState(0);
  const [failed, setFailed] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const runInit = async () => {
      try {
        // Animate through stages while vault is being created
        const vaultPromise = invoke('init_vault', {
          args: {
            password: state.password,
            mode: state.mode || 'local',
            security_profile: state.securityProfile,
          },
        });

        // Walk through visual stages
        for (let i = 0; i < STAGES.length; i++) {
          setStageIdx(i);
          onUpdate({
            initStage: STAGES[i].label,
            initProgress: ((i + 1) / STAGES.length) * 100,
          });
          await new Promise((r) => setTimeout(r, STAGES[i].duration));
        }

        // Await actual vault creation
        const result: any = await vaultPromise;

        onUpdate({
          vaultCreated: true,
          deviceId: result.device_id,
          initProgress: 100,
          initStage: 'Complete',
        });

        // Brief pause to show completion
        await new Promise((r) => setTimeout(r, 600));

        onNext();
      } catch (err: any) {
        setFailed(true);
        onUpdate({
          error: err.message || 'Vault creation failed',
          loading: false,
        });
      }
    };

    runInit();
  }, []);

  const progress = ((stageIdx + 1) / STAGES.length) * 100;

  return (
    <OnboardingCard>
      <div className="text-center py-8">
        {/* Animated vault icon */}
        <div className="relative w-24 h-24 mx-auto mb-8">
          <div className="absolute inset-0 rounded-full bg-accent-primary/10 animate-pulse" />
          <div className="absolute inset-2 rounded-full bg-accent-primary/5 flex items-center justify-center">
            {!failed ? (
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent-primary animate-pulse">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            ) : (
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-semantic-error">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            )}
          </div>
          {/* Spinning ring */}
          {!failed && (
            <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="2" />
              <circle
                cx="50"
                cy="50"
                r="46"
                fill="none"
                stroke="url(#progress-gradient)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={`${progress * 2.89} 289`}
                className="transition-all duration-500"
              />
              <defs>
                <linearGradient id="progress-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#00f0ff" />
                  <stop offset="100%" stopColor="#7c3aed" />
                </linearGradient>
              </defs>
            </svg>
          )}
        </div>

        {!failed ? (
          <>
            <h2 className="text-xl font-bold mb-2">Creating Your Vault</h2>
            <p className="text-sm text-text-secondary mb-8">
              Setting up cryptographic protection. This may take a moment.
            </p>

            {/* Progress bar */}
            <div className="max-w-sm mx-auto mb-4">
              <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent-primary to-accent-secondary transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Stage list */}
            <div className="max-w-sm mx-auto text-left space-y-2.5">
              {STAGES.map((s, i) => (
                <div key={i} className="flex items-center gap-2.5 text-xs">
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center transition-all duration-300 ${
                    i < stageIdx
                      ? 'bg-accent-primary text-bg-primary'
                      : i === stageIdx
                        ? 'bg-accent-primary/20 border border-accent-primary/40'
                        : 'bg-white/[0.04] border border-white/[0.06]'
                  }`}>
                    {i < stageIdx ? (
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : i === stageIdx ? (
                      <div className="w-1.5 h-1.5 rounded-full bg-accent-primary animate-pulse" />
                    ) : null}
                  </div>
                  <span className={`transition-colors duration-300 ${
                    i <= stageIdx ? 'text-text-secondary' : 'text-text-muted/50'
                  }`}>
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <h2 className="text-xl font-bold mb-2 text-semantic-error">Vault Creation Failed</h2>
            <div className="max-w-sm mx-auto mt-4">
              <ErrorBanner message={state.error || 'An unknown error occurred'} />
            </div>
            <div className="mt-6">
              <PrimaryButton
                onClick={() => {
                  ran.current = false;
                  setFailed(false);
                  setStageIdx(0);
                  onUpdate({ error: null });
                  // Re-trigger effect  
                  window.location.reload();
                }}
              >
                Retry
              </PrimaryButton>
            </div>
          </>
        )}
      </div>
    </OnboardingCard>
  );
};

export default InitializingStep;
