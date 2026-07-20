import { SpotifyIntegrationSettings } from '../../SpotifyIntegrationSettings';

// Legacy settings shell still renders this tab in older navigation paths.
// Keep it on the same secure Electron-backed integration implementation.
export default function ConnectionsTab() {
  return <SpotifyIntegrationSettings />;
}
