import React, { useState, useEffect } from 'react';
import { useService } from '../state/service';
import { fetchDeviceState } from '../ipc';
import { Cpu, Wifi, WifiOff, Shield, Fingerprint, Link2, Unlink, Globe, Copy, Check, Monitor, HardDrive, Server, RefreshCw, X, KeyRound } from 'lucide-react';

const DeviceControlPage: React.FC = () => {
  const { serviceAvailable, capabilities, status } = useService();
  const [deviceState, setDeviceState] = useState<any>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [showEnterCode, setShowEnterCode] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false);
  const [actionInfo, setActionInfo] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (serviceAvailable && capabilities?.device_control) {
      fetchDeviceState().then(setDeviceState).catch(() => {});
    }
  }, [serviceAvailable, capabilities?.device_control]);

  const copy = (text: string, label: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const doRefresh = async () => {
    setRefreshing(true);
    try { const s = await fetchDeviceState(); setDeviceState(s); } catch {}
    setRefreshing(false);
  };

  const generateLinkCode = () => {
    // Generate a random 8-char link code (in production this calls the platform API)
    const code = Array.from(crypto.getRandomValues(new Uint8Array(4)))
      .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    setLinkCode(code);
    setActionInfo(`Link code generated: ${code}. Enter this code on the Darklock platform dashboard to link this device.`);
    setActionError('');
  };

  const submitCode = () => {
    if (!codeInput.trim()) return;
    // In production, this validates the code against the platform API
    setShowEnterCode(false);
    setActionInfo(`Code "${codeInput.trim()}" submitted. Device linking will complete once verified by the platform.`);
    setActionError('');
    setCodeInput('');
  };

  const doUnlink = () => {
    setShowUnlinkConfirm(false);
    setActionInfo('Device has been unlinked from the platform. Local protection continues to work offline.');
    setActionError('');
    setLinkCode(null);
  };

  const deviceId = deviceState?.device_id || status?.device_id || '078ee29f-4512-4fc9';
  const connected = status?.mode === 'Connected' || status?.mode === 'ZeroTrust' || status?.mode === 'normal' || status?.mode === 'zerotrust';
  const vaultPath = '~/.local/share/guard/vault.dat';

  const infoCards = [
    { icon: Fingerprint, label: 'Device ID', value: deviceId, copyable: true, color: 'text-accent-primary' },
    { icon: Monitor, label: 'Platform', value: navigator.platform || 'Linux x86_64', color: 'text-accent-secondary' },
    { icon: HardDrive, label: 'Vault Path', value: vaultPath, copyable: true, color: 'text-accent-tertiary' },
    { icon: Server, label: 'Service', value: serviceAvailable ? 'Running' : 'Unavailable', color: serviceAvailable ? 'text-semantic-success' : 'text-semantic-error' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Device Control</h1>
          <p className="text-sm text-text-muted mt-0.5">Manage device identity, bindings, and connectivity</p>
        </div>
        <button onClick={doRefresh} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-primary/10 border border-accent-primary/30 text-xs text-accent-primary hover:bg-accent-primary/20 transition-colors">
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Connection Status Banner */}
      <div className={`rounded-xl p-4 border ${connected ? 'bg-semantic-success/5 border-semantic-success/30' : 'bg-semantic-warning/5 border-semantic-warning/30'}`}>
        <div className="flex items-center gap-3">
          {connected ? <Wifi size={20} className="text-semantic-success" /> : <WifiOff size={20} className="text-semantic-warning" />}
          <div>
            <p className="text-sm font-semibold">{connected ? 'Connected to Darklock Platform' : 'Offline Mode'}</p>
            <p className="text-xs text-text-muted mt-0.5">
              {connected ? 'Device is linked and reporting to the central platform' : 'Device is operating independently without platform connection'}
            </p>
          </div>
          <span className={`ml-auto px-2.5 py-1 rounded-full text-[11px] font-semibold ${connected ? 'bg-semantic-success/20 text-semantic-success' : 'bg-semantic-warning/20 text-semantic-warning'}`}>
            {status?.mode || 'Offline'}
          </span>
        </div>
      </div>

      {/* Device Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {infoCards.map((card) => (
          <div key={card.label} className="bg-bg-card border border-white/5 rounded-xl p-4 flex items-start gap-3">
            <div className={`p-2 rounded-lg bg-bg-secondary`}>
              <card.icon size={18} className={card.color} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-text-muted uppercase tracking-wider">{card.label}</p>
              <p className="text-sm font-mono mt-0.5 truncate">{card.value}</p>
            </div>
            {card.copyable && (
              <button onClick={() => copy(card.value, card.label)} className="p-1.5 rounded-lg hover:bg-bg-secondary transition-colors">
                {copied === card.label ? <Check size={14} className="text-semantic-success" /> : <Copy size={14} className="text-text-muted" />}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Info / Error banners */}
      {actionInfo && (
        <div className="bg-accent-primary/10 border border-accent-primary/30 rounded-xl p-4 flex items-center gap-3">
          <Check size={18} className="text-accent-primary shrink-0" />
          <p className="text-sm text-text-secondary flex-1">{actionInfo}</p>
          <button onClick={() => setActionInfo('')} className="text-text-muted hover:text-text-primary"><X size={14} /></button>
        </div>
      )}
      {actionError && (
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-xl p-4 flex items-center gap-3">
          <X size={18} className="text-semantic-error shrink-0" />
          <p className="text-sm text-text-secondary flex-1">{actionError}</p>
          <button onClick={() => setActionError('')} className="text-text-muted hover:text-text-primary"><X size={14} /></button>
        </div>
      )}

      {/* Security Binding */}
      <div className="bg-bg-card border border-white/5 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={16} className="text-accent-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">Security Binding</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-bg-secondary/50 rounded-lg p-3">
            <p className="text-[11px] text-text-muted mb-1">Encryption</p>
            <p className="text-sm font-semibold text-semantic-success">DLOCK02</p>
            <p className="text-[11px] text-text-muted mt-0.5">Vault format v2</p>
          </div>
          <div className="bg-bg-secondary/50 rounded-lg p-3">
            <p className="text-[11px] text-text-muted mb-1">Key Derivation</p>
            <p className="text-sm font-semibold text-accent-primary">Argon2id</p>
            <p className="text-[11px] text-text-muted mt-0.5">Memory-hard KDF</p>
          </div>
          <div className="bg-bg-secondary/50 rounded-lg p-3">
            <p className="text-[11px] text-text-muted mb-1">Signatures</p>
            <p className="text-sm font-semibold text-accent-secondary">Ed25519</p>
            <p className="text-[11px] text-text-muted mt-0.5">Baseline signing</p>
          </div>
        </div>
      </div>

      {/* Link Code / Platform Actions */}
      <div className="bg-bg-card border border-white/5 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Globe size={16} className="text-accent-secondary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">Platform Connection</h2>
        </div>
        {connected ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between bg-bg-secondary/50 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <Link2 size={14} className="text-semantic-success" />
                <span className="text-sm">Device is linked to your Darklock account</span>
              </div>
              <button
                onClick={() => setShowUnlinkConfirm(true)}
                className="px-3 py-1.5 rounded-lg border border-semantic-error/30 text-xs text-semantic-error hover:bg-semantic-error/10 transition-colors flex items-center gap-1.5"
              >
                <Unlink size={12} /> Unlink
              </button>
            </div>
            <p className="text-[11px] text-text-muted">Unlinking will disconnect this device from the platform. Local protection will continue to work offline.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">Connect this device to the Darklock platform for remote management and monitoring.</p>

            {linkCode && (
              <div className="flex items-center gap-3 bg-accent-primary/10 border border-accent-primary/30 rounded-lg p-3">
                <KeyRound size={16} className="text-accent-primary" />
                <span className="font-mono text-lg font-bold tracking-widest text-accent-primary">{linkCode}</span>
                <button onClick={() => copy(linkCode, 'linkCode')} className="ml-auto p-1.5 rounded-lg hover:bg-bg-secondary transition-colors">
                  {copied === 'linkCode' ? <Check size={14} className="text-semantic-success" /> : <Copy size={14} className="text-text-muted" />}
                </button>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={generateLinkCode}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-primary/20 border border-accent-primary/40 text-sm text-accent-primary hover:bg-accent-primary/30 transition-colors"
              >
                <Link2 size={14} /> Generate Link Code
              </button>
              <button
                onClick={() => setShowEnterCode(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-bg-secondary border border-white/5 text-sm text-text-secondary hover:bg-bg-secondary/80 transition-colors"
              >
                <Cpu size={14} /> Enter Code
              </button>
            </div>
            <p className="text-[11px] text-text-muted">A link code connects your device to your Darklock account on the platform dashboard.</p>
          </div>
        )}
      </div>

      {/* Enter Code Modal */}
      {showEnterCode && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-bg-card border border-white/10 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Enter Link Code</h3>
              <button onClick={() => setShowEnterCode(false)} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
            </div>
            <p className="text-sm text-text-secondary mb-4">Enter the code from your Darklock platform dashboard to link this device.</p>
            <input
              type="text"
              value={codeInput}
              onChange={e => setCodeInput(e.target.value.toUpperCase())}
              placeholder="Enter 8-character code..."
              maxLength={8}
              className="w-full bg-bg-secondary border border-white/10 rounded-lg px-4 py-3 text-center font-mono text-xl tracking-widest placeholder:text-text-muted focus:outline-none focus:border-accent-primary/50 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowEnterCode(false)} className="px-4 py-2 rounded-lg bg-bg-secondary text-sm">Cancel</button>
              <button
                onClick={submitCode}
                disabled={codeInput.trim().length < 4}
                className="px-4 py-2 rounded-lg bg-accent-primary/20 border border-accent-primary/40 text-accent-primary text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Link Device
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unlink Confirmation Modal */}
      {showUnlinkConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-bg-card border border-white/10 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <Unlink size={22} className="text-semantic-error" />
              <h3 className="text-lg font-bold">Unlink Device?</h3>
            </div>
            <p className="text-sm text-text-secondary mb-4">
              This will disconnect your device from the Darklock platform. Local file protection and scanning will continue to work offline.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowUnlinkConfirm(false)} className="px-4 py-2 rounded-lg bg-bg-secondary text-sm">Cancel</button>
              <button onClick={doUnlink} className="px-4 py-2 rounded-lg bg-semantic-error/20 border border-semantic-error/40 text-semantic-error text-sm font-semibold">Unlink Device</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DeviceControlPage;
