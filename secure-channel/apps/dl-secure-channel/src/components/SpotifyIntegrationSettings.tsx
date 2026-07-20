import { useEffect, useState } from 'react';
import { useSpotifyStore } from '../stores/spotifyStore';
import { SpotifyLogo } from './SpotifyLogo';
import { SpotifyConnectionModal } from './SpotifyConnectionModal';
import './SpotifyIntegrationSettings.css';

function integrationMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code.includes('spotify_not_configured')) return 'Spotify is not configured for this Ridgeline desktop build yet.';
  if (code.includes('secure_storage_unavailable')) return 'Secure credential storage is unavailable on this device.';
  if (code.includes('authorization_cancelled')) return 'Spotify connection was cancelled.';
  if (code.includes('spotify_callback_unavailable')) return 'Ridgeline could not open its secure Spotify callback. Check that no other app is using the configured port.';
  return 'Spotify could not complete that action. Please try again.';
}

export function SpotifyIntegrationSettings() {
  const connected = useSpotifyStore(s => s.connected);
  const sharingEnabled = useSpotifyStore(s => s.sharingEnabled);
  const configured = useSpotifyStore(s => s.configured);
  const activity = useSpotifyStore(s => s.activity);
  const storeError = useSpotifyStore(s => s.error);
  const refreshStatus = useSpotifyStore(s => s.refreshStatus);
  const setStatus = useSpotifyStore(s => s.setStatus);
  const setActivity = useSpotifyStore(s => s.setActivity);
  const setError = useSpotifyStore(s => s.setError);
  const [busy, setBusy] = useState<'sharing' | 'disconnect' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [connectModalOpen, setConnectModalOpen] = useState(false);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const updateSharing = async (enabled: boolean) => {
    if (!window.electronAPI?.spotifySetSharing) return;
    setBusy('sharing');
    setMessage(null);
    try {
      const status = await window.electronAPI.spotifySetSharing(enabled);
      setStatus(status);
      if (!enabled) {
        setActivity(null);
        setMessage('Spotify activity is now hidden from your profile.');
      }
    } catch (error) {
      setMessage(integrationMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!window.electronAPI?.spotifyDisconnect) return;
    setBusy('disconnect');
    setMessage(null);
    try {
      await window.electronAPI.spotifyDisconnect();
      setStatus({ connected: false, sharingEnabled: false });
      setActivity(null);
      setMessage('Spotify was disconnected and its local credentials were removed.');
    } catch (error) {
      setMessage(integrationMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const openCurrentTrack = () => {
    if (activity?.external_url) void window.electronAPI?.spotifyOpenTrack?.(activity.external_url);
  };

  return (
    <div className="spotify-integration-settings settings-section">
      <h2>Integrations</h2>
      <p className="spotify-integration-settings__intro">Connect Spotify to optionally show your current music on your full Ridgeline profile.</p>

      <section className="spotify-integration-settings__card" aria-labelledby="spotify-integration-title">
        <div className="spotify-integration-settings__heading">
          <span className="spotify-integration-settings__logo-shell">
            <SpotifyLogo size={31} label="Spotify" />
          </span>
          <div>
            <h3 id="spotify-integration-title">Spotify</h3>
            <p>{connected ? 'Connected locally to this Ridgeline desktop app.' : 'Share your current music only when you choose to.'}</p>
          </div>
          {connected && <span className="spotify-integration-settings__state">Connected</span>}
        </div>

        {!configured && (
          <p className="spotify-integration-settings__notice">Spotify needs a client ID configured by the Ridgeline desktop app before you can connect.</p>
        )}

        {!connected ? (
          <div className="spotify-integration-settings__connect-area">
            <button type="button" className="spotify-integration-settings__connect" onClick={() => setConnectModalOpen(true)} disabled={!configured}>
              <SpotifyLogo size={16} />
              Connect Spotify
            </button>
          </div>
        ) : (
          <>
            <label className="spotify-integration-settings__toggle-row">
              <span>
                <strong>Show Spotify activity on my profile</strong>
                <small>Nothing is public until this is turned on.</small>
              </span>
              <input
                type="checkbox"
                checked={sharingEnabled}
                disabled={busy !== null}
                onChange={event => void updateSharing(event.target.checked)}
                aria-label="Show Spotify activity on my profile"
              />
              <span className="spotify-integration-settings__switch" aria-hidden="true" />
            </label>
            <div className="spotify-integration-settings__actions">
              <button type="button" className="spotify-integration-settings__secondary" onClick={openCurrentTrack} disabled={!activity?.external_url}>
                Open current track
              </button>
              <button type="button" className="spotify-integration-settings__disconnect" onClick={disconnect} disabled={busy !== null}>
                {busy === 'disconnect' ? 'Disconnecting...' : 'Disconnect Spotify'}
              </button>
            </div>
          </>
        )}

        {(message || storeError) && <p className="spotify-integration-settings__message" role="status">{message || storeError}</p>}
      </section>

      <p className="spotify-integration-settings__privacy">Ridgeline stores only a short-lived public activity snapshot when sharing is enabled. Spotify credentials, email, device details, and playlists stay private.</p>
      {connectModalOpen && <SpotifyConnectionModal onClose={() => setConnectModalOpen(false)} onConnected={refreshStatus} />}
    </div>
  );
}
