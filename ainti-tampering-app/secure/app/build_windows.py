"""
FileGuard - File & Folder Tamper Protection
============================================

Build Script for Windows (.exe) using PyInstaller

Requirements:
    pip install pyinstaller

Usage:
    python build_windows.py
"""

import subprocess
import sys
import shutil
from pathlib import Path

# Build configuration
APP_NAME = "FileGuard"
VERSION = "1.0.0"
DESCRIPTION = "File & Folder Tamper Protection"

# Paths
ROOT_DIR = Path(__file__).parent
DIST_DIR = ROOT_DIR / "dist"
BUILD_DIR = ROOT_DIR / "build"
ICON_PATH = ROOT_DIR / "assets" / "icon.ico"


def check_pyinstaller():
    """Check if PyInstaller is installed."""
    try:
        import PyInstaller
        print(f"✓ PyInstaller {PyInstaller.__version__} found")
        return True
    except ImportError:
        print("✗ PyInstaller not found. Installing...")
        subprocess.run([sys.executable, "-m", "pip", "install", "pyinstaller"])
        return True


def clean_build():
    """Clean previous build artifacts."""
    print("\nCleaning previous builds...")
    
    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
        print(f"  Removed {DIST_DIR}")
    
    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR)
        print(f"  Removed {BUILD_DIR}")
    
    spec_file = ROOT_DIR / f"{APP_NAME}.spec"
    if spec_file.exists():
        spec_file.unlink()
        print(f"  Removed {spec_file}")


def create_assets():
    """Create assets directory with icon placeholder."""
    assets_dir = ROOT_DIR / "assets"
    assets_dir.mkdir(exist_ok=True)
    
    # Create a placeholder icon message
    icon_readme = assets_dir / "README.txt"
    icon_readme.write_text(
        "Place your icon.ico file here for Windows builds.\n"
        "Recommended size: 256x256 pixels.\n"
    )


def build_exe():
    """Build the Windows executable."""
    print(f"\nBuilding {APP_NAME} v{VERSION} for Windows...")
    
    # PyInstaller options
    options = [
        "pyinstaller",
        "--name", APP_NAME,
        "--windowed",  # No console window
        "--onedir",  # Create a directory with all dependencies
        "--clean",
        "--noconfirm",
        
        # Add data files
        "--add-data", f"config/settings.json;config",
        
        # Hidden imports for PySide6
        "--hidden-import", "PySide6.QtCore",
        "--hidden-import", "PySide6.QtWidgets", 
        "--hidden-import", "PySide6.QtGui",
        
        # Hidden imports for cryptography
        "--hidden-import", "cryptography.hazmat.backends.openssl",
        "--hidden-import", "cryptography.hazmat.bindings._openssl",
        
        # Hidden imports for watchdog
        "--hidden-import", "watchdog.observers",
        "--hidden-import", "watchdog.events",
        
        # Exclude unnecessary modules to reduce size
        "--exclude-module", "tkinter",
        "--exclude-module", "matplotlib",
        "--exclude-module", "numpy",
        "--exclude-module", "PIL",
        "--exclude-module", "pytest",
    ]
    
    # Add icon if it exists
    if ICON_PATH.exists():
        options.extend(["--icon", str(ICON_PATH)])
    
    # Add the main script
    options.append("main.py")
    
    # Run PyInstaller
    result = subprocess.run(options, cwd=str(ROOT_DIR))
    
    if result.returncode == 0:
        print(f"\n✓ Build successful!")
        print(f"  Output: {DIST_DIR / APP_NAME}")
        return True
    else:
        print(f"\n✗ Build failed with code {result.returncode}")
        return False


def create_installer_script():
    """Create an Inno Setup script for installer creation."""
    inno_script = f'''
; FileGuard Inno Setup Script
; Requires Inno Setup 6.x

[Setup]
AppName={APP_NAME}
AppVersion={VERSION}
AppPublisher=FileGuard
DefaultDirName={{autopf}}\\{APP_NAME}
DefaultGroupName={APP_NAME}
OutputDir=installer
OutputBaseFilename={APP_NAME}_Setup_v{VERSION}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"
Name: "startupicon"; Description: "Start with Windows"; GroupDescription: "Startup:"

[Files]
Source: "dist\\{APP_NAME}\\*"; DestDir: "{{app}}"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{{group}}\\{APP_NAME}"; Filename: "{{app}}\\{APP_NAME}.exe"
Name: "{{group}}\\Uninstall {APP_NAME}"; Filename: "{{uninstallexe}}"
Name: "{{autodesktop}}\\{APP_NAME}"; Filename: "{{app}}\\{APP_NAME}.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\\Microsoft\\Windows\\CurrentVersion\\Run"; ValueType: string; ValueName: "{APP_NAME}"; ValueData: "{{app}}\\{APP_NAME}.exe"; Flags: uninsdeletevalue; Tasks: startupicon

[Run]
Filename: "{{app}}\\{APP_NAME}.exe"; Description: "Launch {APP_NAME}"; Flags: nowait postinstall skipifsilent
'''
    
    script_path = ROOT_DIR / f"{APP_NAME}_setup.iss"
    script_path.write_text(inno_script)
    print(f"\n✓ Inno Setup script created: {script_path}")
    print("  Use Inno Setup to compile this into an installer.")


def main():
    """Main build process."""
    print("=" * 50)
    print(f"  {APP_NAME} Build Script for Windows")
    print("=" * 50)
    
    # Check dependencies
    if not check_pyinstaller():
        return 1
    
    # Create assets
    create_assets()
    
    # Clean previous builds
    clean_build()
    
    # Build executable
    if not build_exe():
        return 1
    
    # Create installer script
    create_installer_script()
    
    print("\n" + "=" * 50)
    print("  Build Complete!")
    print("=" * 50)
    print(f"\nExecutable: {DIST_DIR / APP_NAME / f'{APP_NAME}.exe'}")
    print("\nTo create an installer:")
    print("  1. Install Inno Setup (https://jrsoftware.org/isinfo.php)")
    print(f"  2. Open {APP_NAME}_setup.iss in Inno Setup")
    print("  3. Compile the script")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
