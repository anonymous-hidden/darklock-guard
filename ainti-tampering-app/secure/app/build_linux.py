#!/usr/bin/env python3
"""
FileGuard - File & Folder Tamper Protection
============================================

Build Script for Linux (.deb and AppImage)

Requirements:
    pip install pyinstaller

For .deb packages:
    sudo apt install dpkg-deb fakeroot

For AppImage:
    Download appimagetool from https://github.com/AppImage/AppImageKit

Usage:
    python3 build_linux.py
    python3 build_linux.py --deb
    python3 build_linux.py --appimage
"""

import subprocess
import sys
import shutil
import os
import argparse
from pathlib import Path

# Build configuration
APP_NAME = "fileguard"
APP_NAME_DISPLAY = "FileGuard"
VERSION = "1.0.0"
DESCRIPTION = "File & Folder Tamper Protection"
MAINTAINER = "FileGuard Team <fileguard@example.com>"

# Paths
ROOT_DIR = Path(__file__).parent
DIST_DIR = ROOT_DIR / "dist"
BUILD_DIR = ROOT_DIR / "build"
ICON_PATH = ROOT_DIR / "assets" / "icon.png"


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


def create_assets():
    """Create assets directory with icon placeholder."""
    assets_dir = ROOT_DIR / "assets"
    assets_dir.mkdir(exist_ok=True)
    
    icon_readme = assets_dir / "README.txt"
    if not icon_readme.exists():
        icon_readme.write_text(
            "Place your icon.png file here for Linux builds.\n"
            "Recommended size: 256x256 pixels.\n"
        )


def build_binary():
    """Build the Linux binary using PyInstaller."""
    print(f"\nBuilding {APP_NAME_DISPLAY} v{VERSION} for Linux...")
    
    options = [
        "pyinstaller",
        "--name", APP_NAME,
        "--windowed",
        "--onedir",
        "--clean",
        "--noconfirm",
        
        # Add data files
        "--add-data", "config/settings.json:config",
        
        # Hidden imports
        "--hidden-import", "PySide6.QtCore",
        "--hidden-import", "PySide6.QtWidgets",
        "--hidden-import", "PySide6.QtGui",
        "--hidden-import", "cryptography.hazmat.backends.openssl",
        "--hidden-import", "watchdog.observers",
        "--hidden-import", "watchdog.observers.inotify",
        
        # Exclude unnecessary modules
        "--exclude-module", "tkinter",
        "--exclude-module", "matplotlib",
        "--exclude-module", "numpy",
        "--exclude-module", "PIL",
        "--exclude-module", "pytest",
        
        "main.py"
    ]
    
    result = subprocess.run(options, cwd=str(ROOT_DIR))
    
    if result.returncode == 0:
        print(f"\n✓ Binary build successful!")
        return True
    else:
        print(f"\n✗ Binary build failed with code {result.returncode}")
        return False


