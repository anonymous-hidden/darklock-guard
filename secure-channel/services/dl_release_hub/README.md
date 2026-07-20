# Ridgeline Release Hub

The Pi hosts signed policy metadata and immutable installer artifacts. It binds only to
`127.0.0.1:4102`; Caddy is responsible for public TLS on `releases.darklock.net`.

The Ed25519 private key lives outside the repository at
`/etc/ridgeline-release-hub/keys/ridgeline-update-signing.pem`, owned by root. Release state lives in
`/var/lib/ridgeline-release-hub`, separate from IDS data. `publish-release.js`
must be run on the Pi by an operator with controlled sudo access. It validates the
electron-builder `latest.yml`, verifies the installer SHA-512, copies it once to an
immutable versioned location, then signs a policy envelope. The desktop client verifies
that signature and independently verifies the downloaded installer SHA-256.

Example publication on the Pi:

```sh
sudo -u ridgeline-release env \
  RELEASE_HUB_DATA_DIR=/var/lib/ridgeline-release-hub \
  RELEASE_HUB_SIGNING_KEY=/etc/ridgeline-release-hub/keys/ridgeline-update-signing.pem \
  RELEASE_HUB_PUBLIC_URL=https://releases.darklock.net/ridgeline \
  node /opt/ridgeline/secure-channel/services/dl_release_hub/src/publish-release.js \
  --channel stable --release-dir /srv/ridgeline-release/2.0.6
```

Do not expose port 4102. Do not substitute a LAN IP or HTTP URL in the desktop updater.
