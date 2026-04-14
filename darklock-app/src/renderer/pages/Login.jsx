import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

export default function Login({ onSwitch }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [needs2FA, setNeeds2FA] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState('idle'); // idle | hashing | authenticating | decrypting | connecting
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      setStage('hashing');
      await new Promise(r => setTimeout(r, 100)); // let UI update

      setStage('authenticating');
      await login(username, password, needs2FA ? totpCode : undefined);

      setStage('decrypting');
      await new Promise(r => setTimeout(r, 300));

      setStage('connecting');
    } catch (err) {
      if (err.message === '2FA_REQUIRED') {
        setNeeds2FA(true);
        setError('');
      } else {
        setError(err.message);
      }
      setStage('idle');
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

      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md bg-[#313338] rounded-lg p-8 shadow-2xl">
          {/* Logo */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-accent rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-text-primary">Welcome back!</h1>
            <p className="text-text-muted text-sm mt-1">We're so excited to see you again!</p>
          </div>

          {error && (
            <div className="bg-danger/10 border border-danger/30 text-danger text-sm rounded px-3 py-2 mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase mb-2">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-[#1e1f22] border-none rounded px-3 py-2.5 text-text-primary outline-none focus:ring-2 focus:ring-accent"
                required
                autoFocus
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#1e1f22] border-none rounded px-3 py-2.5 text-text-primary outline-none focus:ring-2 focus:ring-accent pr-16"
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-accent hover:text-accent-hover"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <button type="button" className="text-xs text-accent hover:underline mt-1">
                Forgot your password?
              </button>
            </div>

            {needs2FA && (
              <div>
                <label className="block text-xs font-semibold text-text-secondary uppercase mb-2">
                  Two-Factor Code
                </label>
                <input
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full bg-[#1e1f22] border-none rounded px-3 py-2.5 text-text-primary outline-none focus:ring-2 focus:ring-accent text-center tracking-widest text-lg"
                  placeholder="000000"
                  maxLength={6}
                  autoFocus
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent hover:bg-accent-hover text-white font-medium py-2.5 rounded transition-colors disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  {stage === 'hashing' && 'Hashing credentials...'}
                  {stage === 'authenticating' && 'Authenticating...'}
                  {stage === 'decrypting' && 'Decrypting keys...'}
                  {stage === 'connecting' && 'Establishing secure channel...'}
                </span>
              ) : 'Log In'}
            </button>
          </form>

          <div className="mt-4">
            <span className="text-text-muted text-sm">Need an account? </span>
            <button onClick={onSwitch} className="text-accent text-sm hover:underline">
              Register
            </button>
          </div>

          <p className="text-text-muted text-xs text-center mt-6">
            🔒 Your messages are end-to-end encrypted.<br />
            DarkLock cannot read your conversations.
          </p>
        </div>
      </div>
    </div>
  );
}
