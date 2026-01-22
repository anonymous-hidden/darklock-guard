"""
Build script to create .exe from setup wizard using PyInstaller.
Run this script to generate SetupWizard.exe

Usage:
    python build_exe.py
"""

import os
import sys
import subprocess
from pathlib import Path


def check_pyinstaller():
    """Check if PyInstaller is installed."""
    try:
        import PyInstaller
        return True
    except ImportError:
        return False


def install_pyinstaller():
    """Install PyInstaller via pip."""
    print("Installing PyInstaller...")
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "pyinstaller"])
    print("✓ PyInstaller installed")


def build_exe():
    """Build the executable using PyInstaller."""

    # PyInstaller command
    cmd = [
        "pyinstaller",
        "--name=SetupWizard",           # Output name
        "--onefile",                     # Single .exe file
        "--windowed",                    # No console window (GUI app)
        # No icon (add --icon=youricon.ico if you have one)
        "--icon=NONE",
        "--add-data=privacy_policy.txt;.",  # Include privacy policy
        "--hidden-import=customtkinter",
        "--hidden-import=Pillow",
        "--hidden-import=PIL._tkinter_finder",
        "--hidden-import=wizard_ui",     # Explicitly include wizard_ui
        "--hidden-import=installer",     # Include installer module
        "--hidden-import=config",        # Include config module
        "--collect-all=customtkinter",   # Include all customtkinter files
        "--noconfirm",                   # Overwrite without asking
        "main.py"                        # Main entry point
    ]

    print("Building executable...")
    print(f"Command: {' '.join(cmd)}")
    print()

    result = subprocess.run(cmd, capture_output=False)

    if result.returncode == 0:
        print()
        print("=" * 70)
        print("  BUILD SUCCESSFUL")
        print("=" * 70)
        print()

        exe_path = Path("dist/SetupWizard.exe")
        if exe_path.exists():
            size_mb = exe_path.stat().st_size / (1024 * 1024)
            print(f"✓ Executable created: {exe_path.absolute()}")
            print(f"✓ Size: {size_mb:.2f} MB")
            print()
            print("You can now distribute this .exe file!")
        else:
            print("WARNING: Build completed but .exe not found at expected location")
    else:
        print()
        print("ERROR: Build failed")
        sys.exit(1)


def main():
    """Main build process."""
    print()
    print("=" * 70)
    print("  Setup Wizard - EXE Builder")
    print("=" * 70)
    print()

    # Check dependencies
    print("Checking dependencies...")

    if not check_pyinstaller():
        print("PyInstaller not found.")
        response = input("Install PyInstaller now? (y/n): ").strip().lower()
        if response == 'y':
            install_pyinstaller()
        else:
            print("Cannot build without PyInstaller. Exiting.")
            sys.exit(1)
    else:
        print("✓ PyInstaller installed")

    print()

    # Verify required files
    required_files = ["main.py", "wizard_ui.py",
                      "installer.py", "config.py", "requirements.txt"]
    missing_files = [f for f in required_files if not Path(f).exists()]

    if missing_files:
        print("ERROR: Missing required files:")
        for f in missing_files:
            print(f"  ✗ {f}")
        sys.exit(1)

    print("✓ All required files found")
    print()

    # Build
    build_exe()

    print()
    print("Next steps:")
    print("  1. Test dist/SetupWizard.exe on this machine")
    print("  2. Test on a clean Windows VM")
    print("  3. Distribute to users")
    print()


if __name__ == "__main__":
    main()
