import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

const PASSWORD_REQUIREMENTS = [
  { test: (p) => p.length >= 12, label: '12+ characters' },
  { test: (p) => /[A-Z]/.test(p), label: 'Uppercase letter' },
  { test: (p) => /[a-z]/.test(p), label: 'Lowercase letter' },
  { test: (p) => /[0-9]/.test(p), label: 'Number' },
  { test: (p) => /[^A-Za-z0-9]/.test(p), label: 'Special character' },
];

function getPasswordStrength(password) {
  const met = PASSWORD_REQUIREMENTS.filter(r => r.test(password)).length;
  if (met <= 1) return { label: 'Very Weak', color: '#ed4245', pct: 20 };
  if (met <= 2) return { label: 'Weak', color: '#ed4245', pct: 40 };
  if (met <= 3) return { label: 'Fair', color: '#f0b232', pct: 60 };
  if (met <= 4) return { label: 'Strong', color: '#23a55a', pct: 80 };
  return { label: 'Very Strong', color: '#23a55a', pct: 100 };
}

export default function Register({ onSwitch }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();

  const strength = getPasswordStrength(password);
  const allRequirementsMet = PASSWORD_REQUIREMENTS.every(r => r.test(password));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
      return setError('Username must be 3-32 characters (letters, numbers, underscores)');
    }
    if (!allRequirementsMet) {
      return setError('Password does not meet all requirements');
    }
    if (password !== confirmPassword) {
      return setError('Passwords do not match');
    }
    if (!agreedToTerms) {
      return setError('You must agree to the zero-knowledge terms');
    }

    setLoading(true);
    try {
      await register(username, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#1e1f22]">
      {/* Titlebar */}
      <div className="titlebar-drag h-8 flex items-center justify-end px-2 shrink-0">
        <button onClick={() => window.darklock.window.minimize()} className="w-8 h-8 flex items-center justify-center hover:bg-bg-hover rounded text-text-muted">
          <svg width="12" height="12" viewBox="0 0 12 12"><rect y="5" width="12" height="2" fill="currentColor"/></svg>
        </button>
        <button onClick={() => window.darklock.window.maximize()} className="w-8 h-8 flex items-center justify-center hover:bg-bg-hover rounded text-text-muted">
          <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
        </button>
        <button onClick={() => window.darklock.window.close()} className="w-8 h-8 flex items-center justify-center hover:bg-danger rounded text-text-muted hover:text-white">
          <svg width="12" height="12" viewBox="0 0 12 12"><line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5"/><line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1.5"/></svg>
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center overflow-y-auto py-8">
        <div className="w-full max-w-md bg-[#313338] rounded-lg p-8 shadow-2xl">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-accent rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-text-primary">Create an account</h1>
          </div>

          {error && (
            <div className="bg-danger/10 border border-danger/30 text-danger text-sm rounded px-3 py-2 mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase mb-2">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-[#1e1f22] border-none rounded px-3 py-2.5 text-text-primary outline-none focus:ring-2 focus:ring-accent"
                placeholder="3-32 chars, letters/numbers/underscores"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#1e1f22] border-none rounded px-3 py-2.5 text-text-primary outline-none focus:ring-2 focus:ring-accent"
                required
              />
              {password && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex-1 h-1.5 bg-[#1e1f22] rounded overflow-hidden">
                      <div className="h-full rounded transition-all" style={{ width: `${strength.pct}%`, backgroundColor: strength.color }} />
                    </div>
                    <span className="text-xs" style={{ color: strength.color }}>{strength.label}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {PASSWORD_REQUIREMENTS.map((req) => (
                      <span key={req.label} className={`text-xs ${req.test(password) ? 'text-success' : 'text-text-muted'}`}>
                        {req.test(password) ? '✓' : '○'} {req.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase mb-2">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-[#1e1f22] border-none rounded px-3 py-2.5 text-text-primary outline-none focus:ring-2 focus:ring-accent"
                required
              />
              {confirmPassword && password !== confirmPassword && (
                <p className="text-danger text-xs mt-1">Passwords do not match</p>
              )}
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="w-4 h-4 rounded accent-accent"
              />
              <span className="text-sm text-text-secondary">
                I agree to the zero-knowledge privacy terms
              </span>
            </label>

            <button
              type="submit"
              disabled={loading || !username || !password || !confirmPassword || !agreedToTerms}
              className="w-full bg-accent hover:bg-accent-hover text-white font-medium py-2.5 rounded transition-colors disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  Creating your secure identity...
                </span>
              ) : 'Register'}
            </button>
          </form>

          <div className="mt-4">
            <button onClick={onSwitch} className="text-accent text-sm hover:underline">
              Already have an account?
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
