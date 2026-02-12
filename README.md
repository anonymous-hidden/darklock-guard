<div align="center">

# 🛡️ Darklock Guard

**Enterprise-Grade Security & Device Protection Suite**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB?logo=tauri)](https://tauri.app)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://reactjs.org)
[![Rust](https://img.shields.io/badge/Rust-1.70+-orange?logo=rust)](https://www.rust-lang.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript)](https://www.typescriptlang.org)

[Features](#-features) • [Installation](#-installation) • [Usage](#-usage) • [Architecture](#-architecture) • [Contributing](#-contributing)

</div>

---

## 📖 Overview

**Darklock Guard** is a powerful desktop security application that provides comprehensive device protection through real-time file integrity monitoring, zero-trust security modes, and intelligent threat detection. Built with modern technologies, it offers enterprise-level security features in a clean, intuitive interface.

### 🎯 Key Highlights

- 🔒 **Zero-Trust Security Model** - Multiple security profiles including normal, zero-trust, and safe mode
- 🔍 **Real-Time File Integrity Monitoring** - HMAC-based signature verification for critical files
- 🛡️ **Vault Protection** - Encrypted secure storage for sensitive data
- 📊 **Comprehensive Event Logging** - Track all security events with detailed audit trails
- 🔄 **Automatic Updates** - Secure, verified update system with rollback capabilities
- 🎮 **Device Control** - Remote management and monitoring capabilities
- 🖥️ **Cross-Platform** - Available for Windows, macOS, and Linux

---

## ✨ Features

### 🔐 Security & Protection

- **Multi-Mode Operation**
  - Normal mode for everyday use
  - Zero-trust mode for maximum security
  - Safe mode for recovery and troubleshooting
  - Disconnected mode for offline operation

- **File Integrity Protection**
  - HMAC-based file signature verification
  - Real-time monitoring of critical system files
  - Automatic detection of unauthorized modifications
  - Quarantine suspicious files

- **Vault System**
  - Encrypted secure storage
  - Crypto error detection and recovery
  - Automatic vault health monitoring

### 📱 Management & Monitoring

- **Real-Time Status Dashboard**
  - Live connection status
  - Security profile monitoring
  - System health indicators
  - Recent activity feed

- **Event Management**
  - Comprehensive event logging (info, warning, error)
  - Filterable event history
  - Export capabilities
  - Detailed event metadata

- **Security Scans**
  - On-demand and scheduled scanning
  - Deep file system analysis
  - Threat detection and reporting
  - Scan history and results

### 🔄 Updates & Maintenance

- **Secure Update System**
  - Verified update downloads
  - Backup manifest creation
  - Rollback on failure
  - Multiple update channels (stable/beta)

- **Remote Management**
  - Cloud-connected device management
  - Remote activity tracking
  - Command execution with status monitoring

### ⚙️ Configuration

- **Flexible Settings**
  - Customizable security profiles
  - Adjustable scan schedules
  - Network and connection options
  - UI preferences

---

## 🚀 Installation

### Prerequisites

- **Node.js** v18+ and npm v8+
- **Rust** 1.70+ with Cargo
- **Platform-specific requirements:**
  - **Windows:** WebView2 (usually pre-installed on Windows 10/11)
  - **macOS:** Xcode Command Line Tools
  - **Linux:** webkit2gtk, libssl, libgtk-3

### Quick Start

```bash
# Clone the repository
git clone https://github.com/yourusername/darklock-guard.git
cd darklock-guard

# Install dependencies
cd desktop
npm install

# Run in development mode
npm run tauri
```

### Building from Source

```bash
# Build for production
npm run tauri:build

# Output will be in desktop/src-tauri/target/release/bundle/
```

---

## 🎮 Usage

### First Launch

1. **Setup Wizard** - Follow the initial setup wizard to configure your security preferences
2. **Vault Creation** - Create a secure vault for encrypted storage
3. **Connection** - Optionally connect to Darklock cloud services for remote management

### Dashboard Navigation

- **Status** - Overview of device security status and recent activity
- **Protection** - Configure file integrity monitoring and protection settings
- **Scans** - Run security scans and view scan history
- **Events** - View detailed security event logs
- **Updates** - Check for and install updates
- **Device Control** - Manage remote device connections
- **Settings** - Customize Guard behavior and preferences

### Security Modes

```
Normal Mode → Standard protection for daily use
Zero-Trust Mode → Maximum security, all actions require verification
Safe Mode → Recovery mode with limited functionality
Disconnected Mode → Offline operation, no cloud connectivity
```

---

## 🏗️ Architecture

### Technology Stack

```
Frontend: React 18 + TypeScript + Vite + Tailwind CSS
Backend: Rust (Tauri 2.0)
UI Components: Radix UI primitives
State Management: React Context + Hooks
IPC: Tauri's command system
Security: HMAC signatures, encrypted vault
```

### Project Structure

```
darklock-guard/
├── desktop/              # Tauri desktop application
│   ├── src/             # React frontend source
│   │   ├── pages/       # Application pages
│   │   ├── components/  # Reusable UI components
│   │   ├── state/       # State management
│   │   └── api.ts       # Backend API client
│   ├── src-tauri/       # Rust backend
│   └── public/          # Static assets
├── crates/              # Rust workspace crates
│   ├── guard-core/      # Core security logic
│   ├── guard-service/   # Background service
│   └── updater-helper/  # Update management
├── website/             # Marketing/documentation site
└── docs/                # Developer documentation
```

### Core Components

- **Guard Core** - File integrity monitoring, HMAC verification, vault management
- **Guard Service** - Background service for continuous protection
- **Updater Helper** - Secure update verification and installation
- **Desktop UI** - User-facing Tauri application

---

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the `desktop` directory:

```env
# API Configuration
VITE_API_URL=http://localhost:3001
VITE_PLATFORM_URL=http://localhost:3002

# Development
VITE_DEV_MODE=true
```

### Settings File

Guard stores settings in platform-specific locations:
- **Windows:** `%APPDATA%\com.darklock.guard\`
- **macOS:** `~/Library/Application Support/com.darklock.guard/`
- **Linux:** `~/.config/darklock-guard/`

---

## 🛠️ Development

### Running Tests

```bash
# Rust tests
cargo test --workspace

# Frontend tests (if configured)
npm test
```

### Development Mode

```bash
# Start with hot reload
npm run tauri

# Build specific crate
cargo build -p guard-core
```

### Code Quality

```bash
# Lint frontend
npm run lint

# Format Rust code
cargo fmt --all

# Check Rust code
cargo clippy --all-targets
```

---

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Coding Standards

- Follow Rust idioms and best practices
- Use TypeScript strict mode
- Write clear commit messages
- Add tests for new features
- Update documentation as needed

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Built with [Tauri](https://tauri.app)
- UI powered by [Radix UI](https://www.radix-ui.com) and [Tailwind CSS](https://tailwindcss.com)
- Icons by [Lucide](https://lucide.dev)

---

## 📞 Support

- **Documentation:** [docs/](docs/)
- **Issues:** [GitHub Issues](https://github.com/yourusername/darklock-guard/issues)
- **Discussions:** [GitHub Discussions](https://github.com/yourusername/darklock-guard/discussions)

---

<div align="center">

**Made with ❤️ by the Darklock Team**

[⬆ Back to Top](#️-darklock-guard)

</div>
