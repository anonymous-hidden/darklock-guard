import React, { useState, useEffect } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import { config } from '../../config';

export default function TwoFactorModal() {
  const { toggleTwoFactor } = useUIStore();
  const { accessToken } = useAuthStore();
  const [step, setStep] = useState('loading'); // loading | setup | verify | success | error
  const [qrData, setQrData] = useState(null);
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setup2FA();
  }, []);

  const setup2FA = async () => {
    try {
      const res = await fetch(`${config.apiUrl}/api/2fa/setup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      setSecret(data.secret);
      setQrData(data.otpauthUrl || data.qrCode);
      setStep('setup');
    } catch (err) {
      setError(err.message);
      setStep('error');
    }
  };

  const verify2FA = async () => {
    if (code.length !== 6) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${config.apiUrl}/api/2fa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ token: code })
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      setBackupCodes(data.backupCodes || []);
      setStep('success');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCodeChange = (val) => {
    const sanitized = val.replace(/\D/g, '').slice(0, 6);
    setCode(sanitized);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={toggleTwoFactor}>
      <div className="bg-[#313338] w-full max-w-md rounded-lg shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-text-primary">Two-Factor Authentication</h2>
            <button onClick={toggleTwoFactor} className="text-text-muted hover:text-text-primary text-xl">✕</button>
          </div>

          {step === 'loading' && (
            <div className="text-center py-8">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-text-muted text-sm">Setting up 2FA...</p>
            </div>
          )}

          {step === 'error' && (
            <div className="text-center py-8">
              <p className="text-danger mb-4">{error}</p>
              <button onClick={toggleTwoFactor} className="text-accent text-sm hover:underline">Close</button>
            </div>
          )}

          {step === 'setup' && (
            <div className="space-y-4">
              <p className="text-text-secondary text-sm">
                Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
              </p>

              <div className="bg-white rounded-lg p-4 w-fit mx-auto">
                {qrData ? (
                  <img
                    src={qrData.startsWith('data:') ? qrData : `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrData)}`}
                    alt="2FA QR Code"
                    className="w-44 h-44"
                  />
                ) : (
                  <div className="w-44 h-44 flex items-center justify-center text-text-muted text-sm">
                    QR unavailable
                  </div>
                )}
              </div>

              <div>
                <p className="text-text-muted text-xs mb-1">Or enter this secret manually:</p>
                <code className="block bg-[#1e1f22] text-accent text-sm px-3 py-2 rounded font-mono break-all select-all">
                  {secret}
                </code>
              </div>

              {error && <p className="text-danger text-sm">{error}</p>}

              <div>
                <label className="block text-xs font-semibold text-text-secondary uppercase mb-2">
                  Enter 6-digit code
                </label>
                <input
                  value={code}
                  onChange={(e) => handleCodeChange(e.target.value)}
                  className="w-full bg-[#1e1f22] text-text-primary text-center text-2xl tracking-[0.5em] font-mono rounded px-3 py-3 outline-none focus:ring-2 focus:ring-accent"
                  placeholder="000000"
                  maxLength={6}
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && verify2FA()}
                />
              </div>

              <button
                onClick={verify2FA}
                disabled={code.length !== 6 || loading}
                className="w-full bg-accent hover:bg-accent-hover text-white font-medium py-2.5 rounded transition-colors disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Activate 2FA'}
              </button>
            </div>
          )}

          {step === 'success' && (
            <div className="space-y-4">
              <div className="text-center">
                <div className="w-16 h-16 bg-success/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-8 h-8 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-text-primary font-semibold mb-1">2FA Enabled!</h3>
                <p className="text-text-secondary text-sm">Your account is now more secure.</p>
              </div>

              {backupCodes.length > 0 && (
                <div>
                  <p className="text-warning text-sm font-semibold mb-2">
                    Save these backup codes somewhere safe:
                  </p>
                  <div className="bg-[#1e1f22] rounded p-3 grid grid-cols-2 gap-1">
                    {backupCodes.map((bc, i) => (
                      <code key={i} className="text-text-primary text-sm font-mono">{bc}</code>
                    ))}
                  </div>
                  <p className="text-text-muted text-xs mt-2">
                    Each code can only be used once. You won't see these again.
                  </p>
                </div>
              )}

              <button
                onClick={toggleTwoFactor}
                className="w-full bg-accent hover:bg-accent-hover text-white font-medium py-2.5 rounded transition-colors"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
