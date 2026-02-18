import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';

const steps = ['mode', 'password', 'profile', 'tour'] as const;
type Step = (typeof steps)[number];

const strengthLabels = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
const strengthColors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-blue-400', 'bg-green-500'];

function getPasswordStrength(pw: string): number {
  let score = 0;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(4, score);
}

const SetupWizardPage: React.FC = () => {
  const [step, setStep] = useState<Step>('mode');
  const [mode, setMode] = useState<'local' | 'connected'>('local');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [profile, setProfile] = useState<'standard' | 'zerotrust'>('standard');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [vaultCreated, setVaultCreated] = useState(false);
  const navigate = useNavigate();

  const strength = useMemo(() => getPasswordStrength(password), [password]);

  const initializeVault = async () => {
    setLoading(true);
    setError('');
    try {
      await invoke('init_vault', {
        args: {
          password,
          mode,
          security_profile: profile,
        },
      });
      setVaultCreated(true);
      setStep('tour');
    } catch (e: any) {
      setError(typeof e === 'string' ? e : e?.message || 'Vault creation failed');
    } finally {
      setLoading(false);
    }
  };

  const next = () => {
    const idx = steps.indexOf(step);
    if (step === 'profile') {
      // On profile step, create the vault
      initializeVault();
      return;
    }
    if (idx < steps.length - 1) setStep(steps[idx + 1]);
    else navigate('/');
  };

  const back = () => {
    const idx = steps.indexOf(step);
    if (idx > 0) setStep(steps[idx - 1]);
    else navigate('/');
  };

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center p-6">
      <div className="w-full max-w-3xl bg-bg-card border border-[rgba(148,163,184,0.1)] rounded-xl p-8 space-y-6">
        {/* Progress bar */}
        <div className="flex items-center gap-2 mb-2">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                steps.indexOf(step) >= i
                  ? 'bg-accent-primary text-bg-primary'
                  : 'bg-bg-secondary text-text-muted'
              }`}>{i + 1}</div>
              {i < steps.length - 1 && (
                <div className={`flex-1 h-0.5 ${steps.indexOf(step) > i ? 'bg-accent-primary' : 'bg-bg-secondary'}`} />
              )}
            </div>
          ))}
        </div>

        <div className="text-xl font-semibold">
          {step === 'mode' && 'Choose Operation Mode'}
          {step === 'password' && 'Create Vault Password'}
          {step === 'profile' && 'Security Profile'}
          {step === 'tour' && (vaultCreated ? '✓ Setup Complete' : 'Quick Tour')}
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        {step === 'mode' && (
          <div className="grid md:grid-cols-2 gap-4">
            <button
              onClick={() => setMode('local')}
              className={`p-4 rounded-lg border text-left ${mode === 'local' ? 'border-accent-primary bg-[rgba(0,240,255,0.05)]' : 'border-[rgba(148,163,184,0.2)]'}`}
            >
              <div className="text-lg font-semibold">🔒 Local Only</div>
              <div className="text-sm text-text-muted mt-1">All data stays on this device. No account required. Full offline operation.</div>
            </button>
            <button
              onClick={() => setMode('connected')}
              className={`p-4 rounded-lg border text-left ${mode === 'connected' ? 'border-accent-primary bg-[rgba(0,240,255,0.05)]' : 'border-[rgba(148,163,184,0.2)]'}`}
            >
              <div className="text-lg font-semibold">🌐 Connected</div>
              <div className="text-sm text-text-muted mt-1">Link to your Darklock account. Monitor devices from the web dashboard.</div>
            </button>
          </div>
        )}

        {step === 'password' && (
          <div className="space-y-4">
            <div className="text-sm text-text-secondary">
              Create a strong master password for your encrypted vault. This password <strong>cannot be recovered</strong>.
            </div>
            <div>
              <input
                type="password"
                className="w-full bg-bg-secondary border border-[rgba(148,163,184,0.2)] rounded-md px-3 py-2"
                placeholder="Enter master password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {password && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= strength ? strengthColors[strength] : 'bg-bg-secondary'}`} />
                    ))}
                  </div>
                  <span className="text-xs text-text-muted">{strengthLabels[strength]}</span>
                </div>
              )}
            </div>
            <input
              type="password"
              className="w-full bg-bg-secondary border border-[rgba(148,163,184,0.2)] rounded-md px-3 py-2"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {confirm && password !== confirm && (
              <div className="text-xs text-red-400">Passwords do not match</div>
            )}
            <div className="text-xs text-text-muted">
              ⚠️ Your vault is encrypted with Argon2id key derivation. If you lose this password, your vault data is irrecoverable.
            </div>
          </div>
        )}

        {step === 'profile' && (
          <div className="space-y-4">
            <div className="text-sm text-text-secondary">Choose how aggressively the guard service monitors your system.</div>
            <div className="grid md:grid-cols-2 gap-4">
              <button
                onClick={() => setProfile('standard')}
                className={`p-4 rounded-lg border text-left ${profile === 'standard' ? 'border-accent-primary bg-[rgba(0,240,255,0.05)]' : 'border-[rgba(148,163,184,0.2)]'}`}
              >
                <div className="text-lg font-semibold">🛡️ Standard</div>
                <div className="text-sm text-text-muted mt-1">Balanced security. File monitoring active, vault stays unlocked during session.</div>
              </button>
              <button
                onClick={() => setProfile('zerotrust')}
                className={`p-4 rounded-lg border text-left ${profile === 'zerotrust' ? 'border-state-zerotrust bg-[rgba(236,72,153,0.08)]' : 'border-[rgba(148,163,184,0.2)]'}`}
              >
                <div className="text-lg font-semibold">🔐 Zero-Trust</div>
                <div className="text-sm text-text-muted mt-1">Maximum security. Vault locks on suspend, frequent re-authentication.</div>
              </button>
            </div>
          </div>
        )}

        {step === 'tour' && (
          <div className="space-y-4">
            {vaultCreated ? (
              <>
                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400">
                  <div className="font-semibold mb-1">Vault created successfully!</div>
                  <div className="text-sm">Your encrypted vault has been initialized with Ed25519 signing keys and an integrity baseline.</div>
                </div>
                <div className="text-sm text-text-secondary space-y-2">
                  <div>Here's what was set up:</div>
                  <ul className="list-disc list-inside space-y-1 text-text-muted text-sm">
                    <li>Encrypted DLOCK02 vault with Argon2 key derivation</li>
                    <li>Ed25519 device signing key pair</li>
                    <li>HMAC-authenticated IPC secret</li>
                    <li>Guard service configuration ({profile === 'zerotrust' ? 'Zero-Trust' : 'Standard'} profile)</li>
                  </ul>
                </div>
              </>
            ) : (
              <div className="text-sm text-text-secondary">Optional quick tour of the interface.</div>
            )}
          </div>
        )}

        <div className="flex justify-between pt-4">
          <button onClick={back} className="text-sm text-text-secondary hover:text-text-primary">
            {step === 'tour' && vaultCreated ? '' : 'Back'}
          </button>
          <div className="flex gap-2">
            {!(step === 'tour' && vaultCreated) && (
              <button onClick={() => navigate('/')} className="text-sm text-text-secondary hover:text-text-primary">Skip</button>
            )}
            <button
              onClick={next}
              disabled={(step === 'password' && (password.length < 12 || password !== confirm)) || loading}
              className={`px-4 py-2 rounded-md text-sm flex items-center gap-2 ${
                (step === 'password' && (password.length < 12 || password !== confirm)) || loading
                  ? 'bg-text-muted text-bg-secondary cursor-not-allowed'
                  : 'bg-accent-primary text-bg-primary shadow-glow'
              }`}
            >
              {loading && <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />}
              {step === 'tour' ? 'Launch Darklock Guard' : step === 'profile' ? 'Create Vault' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SetupWizardPage;