def build_deb():
    """Build a .deb package."""
    print("\nBuilding .deb package...")
    
    deb_dir = BUILD_DIR / "deb"
    deb_name = f"{APP_NAME}_{VERSION}_amd64"
    package_dir = deb_dir / deb_name
    
    # Create directory structure
    (package_dir / "DEBIAN").mkdir(parents=True)
    (package_dir / "usr" / "bin").mkdir(parents=True)
    (package_dir / "usr" / "share" / "applications").mkdir(parents=True)
    (package_dir / "usr" / "share" / "icons" / "hicolor" / "256x256" / "apps").mkdir(parents=True)
    (package_dir / "opt" / APP_NAME).mkdir(parents=True)
    
    # Copy application files
    app_source = DIST_DIR / APP_NAME
    if app_source.exists():
        shutil.copytree(app_source, package_dir / "opt" / APP_NAME, dirs_exist_ok=True)
    
    # Create symlink script
    launcher = package_dir / "usr" / "bin" / APP_NAME
    launcher.write_text(f'#!/bin/bash\nexec /opt/{APP_NAME}/{APP_NAME} "$@"\n')
    launcher.chmod(0o755)
    
    # Create control file
    control = f"""Package: {APP_NAME}
Version: {VERSION}
Section: utils
Priority: optional
Architecture: amd64
Depends: libxcb-cursor0
Maintainer: {MAINTAINER}
Description: {DESCRIPTION}
 FileGuard is a local-only file protection application that monitors
 your important files and protects them from tampering, ransomware,
 and accidental modifications.
"""
    (package_dir / "DEBIAN" / "control").write_text(control)
    
    # Create desktop entry
    desktop = f"""[Desktop Entry]
Name={APP_NAME_DISPLAY}
Comment={DESCRIPTION}
Exec=/opt/{APP_NAME}/{APP_NAME}
Icon={APP_NAME}
Terminal=false
Type=Application
Categories=Utility;Security;
StartupNotify=true
"""
    (package_dir / "usr" / "share" / "applications" / f"{APP_NAME}.desktop").write_text(desktop)
    
    # Copy icon if exists
    if ICON_PATH.exists():
        shutil.copy(
            ICON_PATH,
            package_dir / "usr" / "share" / "icons" / "hicolor" / "256x256" / "apps" / f"{APP_NAME}.png"
        )
    
    # Build package
    output_deb = DIST_DIR / f"{deb_name}.deb"
    result = subprocess.run(
        ["dpkg-deb", "--build", "--root-owner-group", str(package_dir), str(output_deb)],
        capture_output=True,
        text=True
    )
    
    if result.returncode == 0:
        print(f"✓ .deb package created: {output_deb}")
        return True
    else:
        print(f"✗ .deb build failed: {result.stderr}")
        # Try with fakeroot
        result = subprocess.run(
            ["fakeroot", "dpkg-deb", "--build", str(package_dir), str(output_deb)],
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            print(f"✓ .deb package created: {output_deb}")
            return True
        print("  Install dpkg-deb: sudo apt install dpkg-deb")
        return False


def build_appimage():
    """Build an AppImage."""
    print("\nBuilding AppImage...")
    
    appdir = BUILD_DIR / f"{APP_NAME_DISPLAY}.AppDir"
    
    # Create AppDir structure
    (appdir / "usr" / "bin").mkdir(parents=True)
    (appdir / "usr" / "share" / "applications").mkdir(parents=True)
    (appdir / "usr" / "share" / "icons" / "hicolor" / "256x256" / "apps").mkdir(parents=True)
    
    # Copy application
    app_source = DIST_DIR / APP_NAME
    if app_source.exists():
        shutil.copytree(app_source, appdir / "usr" / "bin" / APP_NAME, dirs_exist_ok=True)
    
    # Create AppRun
    apprun = f"""#!/bin/bash
SELF=$(readlink -f "$0")
HERE=${{SELF%/*}}
export PATH="${{HERE}}/usr/bin/{APP_NAME}:${{PATH}}"
export LD_LIBRARY_PATH="${{HERE}}/usr/bin/{APP_NAME}:${{LD_LIBRARY_PATH}}"
exec "${{HERE}}/usr/bin/{APP_NAME}/{APP_NAME}" "$@"
"""
    apprun_path = appdir / "AppRun"
    apprun_path.write_text(apprun)
    apprun_path.chmod(0o755)
    
    # Create desktop file
    desktop = f"""[Desktop Entry]
Name={APP_NAME_DISPLAY}
Comment={DESCRIPTION}
Exec={APP_NAME}
Icon={APP_NAME}
Terminal=false
Type=Application
Categories=Utility;Security;
"""
    (appdir / f"{APP_NAME}.desktop").write_text(desktop)
    (appdir / "usr" / "share" / "applications" / f"{APP_NAME}.desktop").write_text(desktop)
    
    # Copy icon
    if ICON_PATH.exists():
        shutil.copy(ICON_PATH, appdir / f"{APP_NAME}.png")
        shutil.copy(
            ICON_PATH,
            appdir / "usr" / "share" / "icons" / "hicolor" / "256x256" / "apps" / f"{APP_NAME}.png"
        )
    else:
        # Create placeholder icon message
        print("  Warning: No icon.png found in assets/")
    
    # Try to find appimagetool
    appimagetool = shutil.which("appimagetool")
    if not appimagetool:
        appimagetool = shutil.which("appimagetool-x86_64.AppImage")
    
    if not appimagetool:
        print("✗ appimagetool not found.")
        print("  Download from: https://github.com/AppImage/AppImageKit/releases")
        print(f"  AppDir prepared at: {appdir}")
        print(f"  Run: appimagetool {appdir}")
        return False
    
    # Build AppImage
    output_appimage = DIST_DIR / f"{APP_NAME_DISPLAY}-{VERSION}-x86_64.AppImage"
    
    env = os.environ.copy()
    env["ARCH"] = "x86_64"
    
    result = subprocess.run(
        [appimagetool, str(appdir), str(output_appimage)],
        env=env,
        capture_output=True,
        text=True
    )
    
    if result.returncode == 0:
        print(f"✓ AppImage created: {output_appimage}")
        return True
    else:
        print(f"✗ AppImage build failed: {result.stderr}")
        return False


def main():
    """Main build process."""
    parser = argparse.ArgumentParser(description="Build FileGuard for Linux")
    parser.add_argument("--deb", action="store_true", help="Build .deb package only")
    parser.add_argument("--appimage", action="store_true", help="Build AppImage only")
    parser.add_argument("--skip-binary", action="store_true", help="Skip binary build")
    args = parser.parse_args()
    
    print("=" * 50)
    print(f"  {APP_NAME_DISPLAY} Build Script for Linux")
    print("=" * 50)
    
    # Check dependencies
    if not check_pyinstaller():
        return 1
    
    # Create assets
    create_assets()
    
    # Clean previous builds
    if not args.skip_binary:
        clean_build()
    
    # Build binary
    if not args.skip_binary:
        if not build_binary():
            return 1
    
    # Build packages
    build_deb_flag = not args.appimage or args.deb
    build_appimage_flag = not args.deb or args.appimage
    
    if build_deb_flag:
        build_deb()
    
    if build_appimage_flag:
        build_appimage()
    
    print("\n" + "=" * 50)
    print("  Build Complete!")
    print("=" * 50)
    print(f"\nBinary: {DIST_DIR / APP_NAME}")
    
    deb_file = DIST_DIR / f"{APP_NAME}_{VERSION}_amd64.deb"
    if deb_file.exists():
        print(f".deb:   {deb_file}")
        print(f"        Install: sudo dpkg -i {deb_file}")
    
    appimage = list(DIST_DIR.glob("*.AppImage"))
    if appimage:
        print(f"AppImage: {appimage[0]}")
        print(f"          chmod +x {appimage[0].name} && ./{appimage[0].name}")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
