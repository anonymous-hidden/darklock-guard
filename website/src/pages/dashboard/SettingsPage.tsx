import { useState, useEffect, FormEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  Settings,
  User,
  Shield,
  Key,
  Bell,
  Save,
  AlertCircle,
  CheckCircle2,
  Copy,
  Check,
  RefreshCw,
  Eye,
  EyeOff,
  Smartphone,
} from 'lucide-react';

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();

  // Profile
  const [username, setUsername] = useState(user?.username || '');
  const [email, setEmail] = useState(user?.email || '');
  const [profileMsg, setProfileMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Password
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [pwLoading, setPwLoading] = useState(false);

  // 2FA
  const [twoFAEnabled, setTwoFAEnabled] = useState(false);
  const [twoFASetup, setTwoFASetup] = useState<{ qr: string; secret: string } | null>(null);
  const [twoFACode, setTwoFACode] = useState('');
  const [twoFAMsg, setTwoFAMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // API Key
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setUsername(data.username);
          setEmail(data.email);
          setTwoFAEnabled(data.totp_enabled || false);
          if (data.api_key) setApiKey(data.api_key);
        }
      })
      .catch(() => {});
  }, []);

  // Profile update
  const updateProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileLoading(true);
    setProfileMsg(null);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email }),
      });
      if (res.ok) {
        await refreshUser();
        setProfileMsg({ type: 'ok', text: 'Profile updated successfully.' });
      } else {
        const data = await res.json();
        setProfileMsg({ type: 'err', text: data.error || 'Failed to update profile.' });
      }
    } catch {
      setProfileMsg({ type: 'err', text: 'Network error.' });
    } finally {
      setProfileLoading(false);
    }
  };

  // Password change
  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (newPw !== confirmPw) {
      setPwMsg({ type: 'err', text: 'Passwords do not match.' });
      return;
    }
    setPwLoading(true);
    setPwMsg(null);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
      });
      if (res.ok) {
        setPwMsg({ type: 'ok', text: 'Password changed successfully.' });
        setCurrentPw('');
        setNewPw('');
        setConfirmPw('');
      } else {
        const data = await res.json();
        setPwMsg({ type: 'err', text: data.error || 'Failed to change password.' });
      }
    } catch {
      setPwMsg({ type: 'err', text: 'Network error.' });
    } finally {
      setPwLoading(false);
    }
  };

  // 2FA Setup
  const startTwoFA = async () => {
    try {
      const res = await fetch('/api/auth/2fa/setup', { method: 'POST' });
      const data = await res.json();
      setTwoFASetup({ qr: data.qr_url, secret: data.secret });
    } catch {
      setTwoFAMsg({ type: 'err', text: 'Failed to start 2FA setup.' });
    }
  };

  const verifyTwoFA = async () => {
    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: twoFACode }),
      });
      if (res.ok) {
        setTwoFAEnabled(true);
        setTwoFASetup(null);
        setTwoFACode('');
        setTwoFAMsg({ type: 'ok', text: '2FA enabled successfully.' });
      } else {
        setTwoFAMsg({ type: 'err', text: 'Invalid code. Try again.' });
      }
    } catch {
      setTwoFAMsg({ type: 'err', text: 'Verification failed.' });
    }
  };

  const disableTwoFA = async () => {
    try {
      const res = await fetch('/api/auth/2fa', { method: 'DELETE' });
      if (res.ok) {
        setTwoFAEnabled(false);
        setTwoFAMsg({ type: 'ok', text: '2FA disabled.' });
      }
    } catch {
      setTwoFAMsg({ type: 'err', text: 'Failed to disable 2FA.' });
    }
  };

  // API Key
  const regenerateKey = async () => {
    try {
      const res = await fetch('/api/auth/api-key', { method: 'POST' });
      const data = await res.json();
      setApiKey(data.api_key);
      setShowKey(true);
    } catch {
      // handle
    }
  };

  const copyKey = () => {
    navigator.clipboard.writeText(apiKey);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  const Msg = ({ msg }: { msg: { type: 'ok' | 'err'; text: string } | null }) => {
    if (!msg) return null;
    return (
      <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
        msg.type === 'ok' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'
      }`}>
        {msg.type === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
        {msg.text}
      </div>
    );
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-dark-400 text-sm mt-1">Manage your account and security preferences</p>
      </div>

      <div className="space-y-6">
        {/* Profile */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-6">
            <User className="w-5 h-5 text-brand-400" />
            <h2 className="font-semibold">Profile</h2>
          </div>
          <Msg msg={profileMsg} />
          <form onSubmit={updateProfile} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
              />
            </div>
            <button type="submit" disabled={profileLoading} className="btn-primary text-sm gap-2">
              <Save className="w-4 h-4" />
              {profileLoading ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </div>

        {/* Password */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-6">
            <Key className="w-5 h-5 text-brand-400" />
            <h2 className="font-semibold">Change Password</h2>
          </div>
          <Msg msg={pwMsg} />
          <form onSubmit={changePassword} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Current Password</label>
              <input
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                className="input-field"
                autoComplete="current-password"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">New Password</label>
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                className="input-field"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Confirm New Password</label>
              <input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                className="input-field"
                autoComplete="new-password"
              />
            </div>
            <button type="submit" disabled={pwLoading} className="btn-primary text-sm gap-2">
              <Key className="w-4 h-4" />
              {pwLoading ? 'Changing...' : 'Change Password'}
            </button>
          </form>
        </div>

        {/* Two-Factor Auth */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-6">
            <Smartphone className="w-5 h-5 text-brand-400" />
            <h2 className="font-semibold">Two-Factor Authentication</h2>
          </div>
          <Msg msg={twoFAMsg} />

          {twoFAEnabled ? (
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="w-5 h-5 text-green-400" />
                <span className="text-sm text-green-400 font-medium">2FA is enabled</span>
              </div>
              <button onClick={disableTwoFA} className="btn-ghost text-sm text-red-400 hover:text-red-300">
                Disable 2FA
              </button>
            </div>
          ) : twoFASetup ? (
            <div className="mt-4 space-y-4">
              <p className="text-sm text-dark-400">
                Scan this QR code with your authenticator app, then enter the 6-digit code below.
              </p>
              <div className="flex justify-center">
                <img src={twoFASetup.qr} alt="2FA QR Code" className="w-48 h-48 rounded-lg bg-white p-2" />
              </div>
              <div>
                <label className="block text-xs text-dark-500 mb-1">Manual entry key</label>
                <code className="block text-sm text-brand-400 bg-dark-950 rounded px-3 py-2 font-mono break-all">
                  {twoFASetup.secret}
                </code>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={twoFACode}
                  onChange={(e) => setTwoFACode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="input-field font-mono text-center tracking-[0.3em] max-w-[160px]"
                  maxLength={6}
                />
                <button onClick={verifyTwoFA} disabled={twoFACode.length !== 6} className="btn-primary text-sm">
                  Verify
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <p className="text-sm text-dark-400 mb-4">
                Add an extra layer of security with TOTP-based two-factor authentication.
              </p>
              <button onClick={startTwoFA} className="btn-primary text-sm gap-2">
                <Shield className="w-4 h-4" />
                Enable 2FA
              </button>
            </div>
          )}
        </div>

        {/* API Key */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-6">
            <Settings className="w-5 h-5 text-brand-400" />
            <h2 className="font-semibold">API Key</h2>
          </div>
          <p className="text-sm text-dark-400 mb-4">
            Use your API key to authenticate device linking from the CLI or automation scripts.
          </p>
          {apiKey ? (
            <div className="flex items-center gap-2 mb-4">
              <div className="flex-1 bg-dark-950 rounded-lg px-4 py-2.5 font-mono text-sm">
                {showKey ? (
                  <span className="text-brand-400">{apiKey}</span>
                ) : (
                  <span className="text-dark-600">{'•'.repeat(40)}</span>
                )}
              </div>
              <button onClick={() => setShowKey(!showKey)} className="btn-ghost">
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button onClick={copyKey} className="btn-ghost">
                {keyCopied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          ) : null}
          <button onClick={regenerateKey} className="btn-ghost text-sm gap-2">
            <RefreshCw className="w-4 h-4" />
            {apiKey ? 'Regenerate Key' : 'Generate API Key'}
          </button>
        </div>
      </div>
    </div>
  );
}
