# Secure Setup Wizard - Windows Installer

A professional, self-contained Windows installer for setting up a complete development and cybersecurity environment.

## Features

- **Self-Contained**: Single .exe file, no prerequisites required
- **Privacy-First**: No telemetry, tracking, or data collection
- **Official Sources**: Uses only winget and official vendors
- **Modern UI**: Clean wizard interface with dark theme support
- **Transparent**: Shows exactly what will be installed
- **Enterprise-Ready**: Suitable for corporate and government environments

## What Gets Installed

### Developer Tools (Optional)
- Git
- Visual Studio Code
- Python 3.12
- Node.js LTS
- Docker Desktop

### Cybersecurity Tools (Optional)
- Wireshark
- Nmap
- Sysinternals Suite
- Postman
- DB Browser for SQLite

### Virtualization & Linux (Optional)
- VirtualBox
- WSL2 (Windows Subsystem for Linux)
- Ubuntu for WSL

### Folder Structure (Optional)
Creates organized development folders at `C:\Dev\`:
```
C:\Dev\
├── projects/
├── bots/
├── security/
├── labs/
├── scripts/
└── notes/
```

## System Requirements

- Windows 10 (build 17763+) or Windows 11
- Administrator privileges
- Internet connection for downloading packages
- ~10GB free disk space (depending on selections)

## Building the Installer

### Prerequisites

1. **Download and Install Inno Setup**
   - Download from: https://jrsoftware.org/isdl.php
   - Install version 6.2.2 or later
   - Use the Unicode version

### Build Instructions

1. Open Inno Setup Compiler

2. Open the script file:
   - File → Open → Select `SecureSetupWizard.iss`

3. Compile the installer:
   - Build → Compile (or press Ctrl+F9)

4. The installer will be created in the `output/` folder:
   - `SecureSetupWizard-Setup.exe`

### Command-Line Build

```powershell
# Assuming Inno Setup is installed at default location
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" SecureSetupWizard.iss
```

The compiled installer will be in: `output\SecureSetupWizard-Setup.exe`

## Distribution

The resulting `.exe` file is completely self-contained and can be:
- Distributed via USB drives
- Downloaded from a website
- Deployed via enterprise software management tools
- Shared with colleagues

**File size**: ~50KB (installer only, downloads packages during installation)

## Usage

1. Double-click `SecureSetupWizard-Setup.exe`
2. Click "Yes" when prompted for administrator privileges
3. Follow the wizard:
   - Read and accept the privacy policy
   - Select which components to install
   - Review the installation plan
   - Wait for installation to complete
4. Restart your computer when prompted

## Installation Log

Installation logs are saved to:
```
C:\ProgramData\SecureSetupWizard\install.log
```

You can review this log to see:
- What was installed
- Any errors or warnings
- Installation timestamps

## Privacy & Security

- **No Telemetry**: This installer does not phone home
- **No Tracking**: No analytics or user tracking
- **Local Only**: All settings stored locally
- **Open Source**: Scripts are human-readable PowerShell
- **Auditable**: All actions logged transparently

## Customization

To customize the installer:

1. Edit `SecureSetupWizard.iss`:
   - Change app name, version, publisher
   - Add/remove packages in the installation scripts
   - Modify UI text and colors

2. Edit PowerShell scripts in `scripts/`:
   - `bootstrap.ps1` - winget availability checks
   - `install.ps1` - package installation logic
   - `create-folders.ps1` - folder structure creation

3. Rebuild using Inno Setup Compiler

## Troubleshooting

### winget Not Found
- Ensure Windows is fully updated
- Windows 11 includes winget by default
- Windows 10 users may need to install App Installer from Microsoft Store

### Installation Failures
- Check the log file at `C:\ProgramData\SecureSetupWizard\install.log`
- Ensure you have a stable internet connection
- Try running the installer as Administrator
- Check if Windows Defender or antivirus is blocking

### WSL Installation Issues
- WSL requires Windows 10 build 19041+ or Windows 11
- A restart is required to complete WSL installation
- Run `wsl --status` in PowerShell to check status

## Uninstallation

The installer itself can be uninstalled via:
- Settings → Apps → Secure Setup Wizard → Uninstall

**Note**: This only removes the installer, not the installed software packages.

To remove installed software:
- Use Windows Settings → Apps to uninstall individual programs
- Or use: `winget uninstall <package-id>`

## License

This installer is provided for educational and professional use.

## Support

For issues or questions:
- Review the installation log
- Check system requirements
- Ensure Windows is up to date

## Security Audit

This installer has been designed for security audit compliance:
- All actions are logged
- No obfuscated code
- PowerShell scripts are signed-friendly
- Uses only official package sources
- Requires explicit user consent
- Follows least-privilege principles where possible
