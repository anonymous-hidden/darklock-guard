import { useState, FormEvent, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Shield, UserPlus, AlertCircle, Check, X } from 'lucide-react';
import zxcvbn from 'zxcvbn';

const strengthLabels = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
const strengthColors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-blue-500', 'bg-green-500'];

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const strength = useMemo(() => (password ? zxcvbn(password) : null), [password]);

  const checks = useMemo(() => ({
    length: password.length >= 10,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
    match: confirm.length > 0 && password === confirm,
  }), [password, confirm]);

  const canSubmit = checks.length && checks.upper && checks.lower && checks.number && checks.match && username.length >= 3 && email.includes('@');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    setLoading(true);
    try {
      await register(username, email, password);
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-brand-600/10 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-7 h-7 text-brand-400" />
          </div>
          <h1 className="text-2xl font-bold">Create your account</h1>
          <p className="text-dark-400 text-sm mt-1">Start protecting your systems with Darklock Guard</p>
        </div>

        <div className="glass-card p-8">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-6">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-dark-300 mb-1.5">
                Username
              </label>
              <input
                id="username"
                type="text"
                required
                minLength={3}
                maxLength={32}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input-field"
                placeholder="cayden"
                autoComplete="username"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-dark-300 mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-dark-300 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field"
                placeholder="Minimum 10 characters"
                autoComplete="new-password"
              />
              {/* Strength meter */}
              {password && strength && (
                <div className="mt-3">
                  <div className="flex gap-1 mb-1.5">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 rounded-full transition-all ${
                          i <= strength.score ? strengthColors[strength.score] : 'bg-dark-800'
                        }`}
                      />
                    ))}
                  </div>
                  <p className={`text-xs ${strength.score >= 3 ? 'text-green-400' : strength.score >= 2 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {strengthLabels[strength.score]}
                    {strength.feedback.warning && ` — ${strength.feedback.warning}`}
                  </p>
                </div>
              )}
              {/* Requirement checks */}
              {password && (
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  {[
                    { ok: checks.length, label: '10+ characters' },
                    { ok: checks.upper, label: 'Uppercase letter' },
                    { ok: checks.lower, label: 'Lowercase letter' },
                    { ok: checks.number, label: 'Number' },
                    { ok: checks.special, label: 'Special character' },
                  ].map((c) => (
                    <div key={c.label} className="flex items-center gap-1.5 text-xs">
                      {c.ok ? (
                        <Check className="w-3 h-3 text-green-400" />
                      ) : (
                        <X className="w-3 h-3 text-dark-600" />
                      )}
                      <span className={c.ok ? 'text-dark-300' : 'text-dark-600'}>{c.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label htmlFor="confirm" className="block text-sm font-medium text-dark-300 mb-1.5">
                Confirm Password
              </label>
              <input
                id="confirm"
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="input-field"
                placeholder="Re-enter your password"
                autoComplete="new-password"
              />
              {confirm && (
                <p className={`text-xs mt-1.5 ${checks.match ? 'text-green-400' : 'text-red-400'}`}>
                  {checks.match ? 'Passwords match' : 'Passwords do not match'}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="btn-primary w-full justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <UserPlus className="w-4 h-4" />
              )}
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-sm text-dark-500 mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-brand-400 hover:underline font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
