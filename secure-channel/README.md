Run this from a terminal:
cd "/media/cayden/New Volume1/Darklock backup/discord bot/secure-channel"
env -u ELECTRON_RUN_AS_NODE -u CODEX_CI npm run dev

To run it detached in the background like I did:
rm -f /tmp/ridgeline-dev.log
setsid bash -lc 'cd "/home/cayden/discord bot/discord bot/secure-channel" && exec env -u ELECTRON_RUN_AS_NODE -u CODEX_CI npm run dev </dev/null >>/tmp/ridgeline-dev.log 2>&1' >/dev/null 2>&1 &

Then check logs with:
tail -f /tmp/ridgeline-dev.log


# Darklock Secure Channel

**Production-grade, end-to-end encrypted messenger** for the Darklock platform.
Self-hosted on Raspberry Pi 5. Cross-platform Tauri desktop app (Windows + Linux).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        INTERNET / LAN                            │
│                                                                  │
│   ┌─────────┐         ┌─────────────────────┐                   │
│   │ Client  │◄──TLS──►│   Caddy (443/80)    │                   │
│   │ (Tauri) │         │   Reverse Proxy      │                   │
│   └─────────┘         └─────┬──────┬────────┘                   │
│                             │      │                             │
│                    /ids/*   │      │  /rly/*                     │
│                             ▼      ▼                             │
│                    ┌────────┐    ┌────────┐                      │
│                    │  IDS   │    │  RLY   │                      │
│                    │ :4100  │    │ :4101  │                      │
│                    └───┬────┘    └───┬────┘                      │
│                        │            │                            │
│                    ┌───┴──┐     ┌───┴──┐                        │
│                    │ids.db│     │rly.db│                         │
│                    └──────┘     └──────┘                         │
│                                                                  │
│                ── Raspberry Pi 5 (Docker) ──                     │
└──────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Language | Purpose |
|-----------|----------|---------|
| **dl_crypto** | Rust | Ed25519, X25519, XChaCha20-Poly1305, BLAKE3, Argon2id, HKDF |
| **dl_proto** | Rust | Wire protocol types (envelopes, messages, API DTOs) |
| **dl_store** | Rust | Encrypted local SQLite vault (app-level AEAD on each value) |
| **Tauri App** | Rust + React | Desktop client — all crypto runs locally, never on server |
| **IDS** | Node.js | Identity & Key Distribution Service (user registration, prekey bundles) |
| **RLY** | Node.js | Dumb Relay — stores opaque ciphertext blobs for polling |
| **Caddy** | Go | Reverse proxy with automatic TLS (Let's Encrypt or self-signed) |

---

## Cryptographic Design

### Key Hierarchy

```
Identity Key (Ed25519)          ← long-lived, per-user
  └─ signs → Device Cert        ← Ed25519 device key, signed by identity key
       └─ Device DH Key (X25519) ← for key agreement

Prekey Bundle (uploaded to IDS):
  ├─ Signed Pre-Key (SPK)       ← X25519, rotated periodically, signed by device key
  └─ One-Time Pre-Keys (OPK)    ← X25519, consumed on first message, replenished
```

### Session Establishment (X3DH-like)

1. Alice fetches Bob's prekey bundle from IDS
2. Alice performs X25519 DH: `(Alice_ephemeral, Bob_SPK)` + `(Alice_ephemeral, Bob_OPK)`
3. Shared secrets are combined via HKDF → initial root key
4. Alice sends `InitMessage` (ephemeral pubkey + OPK id) alongside first ciphertext
5. Bob receives, reconstructs same root key, session is established

### Message Encryption

- **AEAD**: XChaCha20-Poly1305 (24-byte nonce, 256-bit key)
- **Ratchet (v1)**: Simplified symmetric ratchet — `chain_step(chain_key)` via BLAKE3
- **Message ID**: `BLAKE3(sender_id || msg_counter || timestamp)`
- **Chain Link**: `BLAKE3(prev_chain_link || envelope_ciphertext)` for ordering verification

### Vault (Local Storage)

- Vault key derived from user password via **Argon2id** (m=64MB, t=3, p=4)
- All sensitive DB values encrypted at rest with XChaCha20-Poly1305
- Vault auto-locks after configurable timeout
- Memory is zeroized on lock

### Key Change Detection

- When a contact's identity key changes, messaging is **blocked** until the user explicitly re-verifies
- UI shows a prominent warning banner
- This prevents MITM key substitution attacks

---

## Project Structure

```
secure-channel/
├── Cargo.toml                    # Rust workspace root
├── docker-compose.yml            # Production deployment
├── .env.example                  # Environment variables template
│
├── crates/
│   ├── dl_crypto/                # Cryptographic primitives
│   │   └── src/ (identity, session, aead, kdf, hash)
│   ├── dl_proto/                 # Wire protocol types
│   │   └── src/ (envelope, message, api)
│   └── dl_store/                 # Encrypted local database
│       └── src/ (db, vault, models, migrations)
│
├── apps/
│   └── dl-secure-channel/        # Tauri desktop app
│       ├── src-tauri/            # Rust backend (commands, state, security)
│       │   └── src/commands/     # 19 Tauri command handlers
│       └── src/                  # React frontend
│           ├── pages/            # Auth, Chat, Profile, Settings, Security
│           ├── layouts/          # MainLayout (sidebar + chat)
│           ├── store/            # Zustand state (auth, chat)
│           └── lib/              # Tauri command bridge
│
├── services/
│   ├── dl_ids/                   # Identity Service (Node.js/Express)
│   │   └── src/routes/           # auth, devices, keys, users
│   └── dl_rly/                   # Relay Service (Node.js/Express)
│       └── src/routes/           # send, poll, ack, receipt
│
└── deploy/
    └── Caddyfile                 # Reverse proxy configuration
```

---

## Quick Start

### Prerequisites

- **Rust** ≥ 1.75 (with `cargo`)
- **Node.js** ≥ 20
- **Docker** + Docker Compose (for server deployment)
- **Tauri CLI**: `cargo install tauri-cli --version "^2.0"`

### 1. Deploy Server (Pi 5 / any Docker host)

```bash
cd secure-channel
cp .env.example .env

# Generate a secure JWT secret
SHARED_JWT_SECRET="$(openssl rand -hex 32)"
echo "IDS_JWT_SECRET=${SHARED_JWT_SECRET}" >> .env
echo "RLY_JWT_SECRET=${SHARED_JWT_SECRET}" >> .env

# Edit domain if needed
nano .env

# Start services
docker compose up -d

# Verify
curl -k https://darklock.local/ids/health
curl -k https://darklock.local/rly/health
```

### 2. Build Desktop App

```bash
cd secure-channel/apps/dl-secure-channel

# Install frontend dependencies
npm install

# Build the Tauri app (release mode)
cargo tauri build

# Binary will be in:
#   target/release/dl-secure-channel       (Linux)
#   target/release/dl-secure-channel.exe   (Windows)
```

### 3. Development Mode

```bash
# Terminal 1: Start IDS locally
cd secure-channel/services/dl_ids
npm install
IDS_JWT_SECRET=$(openssl rand -hex 32) node src/server.js

# Terminal 2: Start RLY locally
cd secure-channel/services/dl_rly
npm install
RLY_JWT_SECRET=$IDS_JWT_SECRET node src/server.js

# Terminal 3: Start Tauri dev mode
cd secure-channel/apps/dl-secure-channel
npm install
cargo tauri dev
```

---

## Security Properties

| Property | Implementation |
|----------|---------------|
| **End-to-End Encryption** | All crypto in Rust on-device. Server never sees plaintext. |
| **Forward Secrecy** | Per-session DH + symmetric ratchet. Compromise of current key doesn't reveal past messages. |
| **Deniability** | Symmetric ratchet — either party could have produced any message. |
| **Zero-Knowledge Server** | IDS stores only public keys. RLY stores only opaque ciphertext. |
| **Key Change Detection** | Identity key changes block messaging until re-verified. |
| **Encrypted-at-Rest** | Local SQLite vault: Argon2id KDF + XChaCha20-Poly1305. |
| **Memory Safety** | Core crypto in Rust. `zeroize` on all secret material. |
| **Tamper Detection** | BLAKE3 chain links for message ordering verification. |
| **Security Checks** | Startup risk assessment: debug mode, root, suspicious processes, time rollback. |

---

## Roadmap

### Phase 1 (Current) — v0.1
- [x] Core crypto crate (Ed25519, X25519, AEAD, KDF)
- [x] Encrypted local storage (SQLite + vault)
- [x] Tauri desktop app with full E2EE 1:1 messaging
- [x] IDS + RLY services with Docker deployment
- [x] Key change detection and blocking

### Phase 2 — v0.2
- [ ] Full Double Ratchet (DH ratchet + symmetric ratchet)
- [ ] Group messaging (Sender Keys / MLS)
- [ ] File attachment encryption (chunked AEAD)
- [ ] Device key rotation flow
- [ ] Push notifications via relay

### Phase 3 — v0.3
- [ ] Multi-device sync (device fan-out)
- [ ] Disappearing messages
- [ ] QR code contact verification
- [ ] Audit log / tamper-evident history
- [ ] Mobile app (Tauri mobile or React Native)

---

## Environment Variables

| Variable | Service | Required | Default | Description |
|----------|---------|----------|---------|-------------|
| `IDS_JWT_SECRET` | IDS | **Yes** | — | IDS HS256 signing key (≥32 chars). Must match `RLY_JWT_SECRET`. |
| `RLY_JWT_SECRET` | RLY | **Yes** | — | Relay HS256 verification key (≥32 chars). No fallback env names are accepted. |
| `IDS_PORT` | IDS | No | `4100` | IDS listen port |
| `RLY_PORT` | RLY | No | `4101` | RLY listen port |
| `IDS_DB_PATH` | IDS | No | `./data/ids.db` | IDS SQLite path |
| `RLY_DB_PATH` | RLY | No | `./data/rly.db` | RLY SQLite path |
| `RLY_ENVELOPE_TTL` | RLY | No | `7` | Days to keep envelopes |
| `DOMAIN` | Caddy | No | `darklock.local` | Domain for TLS |
| `TLS_MODE` | Caddy | No | `internal` | `internal` (self-signed) or omit for Let's Encrypt |

### JWT Secret Rotation (IDS + RLY)

1. Generate a new random secret (`openssl rand -hex 32`).
2. Update both `IDS_JWT_SECRET` and `RLY_JWT_SECRET` with the new value.
3. Restart IDS and RLY in the same maintenance window.
4. Existing tokens become invalid and clients re-authenticate with newly issued tokens.

Relay startup fails fast if `RLY_JWT_SECRET` is missing, too short, or placeholder/weak.

---

## License

Proprietary — Darklock Project. All rights reserved.
