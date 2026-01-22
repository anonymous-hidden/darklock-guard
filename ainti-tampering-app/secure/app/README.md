# FileGuard 🛡️

**File & Folder Tamper Protection**

> "If this file changes, I will know — and I can undo it."

FileGuard is a local-only desktop application that protects your important files from tampering, ransomware, and accidental modifications.

---

## ✨ Features

### Protection Modes
- **📊 Monitor Only** - Track changes without intervention
- **🔔 Alert on Change** - Get notified when files are modified
- **🔄 Auto-Restore** - Automatically restore tampered files
- **🔒 Sealed Mode** - Prevent any modifications (read-only)

### Key Capabilities
- **Real-time Monitoring** - Instant detection of file changes
- **Encrypted Backups** - AES-256 encrypted backup storage
- **SHA-256 Integrity** - Cryptographic verification of file contents
- **Activity Timeline** - Complete audit log of all events
- **Cross-Platform** - Works on Windows and Linux

### Privacy First
- ✅ 100% local - no cloud, no servers
- ✅ No telemetry or tracking
- ✅ No account required
- ✅ Your files never leave your machine

---

## 🖥️ Screenshots

*Coming soon*

---

## 📦 Installation

### Windows

**Option 1: Installer (Recommended)**
1. Download `FileGuard_Setup_v1.0.0.exe` from Releases
2. Run the installer
3. Launch FileGuard from Start Menu

**Option 2: Portable**
1. Download `FileGuard_Windows_Portable.zip` from Releases
2. Extract to any folder
3. Run `FileGuard.exe`

### Linux

**Option 1: .deb Package (Debian/Ubuntu)**
```bash
sudo dpkg -i fileguard_1.0.0_amd64.deb
```

**Option 2: AppImage**
```bash
chmod +x FileGuard-1.0.0-x86_64.AppImage
./FileGuard-1.0.0-x86_64.AppImage
```

---

## 🛠️ Building from Source

### Prerequisites

- Python 3.10+
- pip

### Install Dependencies

```bash
# Clone the repository
git clone https://github.com/yourusername/fileguard.git
cd fileguard

# Create virtual environment (recommended)
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Run in Development Mode

```bash
python main.py
```

### Build for Windows

```bash
python build_windows.py
```

Output: `dist/FileGuard/FileGuard.exe`

To create an installer:
1. Install [Inno Setup](https://jrsoftware.org/isinfo.php)
2. Open `FileGuard_setup.iss`
3. Click Build > Compile

### Build for Linux

```bash
python3 build_linux.py
```

Options:
```bash
python3 build_linux.py --deb      # .deb package only
python3 build_linux.py --appimage # AppImage only
```

---

## 📁 Project Structure

```
fileguard/
├── main.py                 # Application entry point
├── service.py              # Protection service orchestrator
├── requirements.txt        # Python dependencies
├── build_windows.py        # Windows build script
├── build_linux.py          # Linux build script
│
├── core/                   # Core functionality
│   ├── crypto.py          # AES-256 encryption
│   ├── hasher.py          # SHA-256 file hashing
│   ├── baseline.py        # SQLite database manager
│   ├── policy.py          # Protection policies
│   ├── watcher.py         # Real-time file monitoring
│   ├── restore.py         # Backup/restore engine
│   └── audit_log.py       # Signed audit logging
│
├── config/                 # Configuration
│   ├── settings.json      # Default settings
│   └── settings_manager.py # Settings management
│
├── ui/                     # User interface (PySide6)
│   ├── theme.py           # Light/dark theming
│   ├── sidebar.py         # Navigation sidebar
│   ├── main_window.py     # Main window
│   ├── dashboard_view.py  # Dashboard
│   ├── protected_files_view.py
│   ├── activity_view.py   # Activity timeline
│   ├── status_view.py     # Verification status
│   ├── settings_view.py   # Settings
│   ├── profile_view.py    # User profile
│   └── onboarding.py      # First-run wizard
│
└── assets/                 # Icons and images
    └── icon.ico / icon.png
```

---

## ⚙️ Configuration

Settings are stored locally in:
- **Windows:** `%APPDATA%/FileGuard/`
- **Linux:** `~/.config/fileguard/`

### Key Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `security.default_protection_mode` | Default mode for new files | `detect_alert` |
| `security.auto_restore_enabled` | Auto-restore tampered files | `false` |
| `security.backup_retention_count` | Backup versions to keep | `3` |
| `monitoring.scan_interval_seconds` | Periodic scan interval | `300` |
| `appearance.theme` | UI theme (system/light/dark) | `system` |

---

## 🔒 Security Details

### Encryption
- **Algorithm:** AES-256-GCM
- **Key Storage:** 
  - Windows: DPAPI (protected by Windows credentials)
  - Linux: Permission-locked file (0600)

### Integrity Verification
- **Hash Algorithm:** SHA-256
- **Metadata:** Size, modification time, permissions

### Audit Log
- HMAC-SHA256 signed entries
- Chain integrity verification
- Tamper-evident design

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [PySide6](https://doc.qt.io/qtforpython/) - Qt for Python
- [cryptography](https://cryptography.io/) - Cryptographic recipes
- [watchdog](https://github.com/gorakhargosh/watchdog) - File system events
- [PyInstaller](https://pyinstaller.org/) - Executable packaging

---

## 📞 Support

- **Issues:** [GitHub Issues](https://github.com/yourusername/fileguard/issues)
- **Discussions:** [GitHub Discussions](https://github.com/yourusername/fileguard/discussions)

---

<p align="center">
  Made with ❤️ for file security
</p>
