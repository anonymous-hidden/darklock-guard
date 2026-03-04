# Darklock Guard

Advanced security and device protection system for Linux and Windows.
Built with Rust, Tauri v2, and React 18.

> **Version:** 2.0.0 &nbsp;|&nbsp; **Status:** Active Development &nbsp;|&nbsp; **License:** MIT

**Darklock Guard is open source.** The app is hosted and managed by Darklock Security at **[darklock.net](https://darklock.net)** — you don't build or run anything yourself.

---

## Get Started

| Platform | Link |
|----------|------|
| **Desktop — Linux** | [darklock.net/download](https://darklock.net/download) |
| **Desktop — Windows** | [darklock.net/download](https://darklock.net/download) |

> Darklock Guard runs as a background service. Once installed, it protects your device silently — no configuration needed.

---

## Table of Contents

- [What It Does](#what-it-does)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Security Design](#security-design)

---

## What It Does

Darklock Guard monitors your device for tampering, integrity violations, and unauthorized changes. It operates as a background service with a desktop UI for status and event review.

**Core protection loop:**
```
File change detected
        ↓
HMAC-SHA256 signature verified against baseline
        ↓
Violation? → Restore from encrypted backup + alert
No change?  → Log and continue monitoring
```

When a violation is detected the service automatically restores the affected file from an encrypted vault backup within seconds.

---

## Features

### File Integrity Monitoring
- Real-time file change detection via inotify (Linux) / FSEvents (Windows)
- HMAC-SHA256 cryptographic signatures for every protected file
- Baseline manifest tracks expected file state
- Automatic restore from encrypted backup on violation

### Encrypted Vault
- AES-256-GCM encrypted storage for device keys and backups
- Argon2id key derivation
- Corruption detection and automatic recovery
- Secure memory wiping on key disposal

### Multi-Mode Security

| Mode | Description |
|------|-------------|
| **Normal** | Standard protection — all features active |
| **Zero Trust** | All actions require verification |
| **Safe Mode** | Recovery mode with limited functionality — triggers on integrity failure |
| **Disconnected** | Offline operation with local-only protection |

### Event Logging
- Structured event log with severity levels (info / warning / error)
- Persistent SQLite audit trail
- Real-time event streaming to the desktop UI
- Filterable and exportable event history

### Update System
- Cryptographically signed update packages
- Atomic update application with automatic rollback on failure
- Stable and beta release channels

### Remote Device Management
- WebSocket connection to Darklock cloud management console at [darklock.net](https://darklock.net)
- Remote status monitoring, event review, and command dispatch
- Heartbeat telemetry with configurable reporting interval

---

## Architecture

```
darklock-guard/
├── crates/
│   ├── guard-core/       # Shared types — crypto, vault, IPC, event log, settings
│   ├── guard-service/    # Main protection daemon (Tokio async runtime)
│   │   ├── integrity/    # File watcher + HMAC scanner
│   │   ├── engine/       # Protection loop
│   │   └── connected/    # Cloud API client, heartbeat, telemetry
│   └── updater-helper/   # Signed update installer with rollback
└── desktop/              # Tauri v2 desktop UI (React + TypeScript)
    └── src/
        ├── pages/        # Status, Events, Settings, Devices
        ├── components/   # Reusable UI components
        ├── state/        # Global state + service integration
        └── api.ts        # Type-safe Tauri command wrappers
```

The Rust service and the desktop frontend communicate exclusively through Tauri's IPC command system — no HTTP between them.

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Service runtime | Rust + Tokio | 1.70+ |
| Desktop shell | Tauri | v2 |
| Frontend | React + TypeScript | 18 |
| UI components | Radix UI + Tailwind CSS | — |
| Crypto | HMAC-SHA256, AES-256-GCM, Argon2id | — |
| Storage | SQLite (event log), JSON (settings) | — |

---

## Security Design

### Integrity Verification Pipeline

```
Protected file
      │
      ▼
SHA-256 hash
      │
      ▼
HMAC(hash, device_secret)
      │
      ▼
Compare against signed baseline manifest
      │
   ┌──┴──┐
Match    Mismatch
  │          │
  ▼          ▼
Continue   Restore from vault + emit violation event
```

### Vault Security

- Device secrets derived with Argon2id — brute-force resistant
- Vault encrypted with AES-256-GCM — authenticated encryption
- Keys zeroed in memory after use
- Vault corruption triggers automatic Safe Mode

### IPC Security

- Tauri command whitelist prevents arbitrary code execution from the WebView
- WebView CSP prevents XSS in the UI
- All commands validated and typed end-to-end

---

**&copy; 2026 Darklock Security** — Released under the Open Source License (DOSL). Part of the [Darklock](https://darklock.net) security platform.
