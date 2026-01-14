# Darklock Guard Installer

This is a placeholder file. Replace `darklocksetup.exe` with your actual installer executable.

## Building the Installer

To create the installer:

1. Build your desktop app using the build scripts
2. Use a tool like Inno Setup or NSIS to create an installer
3. Name it `darklocksetup.exe`
4. Place it in this directory
5. The download will be available at: http://localhost:3001/platform/download/darklock-guard

## Installer Requirements

The installer should:
- Check for .NET Framework 4.8+
- Request administrator privileges
- Install to Program Files
- Create desktop shortcut
- Add to Start Menu
- Register for auto-start (optional)
- Set up file associations if needed
