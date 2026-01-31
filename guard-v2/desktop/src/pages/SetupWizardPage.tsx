import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const steps = ['mode', 'password', 'profile', 'tour'] as const;
type Step = (typeof steps)[number];

const SetupWizardPage: React.FC = () => {
  const [step, setStep] = useState<Step>('mode');
  const [mode, setMode] = useState<'local' | 'connected'>('local');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [profile, setProfile] = useState<'standard' | 'zerotrust'>('standard');
  const navigate = useNavigate();

  const next = () => {
    const idx = steps.indexOf(step);
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
        <div className="text-xl font-semibold">Setup Wizard</div>
        {step === 'mode' && (
          <div className="grid md:grid-cols-2 gap-4">
            <button
              onClick={() => setMode('local')}
              className={`p-4 rounded-lg border ${mode === 'local' ? 'border-accent-primary bg-[rgba(0,240,255,0.05)]' : 'border-[rgba(148,163,184,0.2)]'}`}
            >
              <div className="text-lg font-semibold">Local Only</div>
              <div className="text-sm text-text-muted">All data stays on this device. No account required.</div>
            </button>
            <button
              onClick={() => setMode('connected')}
              disabled
              title="Connected mode not yet available"
              className={`p-4 rounded-lg border border-[rgba(148,163,184,0.2)] text-text-muted cursor-not-allowed`}
            >
              <div className="text-lg font-semibold">Connected (Coming Soon)</div>
              <div className="text-sm text-text-muted">Planned cloud sync. Disabled for now.</div>
            </button>
          </div>
        )}

        {step === 'password' && (
          <div className="space-y-3">
            <div className="text-sm text-text-secondary">Create your vault password (no recovery).</div>
            <input
              type="password"
              className="w-full bg-bg-secondary border border-[rgba(148,163,184,0.2)] rounded-md px-3 py-2"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <input
              type="password"
              className="w-full bg-bg-secondary border border-[rgba(148,163,184,0.2)] rounded-md px-3 py-2"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <div className="text-xs text-text-muted">Password recovery is impossible. Keep it safe.</div>
          </div>
        )}

        {step === 'profile' && (
          <div className="space-y-3">
            <div className="text-sm text-text-secondary">Choose your security profile.</div>
            <div className="grid md:grid-cols-2 gap-4">
              <button
                onClick={() => setProfile('standard')}
                className={`p-4 rounded-lg border ${profile === 'standard' ? 'border-accent-primary bg-[rgba(0,240,255,0.05)]' : 'border-[rgba(148,163,184,0.2)]'}`}
              >
                <div className="text-lg font-semibold">Standard</div>
                <div className="text-sm text-text-muted">Balanced security and convenience.</div>
              </button>
              <button
                onClick={() => setProfile('zerotrust')}
                className={`p-4 rounded-lg border ${profile === 'zerotrust' ? 'border-state-zerotrust bg-[rgba(236,72,153,0.08)]' : 'border-[rgba(148,163,184,0.2)]'}`}
              >
                <div className="text-lg font-semibold">Zero-Trust</div>
                <div className="text-sm text-text-muted">Maximum security; may interrupt workflow.</div>
              </button>
            </div>
            <div className="text-xs text-semantic-warning">Zero-Trust locks on suspend and may prompt often.</div>
          </div>
        )}

        {step === 'tour' && (
          <div className="space-y-3">
            <div className="text-sm text-text-secondary">Optional quick tour of the interface.</div>
            <div className="text-xs text-text-muted">Tour overlays will highlight navigation, status, events, and settings.</div>
          </div>
        )}

        <div className="flex justify-between pt-4">
          <button onClick={back} className="text-sm text-text-secondary hover:text-text-primary">Back</button>
          <div className="flex gap-2">
            <button onClick={() => navigate('/')} className="text-sm text-text-secondary hover:text-text-primary">Skip</button>
            <button
              onClick={next}
              disabled={step === 'password' && (password.length < 12 || password !== confirm)}
              className={`px-4 py-2 rounded-md text-sm ${
                step === 'password' && (password.length < 12 || password !== confirm)
                  ? 'bg-text-muted text-bg-secondary cursor-not-allowed'
                  : 'bg-accent-primary text-bg-primary shadow-glow'
              }`}
            >
              {step === 'tour' ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SetupWizardPage;
