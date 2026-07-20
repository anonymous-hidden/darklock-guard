import { useState } from 'react';
import {
  useConvSecurityStore,
  hashPin,
  verifyPin,
  type LockTimeout,
  type DisappearTimer,
} from '../stores/convSecurityStore';
import { X, Shield, Lock, Eye, EyeOff, Timer, Key, ShieldAlert } from './Icons';
import './ConvSecurity.css';

interface Props {
  convId:  string;
  onClose: () => void;
}

const LOCK_TIMEOUT_OPTIONS: Array<{ value: LockTimeout; label: string }> = [
  { value: 'immediate', label: 'Immediately' },
  { value: '1m',        label: '1 minute'    },
  { value: '5m',        label: '5 minutes'   },
  { value: '15m',       label: '15 minutes'  },
  { value: '1h',        label: '1 hour'      },
  { value: 'never',     label: 'Never'       },
];

const DISAPPEAR_OPTIONS: Array<{ value: DisappearTimer; label: string }> = [
  { value: 'off',  label: 'Off'      },
  { value: '30s',  label: '30 sec'   },
  { value: '1m',   label: '1 min'    },
  { value: '5m',   label: '5 min'    },
  { value: '1h',   label: '1 hour'   },
  { value: '24h',  label: '24 hours' },
  { value: '7d',   label: '7 days'   },
];

