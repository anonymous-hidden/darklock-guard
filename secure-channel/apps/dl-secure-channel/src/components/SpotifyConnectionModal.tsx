import { useEffect, useState } from 'react';
import { IconX } from './Icons';
import { SpotifyLogo } from './SpotifyLogo';
import { useSpotifyStore } from '../stores/spotifyStore';
import './SpotifyConnectionModal.css';

type View = 'intro' | 'launching' | 'waiting' | 'success' | 'error';

interface SpotifyConnectionModalProps {
  onClose: () => void;
  onConnected: () => Promise<unknown> | void;
}

function errorMessage(code: string): string {
  switch (code) {
    case 'authorization_cancelled': return 'Spotify was not connected. No changes were made.';
    case 'authorization_denied': return 'Spotify denied the connection. You can try again when you are ready.';
    case 'invalid_state': return 'Spotify could not verify this connection attempt. Please try again.';
    case 'spotify_connection_timed_out': return "We didn't receive a response from Spotify. Try connecting again.";
    case 'browser_unavailable': return "We couldn't open your browser. Check your default browser and try again.";
    case 'spotify_callback_unavailable': return 'Ridgeline could not start its secure Spotify callback. Check that no other app is using the configured port.';
    case 'token_exchange_failed': return 'Spotify could not finish connecting securely. Please try again.';
    case 'spotify_not_configured': return 'Spotify is not configured for this Ridgeline desktop build yet.';
    case 'secure_storage_unavailable': return 'Secure credential storage is unavailable on this device.';
    default: return 'Spotify is temporarily unavailable. Please try again.';
  }
}

