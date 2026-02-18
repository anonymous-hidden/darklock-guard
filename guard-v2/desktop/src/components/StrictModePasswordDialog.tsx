/**
 * Dialog for setting or verifying Strict Mode password
 */

import React, { useState } from 'react';
import { Lock, Eye, EyeOff, AlertTriangle } from 'lucide-react';

interface Props {
  mode: 'create' | 'verify';
  title: string;
  description: string;
  onConfirm: (password: string) => Promise<void>;
  onCancel: () => void;
}

export const StrictModePasswordDialog: React.FC<Props> = ({
  mode,
  title,
  description,
  onConfirm,
  onCancel,
}) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'create') {
      if (password.length < 6) {
        setError('Password must be at least 6 characters');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
    } else {
      if (!password) {
        setError('Please enter your password');
        return;
      }
    }

    setLoading(true);
    try {
      await onConfirm(password);
    } catch (err: any) {
      setError(err.message || 'Failed to verify password');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-bg-card border border-white/10 rounded-2xl shadow-2xl max-w-md w-full p-6">
        {/* Icon */}
        <div className="w-14 h-14 rounded-full bg-semantic-warning/10 border border-semantic-warning/20 flex items-center justify-center mx-auto mb-4">
          <Lock size={24} className="text-semantic-warning" />
        </div>

        {/* Title */}
        <h2 className="text-xl font-bold text-center mb-2">{title}</h2>
        <p className="text-sm text-text-muted text-center mb-6">{description}</p>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-semantic-error/10 border border-semantic-error/30 flex items-center gap-2">
            <AlertTriangle size={14} className="text-semantic-error flex-shrink-0" />
            <p className="text-sm text-text-secondary">{error}</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Password input */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              {mode === 'create' ? 'Create Password' : 'Enter Password'}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'create' ? 'At least 6 characters' : 'Enter your password'}
                className="w-full bg-bg-secondary border border-white/5 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:border-accent-primary/50"
                autoFocus
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Confirm password (create mode only) */}
          {mode === 'create' && (
            <div>
              <label className="block text-sm font-medium mb-1.5">Confirm Password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className="w-full bg-bg-secondary border border-white/5 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent-primary/50"
                disabled={loading}
              />
            </div>
          )}

          {/* Warning message for create mode */}
          {mode === 'create' && (
            <div className="p-3 rounded-lg bg-semantic-warning/10 border border-semantic-warning/20">
              <p className="text-xs text-text-secondary">
                <strong>Important:</strong> You'll need this password to access the app and disable Strict Mode. Keep it safe.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="flex-1 px-4 py-2.5 rounded-lg border border-white/10 text-sm font-semibold hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2.5 rounded-lg bg-semantic-warning text-bg-primary text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? 'Processing...' : mode === 'create' ? 'Enable Strict Mode' : 'Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
