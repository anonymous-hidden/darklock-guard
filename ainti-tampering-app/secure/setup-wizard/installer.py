"""
Installer Backend
Handles all installation operations, folder creation, and system setup.
Cross-platform support for Windows and Linux.
"""

import subprocess
import os
import sys
import platform
from pathlib import Path
from typing import Callable, Optional
from datetime import datetime


class InstallationError(Exception):
    """Custom exception for installation errors."""
    pass


class Installer:
    """Handles system setup and package installation."""
    
    def __init__(self, log_callback: Optional[Callable[[str], None]] = None):
        """
        Initialize installer.
        
        Args:
            log_callback: Function to call with log messages (for UI updates)
        """
        self.log_callback = log_callback or print
        self.errors = []
        self.platform = platform.system()  # 'Windows', 'Linux', 'Darwin'
        
    def log(self, message: str) -> None:
        """Send log message to callback."""
        self.log_callback(message)
    
    @staticmethod
    def is_admin() -> bool:
        """Check if script is running with administrator/root privileges."""
        try:
            if platform.system() == 'Windows':
                import ctypes
                return ctypes.windll.shell32.IsUserAnAdmin()
            else:
                # Linux/Unix - check if running as root
                return os.geteuid() == 0
        except:
            return False
    
    def create_dev_folders(self, base_path: Optional[str] = None) -> bool:
        """
        Create organized development folder structure.
        
        Args:
            base_path: Root path for dev folders (defaults based on platform)
            
        Returns:
            True if successful, False otherwise
        """
        # Use platform-appropriate default paths
        if base_path is None:
            if self.platform == 'Windows':
                base_path = "C:\\Dev"
            else:
                base_path = os.path.expanduser("~/dev")
        
        base_path = os.path.expanduser(base_path)  # Handle ~ on Unix systems
        folders = [
            base_path,
            os.path.join(base_path, "projects"),
            os.path.join(base_path, "bots"),
            os.path.join(base_path, "security"),
            os.path.join(base_path, "labs"),
            os.path.join(base_path, "scripts"),
            os.path.join(base_path, "notes")
        ]
        
        self.log("Creating development folder structure...")
        
        try:
            for folder in folders:
                Path(folder).mkdir(parents=True, exist_ok=True)
                self.log(f"  Created: {folder}")
            
            # Create README in Dev folder
            readme_path = os.path.join(base_path, "README.md")
            readme_content = f"""# Development Environment

Created by Secure Setup Wizard on {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}

## Folder Structure

- **projects/** - General development projects
- **bots/** - Discord bots and automation scripts
- **security/** - Cybersecurity tools and configurations
- **labs/** - Virtual machine configs and lab environments
- **scripts/** - Utility scripts and automation
- **notes/** - Documentation and learning notes

## Security Reminder

Always conduct security testing in isolated virtual machines.
Never test on systems you do not own or have explicit permission to test.
"""
            with open(readme_path, 'w', encoding='utf-8') as f:
                f.write(readme_content)
            
            self.log(f"  Created: {readme_path}")
            return True
            
        except Exception as e:
            self.log(f"  Error creating folders: {str(e)}")
            self.errors.append(f"Folder creation error: {str(e)}")
            return False
    
    def enable_wsl(self) -> bool:
        """
        Enable WSL2 and Virtual Machine Platform features (Windows only).
        Requires administrator privileges.
        """
        if self.platform != 'Windows':
            self.log("  WSL is Windows-only, skipping on this platform")
            return False
            
        if not self.is_admin():
            self.log("  Administrator privileges required for WSL setup")
            return False
        
        self.log("Enabling Windows Subsystem for Linux (WSL2)...")
        
        try:
            # Enable WSL feature
            result = subprocess.run(
                ["powershell", "-Command", 
                 "Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -NoRestart -All"],
                capture_output=True,
                text=True,
                timeout=120
            )
            
            if result.returncode == 0 or "already enabled" in result.stdout.lower():
                self.log("  WSL feature enabled")
            else:
                self.log(f"  WSL feature status: {result.stdout}")
            
            # Enable Virtual Machine Platform
            result = subprocess.run(
                ["powershell", "-Command",
                 "Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -NoRestart -All"],
                capture_output=True,
                text=True,
                timeout=120
            )
            
            if result.returncode == 0 or "already enabled" in result.stdout.lower():
                self.log("  Virtual Machine Platform enabled")
            else:
                self.log(f"  VM Platform status: {result.stdout}")
            
            # Set WSL 2 as default
            subprocess.run(["wsl", "--set-default-version", "2"], 
                          capture_output=True, timeout=30)
            
            return True
            
        except subprocess.TimeoutExpired:
            self.log("  WSL setup timed out")
            self.errors.append("WSL setup timeout")
            return False
        except Exception as e:
            self.log(f"  WSL setup error: {str(e)}")
            self.errors.append(f"WSL setup error: {str(e)}")
            return False
    
    def install_wsl_ubuntu(self) -> bool:
        """Install Ubuntu distribution for WSL (Windows only)."""
        if self.platform != 'Windows':
            self.log("  WSL is Windows-only, skipping on this platform")
            return False
            
        self.log("Installing Ubuntu for WSL...")
        
        try:
            result = subprocess.run(
                ["wsl", "--install", "-d", "Ubuntu", "--no-launch"],
                capture_output=True,
                text=True,
                timeout=300
            )
            
            if result.returncode == 0:
                self.log("  Ubuntu WSL distribution queued")
                return True
            else:
                self.log(f"  Ubuntu install status: {result.stdout}")
                return True  # May already be installed
                
        except subprocess.TimeoutExpired:
            self.log("  Ubuntu install timed out (may continue in background)")
            return True
        except Exception as e:
            self.log(f"  Ubuntu install note: {str(e)}")
            return True  # Don't fail entire installation
    
    def install_package(self, package_id: str, package_name: str) -> bool:
        """
        Install a single package using the appropriate package manager.
        
        Args:
            package_id: Package ID (winget on Windows, apt package name on Linux)
            package_name: Human-readable package name
            
        Returns:
            True if successful or already installed, False on error
        """
        self.log(f"Installing {package_name}...")
        
        try:
            if self.platform == 'Windows':
                # Use winget on Windows
                result = subprocess.run(
                    ["winget", "install", "--id", package_id, 
                     "--accept-source-agreements", "--accept-package-agreements", 
                     "--silent"],
                    capture_output=True,
                    text=True,
                    timeout=300
                )
                
                # Check various success conditions
                if result.returncode == 0:
                    self.log(f"  ✓ {package_name} installed successfully")
                    return True
                elif result.returncode == -1978335189 or "already installed" in result.stdout.lower():
                    self.log(f"  ✓ {package_name} (already installed)")
                    return True
                else:
                    self.log(f"  ! {package_name} - check may be needed")
                    return True
                    
            elif self.platform == 'Linux':
                # Use apt on Linux (Debian/Ubuntu)
                # First check if package exists
                check = subprocess.run(
                    ["dpkg", "-s", package_id],
                    capture_output=True,
                    text=True
                )
                
                if check.returncode == 0:
                    self.log(f"  ✓ {package_name} (already installed)")
                    return True
                
                # Try to install
                if self.is_admin():
                    result = subprocess.run(
                        ["apt-get", "install", "-y", package_id],
                        capture_output=True,
                        text=True,
                        timeout=300
                    )
                else:
                    result = subprocess.run(
                        ["sudo", "apt-get", "install", "-y", package_id],
                        capture_output=True,
                        text=True,
                        timeout=300
                    )
                
                if result.returncode == 0:
                    self.log(f"  ✓ {package_name} installed successfully")
                    return True
                else:
                    self.log(f"  ✗ {package_name} failed to install")
                    return False
            else:
                self.log(f"  ✗ Unsupported platform: {self.platform}")
                return False
                
        except subprocess.TimeoutExpired:
            self.log(f"  ✗ {package_name} installation timed out")
            self.errors.append(f"{package_name}: timeout")
            return False
        except FileNotFoundError as e:
            pkg_mgr = "winget" if self.platform == 'Windows' else "apt-get"
            self.log(f"  ✗ {pkg_mgr} not found - cannot install {package_name}")
            self.errors.append(f"{pkg_mgr} not available")
            return False
        except Exception as e:
            self.log(f"  ✗ {package_name} error: {str(e)}")
            self.errors.append(f"{package_name}: {str(e)}")
            return False
    
    def install_packages(self, packages: list) -> tuple[int, int]:
        """
        Install multiple packages.
        
        Args:
            packages: List of dicts with 'id' and 'name' keys
            
        Returns:
            Tuple of (successful_count, failed_count)
        """
        successful = 0
        failed = 0
        
        for package in packages:
            if self.install_package(package["id"], package["name"]):
                successful += 1
            else:
                failed += 1
        
        return successful, failed
    
    def run_full_installation(self, config) -> bool:
        """
        Run complete installation based on configuration.
        
        Args:
            config: Config object with user selections
            
        Returns:
            True if installation completed (with or without errors)
        """
        self.log("=" * 70)
        self.log("Starting Secure Setup Wizard Installation")
        self.log("=" * 70)
        self.log("")
        
        # Create dev folders if requested
        if config.get("create_dev_folders"):
            self.log("[STEP 1/4] Creating folder structure")
            self.create_dev_folders(config.get("dev_folder_path"))
            self.log("")
        
        # Enable WSL if virtualization selected
        if config.get("install_virtualization"):
            self.log("[STEP 2/4] Setting up virtualization")
            if self.is_admin():
                self.enable_wsl()
                self.install_wsl_ubuntu()
            else:
                self.log("  Skipping WSL setup (administrator privileges required)")
            self.log("")
        
        # Install selected packages
        self.log("[STEP 3/4] Installing software packages")
        packages = config.get_all_packages()
        
        if packages:
            total = len(packages)
            self.log(f"  Total packages to install: {total}")
            self.log("")
            
            successful, failed = self.install_packages(packages)
            
            self.log("")
            self.log(f"Installation results: {successful} successful, {failed} failed")
            
            # Update config with installed packages
            config.set("installed_packages", [p["name"] for p in packages])
        else:
            self.log("  No packages selected for installation")
        
        self.log("")
        self.log("[STEP 4/4] Finalizing setup")
        config.set("installation_date", datetime.now().isoformat())
        config.save()
        self.log("  Configuration saved")
        
        self.log("")
        self.log("=" * 70)
        self.log("Installation Complete")
        self.log("=" * 70)
        
        if self.errors:
            self.log("")
            self.log("Notes:")
            for error in self.errors:
                self.log(f"  - {error}")
        
        return True
