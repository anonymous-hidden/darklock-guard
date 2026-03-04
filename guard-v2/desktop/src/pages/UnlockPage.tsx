/**
 * Unlock screen for Strict Mode
 * Shown when the app starts with strict mode enabled
 */

import React, { useState } from 'react';
import { Lock, Eye, EyeOff, AlertTriangle, Shield } from 'lucide-react';

interface Props {
  onUnlock: (password: string) => Promise<void>;
}

export const UnlockPage: React.FC<Props> = ({ onUnlock }) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!password) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);
    try {
      await onUnlock(password);
    } catch (err: any) {
      setAttempts(prev => prev + 1);
      setError(err.message || 'Incorrect password');
      setPassword('');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Logo/Icon */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-semantic-warning/20 to-semantic-warning/5 border border-semantic-warning/30 mb-6">
            <Shield size={40} className="text-semantic-warning" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Darklock Guard Locked</h1>
          <p className="text-sm text-text-muted">
            Strict Mode is enabled. Enter your password to continue.
          </p>
        </div>

        {/* Unlock form */}
        <div className="bg-bg-card border border-white/10 rounded-2xl p-6 shadow-xl">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-semantic-error/10 border border-semantic-error/30 flex items-center gap-2">
              <AlertTriangle size={14} className="text-semantic-error flex-shrink-0" />
              <div className="text-sm">
                <p className="text-text-secondary">{error}</p>
                {attempts >= 3 && (
                  <p className="text-xs text-text-muted mt-1">
                    Too many failed attempts. Make sure you're using the correct password.
                  </p>
                )}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your Strict Mode password"
                  className="w-full bg-bg-secondary border border-white/5 rounded-lg pl-10 pr-10 py-3 text-sm focus:outline-none focus:border-accent-primary/50"
                  autoFocus
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full px-4 py-3 rounded-lg bg-accent-primary text-bg-primary text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Verifying...' : 'Unlock'}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-white/5">
            <div className="flex items-start gap-2 text-xs text-text-muted">
              <Lock size={12} className="mt-0.5 flex-shrink-0" />
              <p>
                Strict Mode provides maximum security by requiring authentication on every launch.
                To disable it, unlock the app and change the security mode in Settings.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnlockPage;
