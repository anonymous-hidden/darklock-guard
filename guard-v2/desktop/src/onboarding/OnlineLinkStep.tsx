/**
 * Step 3b — Device Linking (Online Mode)
 *
 * Link this device to the authenticated Darklock Cloud account.
 * Generates device fingerprint and registers with platform.
 */

import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { OnboardingState, SecurityProfile } from './types';
import { platformFetch } from '../lib/api-client';
import {
  OnboardingCard,
  StepHeader,
  SelectCard,
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

const FingerprintIcon = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent-primary">
    <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4" />
    <path d="M5 19.5C5.5 18 6 15 6 12c0-3.5 2.5-6 6-6 1 0 2 .2 3 .6" />
    <path d="M12 10c2 0 3.5 1.5 3.5 3.5 0 3.5-1 6.5-2.5 8.5" />
    <path d="M8.5 16.5c0 3-1 5.5-2 7" />
    <path d="M20 4.5c1.5 2 2 5 2 7.5 0 1-.1 2-.3 3" />
    <path d="M17 11c.3.8.5 1.6.5 2.5 0 2.5-.5 5-1.5 7" />
  </svg>
);

const OnlineLinkStep: React.FC<Props> = ({ state, onUpdate, onNext, onBack }) => {
  const [deviceName, setDeviceName] = useState('');
  const [linking, setLinking] = useState(false);
  const hasInit = useRef(false);

  // Generate device name from OS info
  useEffect(() => {
    if (!hasInit.current) {
      hasInit.current = true;
      const hostname = `darklock-${Math.random().toString(36).slice(2, 8)}`;
      setDeviceName(hostname);
    }
  }, []);

  const extractError = (err: unknown): string => {
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    return 'Device linking failed';
  };

  const handleLink = async () => {
    setLinking(true);
    onUpdate({ error: null });

    try {
      // Step 1: If a stale vault exists from a prior session, remove it first
      const firstRun: any = await invoke('check_first_run');
      if (!firstRun.needs_setup) {
        await invoke('delete_vault');
      }

      // Step 2: Create vault locally (generates device keys)
      const vaultResult: any = await invoke('init_vault', {
        args: {
          password: state.authPassword,
          mode: 'online',
          security_profile: state.securityProfile,
        },
      });

      onUpdate({
        deviceId: vaultResult.device_id,
      });

      // Step 3: Register device with platform
      const token = state.sessionToken || localStorage.getItem('darklock_auth_token');
      const res = await platformFetch(
        '/api/devices/register',
        {
          method: 'POST',
          body: JSON.stringify({
            device_id: vaultResult.device_id,
            public_key: vaultResult.public_key,
            name: deviceName,
            platform: navigator.userAgent.includes('Windows') ? 'windows' : 'linux',
          }),
        },
        token,
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Device registration failed');

      setLinking(false);
      onNext();
    } catch (err: unknown) {
      setLinking(false);
      onUpdate({ error: extractError(err) });
    }
  };

  const setProfile = (p: SecurityProfile) => onUpdate({ securityProfile: p });

  return (
    <OnboardingCard>
      <StepHeader
        title="Link This Device"
        subtitle="Register this device with your Darklock Cloud account. This creates your encryption vault and device identity."
        step={{ current: 2, total: 2 }}
      />

      {state.error && (
        <div className="mb-6">
          <ErrorBanner message={state.error} onDismiss={() => onUpdate({ error: null })} />
        </div>
      )}

      {/* Device identity preview */}
      <div className="flex items-center gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] mb-6">
        <div className="w-14 h-14 rounded-xl bg-accent-primary/10 flex items-center justify-center shrink-0">
          <FingerprintIcon />
        </div>
        <div className="flex-1 min-w-0">
          <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted mb-1.5">Device Name</label>
          <input
            type="text"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            className="w-full bg-transparent border-none outline-none text-sm font-mono text-text-primary placeholder:text-text-muted/50"
            placeholder="my-device"
          />
        </div>
      </div>

      {/* Security Profile selector */}
      <div className="mb-6">
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted mb-3">Security Profile</h3>
        <div className="grid md:grid-cols-2 gap-3">
          <SelectCard
            selected={state.securityProfile === 'standard'}
            onClick={() => setProfile('standard')}
            icon={<ShieldIcon />}
            title="Standard"
            description="Balanced protection with cloud sync and auto-updates."
            badge="Recommended"
          />
          <SelectCard
            selected={state.securityProfile === 'zerotrust'}
            onClick={() => setProfile('zerotrust')}
            icon={<LockIcon />}
            title="Zero-Trust"
            description="Maximum security. Vault locks on suspend, requires frequent auth."
            badge="High Security"
            accentColor="state-zerotrust"
          />
        </div>
      </div>

      {/* What will happen */}
      <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-4 mb-6">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted mb-3">What happens next</h4>
        <div className="space-y-2">
          {[
            'DLOCK02 vault created with Argon2id key derivation',
            'Ed25519 device keypair generated',
            'Device registered with Darklock Cloud',
            'Encrypted sync channel established',
          ].map((text, i) => (
            <div key={i} className="flex items-center gap-2.5 text-xs text-text-secondary">
              <div className="w-5 h-5 rounded-full bg-accent-primary/10 flex items-center justify-center shrink-0">
                <span className="text-[10px] font-bold text-accent-primary">{i + 1}</span>
              </div>
              {text}
            </div>
          ))}
        </div>
      </div>

      {linking && (
        <WarningNote>
          Creating vault and registering device. Do not close the application.
        </WarningNote>
      )}

      <div className="flex justify-between mt-6">
        <GhostButton onClick={onBack} disabled={linking}>Back</GhostButton>
        <PrimaryButton onClick={handleLink} loading={linking} disabled={!deviceName.trim()}>
          Create Vault & Link Device
        </PrimaryButton>
      </div>
    </OnboardingCard>
  );
};

export default OnlineLinkStep;
