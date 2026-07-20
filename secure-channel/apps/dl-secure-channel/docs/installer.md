# Ridgeline Windows Installer

Ridgeline uses electron-builder's assisted NSIS target. The stable application ID
is `com.darklock.ridgeline`; do not change it because it is part of update and
existing-install compatibility.

The installer defaults to a per-user installation, permits a user-selected
destination, offers desktop and Start menu shortcuts, and preserves user data
on uninstall. The standard electron-builder running-app check is retained so
locked application files are not replaced unsafely.

Installer assets live in `public/installer`. Regenerate the icon and bitmap
resources after updating `public/icon.png`:

```powershell
& 'C:\Users\cayden\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' scripts/generate-installer-assets.py
```

Build a Windows installer with `npm run package:win`. Signing remains external
to this configuration; a release is production-ready only after the executable
and installer have valid Darklock signing certificates.