export function ConvSecurity({ convId, onClose }: Props) {
  const store = useConvSecurityStore();
  const sec   = store.get(convId);
  const set   = (patch: Parameters<typeof store.set>[1]) => store.set(convId, patch);

  // PIN flow state
  const [pinStep,    setPinStep]    = useState<'idle' | 'set-new' | 'confirm' | 'verify-disable'>('idle');
  const [pinInput,   setPinInput]   = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinVisible, setPinVisible] = useState(false);
  const [pinError,   setPinError]   = useState('');

  const handleTogglePin = () => {
    if (sec.requirePin) {
      // Need to verify old PIN before disabling
      setPinStep('verify-disable');
      setPinInput('');
      setPinError('');
    } else {
      setPinStep('set-new');
      setPinInput('');
      setPinConfirm('');
      setPinError('');
    }
  };

  const handleSetPin = async () => {
    if (pinInput.length < 4) { setPinError('PIN must be at least 4 characters'); return; }
    if (pinStep === 'set-new') {
      setPinStep('confirm');
      setPinConfirm('');
      setPinError('');
      return;
    }
    // confirm step
    if (pinInput !== pinConfirm) { setPinError('PINs do not match'); setPinConfirm(''); return; }
    const hash = await hashPin(pinInput);
    set({ requirePin: true, pinHash: hash });
    setPinStep('idle');
    setPinInput('');
    setPinConfirm('');
    setPinError('');
  };

  const handleDisablePin = async () => {
    const ok = await verifyPin(pinInput, sec.pinHash);
    if (!ok) { setPinError('Incorrect PIN'); setPinInput(''); return; }
    set({ requirePin: false, pinHash: '' });
    setPinStep('idle');
    setPinInput('');
    setPinError('');
  };

  const cancelPin = () => {
    setPinStep('idle');
    setPinInput('');
    setPinConfirm('');
    setPinError('');
  };

  return (
    <div className="conv-sec" onClick={e => e.stopPropagation()}>

      {/* ── Header ── */}
      <div className="conv-sec__header">
        <Shield size={15} />
        <span>Security</span>
        <button className="conv-sec__close" onClick={onClose} title="Close">
          <X size={15} />
        </button>
      </div>

      <div className="conv-sec__body">

        {/* ── Chat Lock ── */}
        <section className="conv-sec__section">
          <h3 className="conv-sec__section-title">
            <Lock size={12} />
            Chat Lock
          </h3>

          {/* Toggle */}
          <div className="conv-sec__toggle-row">
            <div className="conv-sec__toggle-info">
              <span className="conv-sec__toggle-label">Require PIN to open</span>
              <span className="conv-sec__toggle-desc">
                {sec.requirePin ? 'PIN set — tap to disable' : 'Add a PIN lock to this chat'}
              </span>
            </div>
            <button
              className={`conv-sec__toggle ${sec.requirePin ? 'conv-sec__toggle--on' : ''}`}
              onClick={handleTogglePin}
              role="switch"
              aria-checked={sec.requirePin}
            >
              <span className="conv-sec__toggle-thumb" />
            </button>
          </div>

          {/* PIN entry flow */}
          {pinStep !== 'idle' && (
            <div className="conv-sec__pin-flow">
              <p className="conv-sec__pin-label">
                {pinStep === 'set-new'       ? 'Enter a new PIN'       :
                 pinStep === 'confirm'       ? 'Confirm your PIN'      :
                                              'Enter current PIN to disable'}
              </p>
              <div className="conv-sec__pin-input-wrap">
                <Key size={13} className="conv-sec__pin-icon" />
                <input
                  className="conv-sec__pin-input"
                  type={pinVisible ? 'text' : 'password'}
                  value={pinStep === 'confirm' ? pinConfirm : pinInput}
                  onChange={e => pinStep === 'confirm'
                    ? setPinConfirm(e.target.value)
                    : setPinInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (pinStep === 'verify-disable' ? handleDisablePin() : handleSetPin())}
                  placeholder={pinStep === 'confirm' ? 'Re-enter PIN…' : 'PIN or passphrase…'}
                  autoFocus
                />
                <button className="conv-sec__pin-vis" onClick={() => setPinVisible(v => !v)} tabIndex={-1}>
                  {pinVisible ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              {pinError && <p className="conv-sec__pin-error">{pinError}</p>}
              <div className="conv-sec__pin-actions">
                <button className="conv-sec__pin-btn conv-sec__pin-btn--cancel" onClick={cancelPin}>Cancel</button>
                <button
                  className="conv-sec__pin-btn conv-sec__pin-btn--confirm"
                  onClick={pinStep === 'verify-disable' ? handleDisablePin : handleSetPin}
                >
                  {pinStep === 'confirm' ? 'Set PIN' : pinStep === 'verify-disable' ? 'Disable' : 'Next'}
                </button>
              </div>
            </div>
          )}

          {/* Lock timeout (only shown when PIN is active) */}
          {sec.requirePin && pinStep === 'idle' && (
            <div className="conv-sec__field-row">
              <span className="conv-sec__field-label">Auto-lock after</span>
              <select
                className="conv-sec__select"
                value={sec.lockTimeout}
                onChange={e => set({ lockTimeout: e.target.value as LockTimeout })}
              >
                {LOCK_TIMEOUT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}
        </section>

        {/* ── Disappearing Messages ── */}
        <section className="conv-sec__section">
          <h3 className="conv-sec__section-title">
            <Timer size={12} />
            Disappearing Messages
          </h3>
          <div className="conv-sec__field-row">
            <span className="conv-sec__field-label">Delete after</span>
            <select
              className="conv-sec__select"
              value={sec.disappearTimer}
              onChange={e => set({ disappearTimer: e.target.value as DisappearTimer })}
            >
              {DISAPPEAR_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {sec.disappearTimer !== 'off' && (
            <p className="conv-sec__note">
              New messages will be deleted {DISAPPEAR_OPTIONS.find(o => o.value === sec.disappearTimer)?.label.toLowerCase()} after being sent.
            </p>
          )}
        </section>

        {/* ── Privacy ── */}
        <section className="conv-sec__section">
          <h3 className="conv-sec__section-title">
            <Eye size={12} />
            Privacy
          </h3>

          <div className="conv-sec__toggle-row">
            <div className="conv-sec__toggle-info">
              <span className="conv-sec__toggle-label">Blur messages</span>
              <span className="conv-sec__toggle-desc">Hide content until you hover or tap</span>
            </div>
            <button
              className={`conv-sec__toggle ${sec.blurMessages ? 'conv-sec__toggle--on' : ''}`}
              onClick={() => set({ blurMessages: !sec.blurMessages })}
              role="switch"
              aria-checked={sec.blurMessages}
            >
              <span className="conv-sec__toggle-thumb" />
            </button>
          </div>

          <div className="conv-sec__toggle-row">
            <div className="conv-sec__toggle-info">
              <span className="conv-sec__toggle-label">Hide notification preview</span>
              <span className="conv-sec__toggle-desc">Show "New message" instead of content</span>
            </div>
            <button
              className={`conv-sec__toggle ${sec.hideNotifPreview ? 'conv-sec__toggle--on' : ''}`}
              onClick={() => set({ hideNotifPreview: !sec.hideNotifPreview })}
              role="switch"
              aria-checked={sec.hideNotifPreview}
            >
              <span className="conv-sec__toggle-thumb" />
            </button>
          </div>

        </section>

        {/* ── Danger Zone ── */}
        <section className="conv-sec__section conv-sec__section--danger">
          <h3 className="conv-sec__section-title">
            <ShieldAlert size={12} />
            Danger Zone
          </h3>

          <div className="conv-sec__toggle-row">
            <div className="conv-sec__toggle-info">
              <span className="conv-sec__toggle-label conv-sec__toggle-label--danger">Block contact</span>
              <span className="conv-sec__toggle-desc">
                {sec.blocked ? 'Contact is blocked — no messages can be received' : 'Block this contact from sending messages'}
              </span>
            </div>
            <button
              className={`conv-sec__toggle ${sec.blocked ? 'conv-sec__toggle--danger' : ''}`}
              onClick={() => set({ blocked: !sec.blocked })}
              role="switch"
              aria-checked={sec.blocked}
            >
              <span className="conv-sec__toggle-thumb" />
            </button>
          </div>
        </section>

      </div>

      {/* ── Footer ── */}
      <div className="conv-sec__footer">
        <button
          className="conv-sec__reset"
          onClick={() => { store.reset(convId); cancelPin(); }}
        >
          Reset to Default
        </button>
      </div>
    </div>
  );
}
