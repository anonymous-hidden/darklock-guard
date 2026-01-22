# Secure Setup Wizard

A professional, privacy-respecting Windows setup wizard for developers and security professionals.

## Features

- Modern, clean UI with dark mode support
- Privacy-first design (no telemetry)
- User-selectable installation options
- Transparent installation process
- Uses official package sources only (winget)

## Requirements

- Windows 10/11
- Python 3.8+
- Administrator privileges (for software installation)

## Installation

1. Install Python dependencies:
```powershell
pip install -r requirements.txt
```

2. Run the wizard:
```powershell
python main.py
```

## What Gets Installed

### Developer Tools
- Git
- Visual Studio Code
- Python 3.12
- Node.js LTS
- Docker Desktop

### Cybersecurity Tools
- Wireshark
- Nmap
- Sysinternals Suite
- Postman
- DB Browser for SQLite

### Virtualization & Linux
- VirtualBox
- WSL2 with Ubuntu

### Folder Structure
Creates organized development folders at C:\Dev\

## Privacy

This application:
- Does NOT collect any personal data
- Does NOT send telemetry
- Does NOT track your usage
- Only connects to official Microsoft winget repositories

All settings are stored locally in `config.json`.

## License

For educational and professional use.
