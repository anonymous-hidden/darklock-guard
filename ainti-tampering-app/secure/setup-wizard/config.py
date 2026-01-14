"""
Configuration Manager
Handles loading, saving, and managing user preferences.
"""

import json
import os
from pathlib import Path
from typing import Dict, Any


class Config:
    """Manages application configuration and user preferences."""
    
    def __init__(self, config_file: str = "config.json"):
        self.config_file = Path(config_file)
        self.data: Dict[str, Any] = self._load_default_config()
        
    def _load_default_config(self) -> Dict[str, Any]:
        """Returns default configuration."""
        return {
            "privacy_accepted": False,
            "install_developer_tools": True,
            "install_security_tools": True,
            "install_virtualization": True,
            "create_dev_folders": True,
            "create_shortcuts": False,
            "dev_folder_path": "C:\\Dev",
            "installation_date": None,
            "installed_packages": []
        }
    
    def load(self) -> bool:
        """Load configuration from file if it exists."""
        if not self.config_file.exists():
            return False
        
        try:
            with open(self.config_file, 'r', encoding='utf-8') as f:
                loaded_data = json.load(f)
                self.data.update(loaded_data)
            return True
        except (json.JSONDecodeError, IOError) as e:
            print(f"Error loading config: {e}")
            return False
    
    def save(self) -> bool:
        """Save current configuration to file."""
        try:
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(self.data, f, indent=4)
            return True
        except IOError as e:
            print(f"Error saving config: {e}")
            return False
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get configuration value."""
        return self.data.get(key, default)
    
    def set(self, key: str, value: Any) -> None:
        """Set configuration value."""
        self.data[key] = value
    
    def get_selected_packages(self) -> Dict[str, list]:
        """Returns lists of packages to install based on user selections."""
        packages = {
            "developer": [],
            "security": [],
            "virtualization": []
        }
        
        if self.get("install_developer_tools"):
            packages["developer"] = [
                {"id": "Git.Git", "name": "Git"},
                {"id": "Microsoft.VisualStudioCode", "name": "Visual Studio Code"},
                {"id": "Python.Python.3.12", "name": "Python 3.12"},
                {"id": "OpenJS.NodeJS.LTS", "name": "Node.js LTS"},
                {"id": "Docker.DockerDesktop", "name": "Docker Desktop"}
            ]
        
        if self.get("install_security_tools"):
            packages["security"] = [
                {"id": "WiresharkFoundation.Wireshark", "name": "Wireshark"},
                {"id": "Insecure.Nmap", "name": "Nmap"},
                {"id": "Microsoft.Sysinternals.Suite", "name": "Sysinternals Suite"},
                {"id": "Postman.Postman", "name": "Postman"},
                {"id": "DBBrowserForSQLite.DBBrowserForSQLite", "name": "DB Browser for SQLite"}
            ]
        
        if self.get("install_virtualization"):
            packages["virtualization"] = [
                {"id": "Oracle.VirtualBox", "name": "VirtualBox"}
            ]
        
        return packages
    
    def get_all_packages(self) -> list:
        """Returns flat list of all selected packages."""
        packages = self.get_selected_packages()
        all_packages = []
        for category in packages.values():
            all_packages.extend(category)
        return all_packages


def load_privacy_policy() -> str:
    """Load privacy policy text from file."""
    policy_file = Path(__file__).parent / "privacy_policy.txt"
    
    if policy_file.exists():
        try:
            with open(policy_file, 'r', encoding='utf-8') as f:
                return f.read()
        except IOError:
            pass
    
    # Fallback if file doesn't exist
    return """PRIVACY POLICY

This application does not collect, transmit, or sell personal data.

All installations occur locally using official package sources (winget).

No telemetry, tracking, or analytics are used.

Your installation preferences are saved locally on your device only.

We respect your privacy and believe in transparency."""