export function SpotifyConnectionModal({ onClose, onConnected }: SpotifyConnectionModalProps) {
  const sharingEnabled = useSpotifyStore(state => state.sharingEnabled);
  const setStatus = useSpotifyStore(state => state.setStatus);
  const [view, setView] = useState<View>('intro');
  const [error, setError] = useState<string>('');
  const [showInfo, setShowInfo] = useState(false);
  const [changingSharing, setChangingSharing] = useState(false);

  useEffect(() => {
    if (view !== 'waiting') return;
    const timer = window.setInterval(() => {
      void window.electronAPI?.spotifyConnectionState?.().then(async state => {
        if (state.phase === 'pending') return;
        if (state.phase === 'success') {
          await onConnected();
          setView('success');
          return;
        }
        if (state.phase === 'error') {
          setError(errorMessage(state.code));
          setView('error');
        }
      }).catch(() => {
        setError(errorMessage('authorization_failed'));
        setView('error');
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [onConnected, view]);

  const begin = async () => {
    if (!window.electronAPI?.spotifyConnect) {
      setError('Spotify integration is available in the Ridgeline desktop app.');
      setView('error');
      return;
    }
    setView('launching');
    try {
      await window.electronAPI.spotifyConnect();
      setView('waiting');
    } catch (reason) {
      setError(errorMessage(reason instanceof Error ? reason.message : 'authorization_failed'));
      setView('error');
    }
  };

  const cancel = async () => {
    await window.electronAPI?.spotifyCancelConnection?.();
    onClose();
  };

  const reopen = async () => {
    try {
      await window.electronAPI?.spotifyReopenAuthorization?.();
    } catch (reason) {
      setError(errorMessage(reason instanceof Error ? reason.message : 'browser_unavailable'));
      setView('error');
    }
  };

  const updateSharing = async (enabled: boolean) => {
    if (!window.electronAPI?.spotifySetSharing) return;
    setChangingSharing(true);
    try {
      const status = await window.electronAPI.spotifySetSharing(enabled);
      setStatus(status);
    } finally {
      setChangingSharing(false);
    }
  };

  const disconnect = async () => {
    await window.electronAPI?.spotifyDisconnect?.();
    setStatus({ connected: false, sharingEnabled: false });
    onClose();
  };

  return (
    <div className="spotify-connect-modal__backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) void cancel(); }}>
      <section className="spotify-connect-modal" role="dialog" aria-modal="true" aria-labelledby="spotify-connect-title">
        <header className="spotify-connect-modal__header">
          <span className="spotify-connect-modal__brand"><SpotifyLogo size={20} /> Spotify <small>Integration</small></span>
          <button className="spotify-connect-modal__close" type="button" onClick={() => void cancel()} aria-label="Close Spotify connection">
            <IconX size={17} />
          </button>
        </header>

        {(view === 'intro' || view === 'launching') && (
          <div className="spotify-connect-modal__content">
            <div className="spotify-connect-modal__hero"><SpotifyLogo size={42} /></div>
            <h2 id="spotify-connect-title">Connect Spotify</h2>
            <p>Share what you&apos;re currently listening to on your Ridgeline profile.</p>
            <div className="spotify-connect-modal__preview" aria-label="Preview of Spotify profile activity">
              <span className="spotify-connect-modal__preview-label">Preview</span>
              <div className="spotify-connect-modal__art"><SpotifyLogo size={28} /></div>
              <div className="spotify-connect-modal__track"><strong>Song title</strong><span>Artist</span><i><b /></i><small>1:42 / 3:27</small></div>
            </div>
            <div className="spotify-connect-modal__privacy">Ridgeline receives current playback activity after you authorize Spotify. Your Spotify password is never shared with Ridgeline.</div>
            <button className="spotify-connect-modal__learn" type="button" onClick={() => setShowInfo(true)}>Learn how Spotify activity works</button>
            <footer className="spotify-connect-modal__actions">
              <button type="button" className="spotify-connect-modal__button spotify-connect-modal__button--secondary" onClick={() => void cancel()} disabled={view === 'launching'}>Cancel</button>
              <button type="button" className="spotify-connect-modal__button spotify-connect-modal__button--primary" onClick={() => void begin()} disabled={view === 'launching'}>
                {view === 'launching' ? <span className="spotify-connect-modal__spinner" /> : <SpotifyLogo size={17} />}
                {view === 'launching' ? 'Opening browser...' : 'Continue to Spotify'}
              </button>
            </footer>
            <small className="spotify-connect-modal__browser-note">Authentication opens in your default browser.</small>
          </div>
        )}

        {view === 'waiting' && <div className="spotify-connect-modal__content spotify-connect-modal__state">
          <span className="spotify-connect-modal__waiting-mark"><span /></span>
          <h2 id="spotify-connect-title">Finish connecting in your browser</h2>
          <p>Approve Ridgeline in the Spotify window, then return here.</p>
          <div className="spotify-connect-modal__pending-line"><span /> Waiting securely for Spotify</div>
          <footer className="spotify-connect-modal__actions spotify-connect-modal__actions--stacked">
            <button type="button" className="spotify-connect-modal__button spotify-connect-modal__button--secondary" onClick={() => void reopen()}>Open Spotify again</button>
            <button type="button" className="spotify-connect-modal__text-action" onClick={() => void cancel()}>Cancel connection</button>
          </footer>
        </div>}

        {view === 'success' && <div className="spotify-connect-modal__content spotify-connect-modal__state">
          <span className="spotify-connect-modal__success-mark"><SpotifyLogo size={28} /><b>✓</b></span>
          <h2 id="spotify-connect-title">Spotify connected</h2>
          <p>Your Spotify activity stays private until you choose to show it on your profile.</p>
          <label className="spotify-connect-modal__toggle"><span><strong>Show Spotify activity on my profile</strong><small>You can turn this off any time.</small></span><input type="checkbox" checked={sharingEnabled} disabled={changingSharing} onChange={event => void updateSharing(event.target.checked)} /><i /></label>
          <footer className="spotify-connect-modal__actions">
            <button type="button" className="spotify-connect-modal__button spotify-connect-modal__button--secondary spotify-connect-modal__disconnect" onClick={() => void disconnect()}>Disconnect</button>
            <button type="button" className="spotify-connect-modal__button spotify-connect-modal__button--primary" onClick={onClose}>Done</button>
          </footer>
        </div>}

        {view === 'error' && <div className="spotify-connect-modal__content spotify-connect-modal__state">
          <span className="spotify-connect-modal__error-mark">!</span>
          <h2 id="spotify-connect-title">Couldn&apos;t connect Spotify</h2>
          <p>{error}</p>
          <footer className="spotify-connect-modal__actions">
            <button type="button" className="spotify-connect-modal__button spotify-connect-modal__button--secondary" onClick={onClose}>Close</button>
            <button type="button" className="spotify-connect-modal__button spotify-connect-modal__button--primary" onClick={() => setView('intro')}>Try again</button>
          </footer>
        </div>}

        {showInfo && <div className="spotify-connect-modal__info" role="dialog" aria-modal="true" aria-label="How Spotify activity works">
          <div><h3>Spotify activity</h3><p>When profile sharing is enabled, Ridgeline periodically requests your current song, artist, album artwork, and playback position. It does not receive your password, playlists, payment details, or account email.</p><button type="button" onClick={() => setShowInfo(false)}>Got it</button></div>
        </div>}
      </section>
    </div>
  );
}
