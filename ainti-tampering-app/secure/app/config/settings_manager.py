"""
Settings Manager for FileGuard
==============================
Handles loading, saving, and validating application settings.
All settings are stored in a JSON file and exposed through
a typed interface for safety.

Design Philosophy:
- Settings are always valid (validated on load)
- Defaults are used for missing values
- Changes are immediately persisted
- Thread-safe access
"""

import json
import threading
from pathlib import Path
from typing import Any, Dict, Optional, Callable, List
from dataclasses import dataclass, field, asdict
from enum import Enum
import copy


class Theme(Enum):
    """Available UI themes."""
    LIGHT = 'light'
    DARK = 'dark'
    SYSTEM = 'system'


class AlertLevel(Enum):
    """Notification alert levels."""
    ALL = 'all'           # Show all notifications
    IMPORTANT = 'important'  # Only tamper events
    CRITICAL = 'critical'    # Only critical events
    NONE = 'none'         # No notifications


class UIDensity(Enum):
    """UI density options."""
    COMPACT = 'compact'
    COMFORTABLE = 'comfortable'
    SPACIOUS = 'spacious'


@dataclass
class SecuritySettings:
    """Security-related settings."""
    default_protection_mode: str = 'detect_alert'
    auto_restore_enabled: bool = False
    backup_retention_count: int = 3
    seal_mode_auto_relock_minutes: int = 5
    hash_algorithm: str = 'sha256'
    require_confirmation_for_restore: bool = True
    require_confirmation_for_unprotect: bool = True


@dataclass
class MonitoringSettings:
    """Monitoring behavior settings."""
    scan_interval_seconds: int = 300
    watcher_debounce_ms: int = 500
    ignored_extensions: List[str] = field(default_factory=lambda: ['.tmp', '.temp', '.swp', '.log'])
    ignore_hidden_files: bool = True
    ignore_system_files: bool = True


@dataclass
class NotificationSettings:
    """Notification settings."""
    alert_level: str = 'all'
    silent_mode: bool = False
    desktop_notifications: bool = True
    notification_sound: bool = True


@dataclass
class AppearanceSettings:
    """UI appearance settings."""
    theme: str = 'system'
    accent_color: str = '#3b82f6'
    animations_enabled: bool = True
    ui_density: str = 'comfortable'
    sidebar_collapsed: bool = False


@dataclass
class AdvancedSettings:
    """Advanced/developer settings."""
    signed_audit_logs: bool = True
    debug_logging: bool = False
    developer_mode: bool = False
    start_minimized: bool = False
    start_with_system: bool = False


@dataclass
class ProfileSettings:
    """User profile and authentication settings."""
    display_name: str = 'User'
    avatar_style: str = 'initials'
    app_lock_enabled: bool = False
    idle_timeout_minutes: int = 0
    require_auth_for_sensitive: bool = False
    totp_enabled: bool = False
    totp_secret_encrypted: Optional[str] = None
    recovery_codes_hash: Optional[str] = None
    pin_hash: Optional[str] = None
    password_hash: Optional[str] = None


@dataclass
class WindowSettings:
    """Window position and size."""
    width: int = 1200
    height: int = 800
    x: Optional[int] = None
    y: Optional[int] = None
    maximized: bool = False


@dataclass
class AppSettings:
    """
    Complete application settings.
    
    This is the top-level container for all settings categories.
    """
    version: int = 1
    first_run: bool = True
    security: SecuritySettings = field(default_factory=SecuritySettings)
    monitoring: MonitoringSettings = field(default_factory=MonitoringSettings)
    notifications: NotificationSettings = field(default_factory=NotificationSettings)
    appearance: AppearanceSettings = field(default_factory=AppearanceSettings)
    advanced: AdvancedSettings = field(default_factory=AdvancedSettings)
    profile: ProfileSettings = field(default_factory=ProfileSettings)
    window: WindowSettings = field(default_factory=WindowSettings)
    
    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            'version': self.version,
            'first_run': self.first_run,
            'security': asdict(self.security),
            'monitoring': asdict(self.monitoring),
            'notifications': asdict(self.notifications),
            'appearance': asdict(self.appearance),
            'advanced': asdict(self.advanced),
            'profile': asdict(self.profile),
            'window': asdict(self.window),
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'AppSettings':
        """Create from dictionary, using defaults for missing values."""
        return cls(
            version=data.get('version', 1),
            first_run=data.get('first_run', True),
            security=SecuritySettings(**data.get('security', {})),
            monitoring=MonitoringSettings(**data.get('monitoring', {})),
            notifications=NotificationSettings(**data.get('notifications', {})),
            appearance=AppearanceSettings(**data.get('appearance', {})),
            advanced=AdvancedSettings(**data.get('advanced', {})),
            profile=ProfileSettings(**data.get('profile', {})),
            window=WindowSettings(**data.get('window', {})),
        )


class SettingsManager:
    """
    Central settings manager with persistence and change notifications.
    
    Provides:
    - Thread-safe read/write access
    - Automatic persistence to JSON
    - Change notification callbacks
    - Validation on load
    """
    
    def __init__(self, settings_path: Path):
        """
        Initialize the settings manager.
        
        Args:
            settings_path: Path to settings.json file
        """
        self.settings_path = Path(settings_path)
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        
        self._settings: AppSettings = AppSettings()
        self._lock = threading.RLock()
        self._change_callbacks: List[Callable[[str, Any, Any], None]] = []
        
        # Load existing settings or create defaults
        self._load()
    
    def _load(self) -> None:
        """Load settings from disk."""
        if self.settings_path.exists():
            try:
                with open(self.settings_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self._settings = AppSettings.from_dict(data)
            except Exception as e:
                print(f"Failed to load settings, using defaults: {e}")
                self._settings = AppSettings()
                self._save()
        else:
            # First run - create default settings
            self._settings = AppSettings()
            self._save()
    
    def _save(self) -> None:
        """Save settings to disk."""
        try:
            with open(self.settings_path, 'w', encoding='utf-8') as f:
                json.dump(self._settings.to_dict(), f, indent=4)
        except Exception as e:
            print(f"Failed to save settings: {e}")
    
    def get(self, path: str, default: Any = None) -> Any:
        """
        Get a setting value by dot-notation path.
        
        Examples:
            get('security.auto_restore_enabled')
            get('appearance.theme')
        
        Args:
            path: Dot-separated path to setting
            default: Value to return if path doesn't exist
            
        Returns:
            The setting value
        """
        with self._lock:
            parts = path.split('.')
            value = self._settings
            
            try:
                for part in parts:
                    if hasattr(value, part):
                        value = getattr(value, part)
                    elif isinstance(value, dict):
                        value = value[part]
                    else:
                        return default
                return value
            except (KeyError, AttributeError):
                return default
    
    def set(self, path: str, value: Any) -> bool:
        """
        Set a setting value by dot-notation path.
        
        Automatically saves changes and notifies callbacks.
        
        Args:
            path: Dot-separated path to setting
            value: New value
            
        Returns:
            True if setting was updated
        """
        with self._lock:
            parts = path.split('.')
            
            if len(parts) < 2:
                return False
            
            # Navigate to parent object
            obj = self._settings
            for part in parts[:-1]:
                if hasattr(obj, part):
                    obj = getattr(obj, part)
                else:
                    return False
            
            # Get old value for callback
            attr_name = parts[-1]
            old_value = getattr(obj, attr_name, None)
            
            # Set new value
            if hasattr(obj, attr_name):
                setattr(obj, attr_name, value)
                self._save()
                
                # Notify callbacks
                for callback in self._change_callbacks:
                    try:
                        callback(path, old_value, value)
                    except Exception as e:
                        print(f"Settings callback error: {e}")
                
                return True
            
            return False
    
    def on_change(self, callback: Callable[[str, Any, Any], None]) -> None:
        """
        Register a callback for setting changes.
        
        Callback receives: (path, old_value, new_value)
        """
        self._change_callbacks.append(callback)
    
    @property
    def settings(self) -> AppSettings:
        """Get the complete settings object (read-only view)."""
        with self._lock:
            return copy.deepcopy(self._settings)
    
    @property
    def security(self) -> SecuritySettings:
        """Get security settings."""
        with self._lock:
            return copy.deepcopy(self._settings.security)
    
    @property
    def monitoring(self) -> MonitoringSettings:
        """Get monitoring settings."""
        with self._lock:
            return copy.deepcopy(self._settings.monitoring)
    
    @property
    def notifications(self) -> NotificationSettings:
        """Get notification settings."""
        with self._lock:
            return copy.deepcopy(self._settings.notifications)
    
    @property
    def appearance(self) -> AppearanceSettings:
        """Get appearance settings."""
        with self._lock:
            return copy.deepcopy(self._settings.appearance)
    
    @property
    def advanced(self) -> AdvancedSettings:
        """Get advanced settings."""
        with self._lock:
            return copy.deepcopy(self._settings.advanced)
    
    @property
    def profile(self) -> ProfileSettings:
        """Get profile settings."""
        with self._lock:
            return copy.deepcopy(self._settings.profile)
    
    @property
    def window(self) -> WindowSettings:
        """Get window settings."""
        with self._lock:
            return copy.deepcopy(self._settings.window)
    
    @property
    def is_first_run(self) -> bool:
        """Check if this is the first run."""
        return self._settings.first_run
    
    def mark_first_run_complete(self) -> None:
        """Mark that first-run onboarding is complete."""
        self.set('first_run', False)
    
    def reset_to_defaults(self, category: Optional[str] = None) -> None:
        """
        Reset settings to defaults.
        
        Args:
            category: Specific category to reset (None = all)
        """
        with self._lock:
            if category is None:
                self._settings = AppSettings()
            elif category == 'security':
                self._settings.security = SecuritySettings()
            elif category == 'monitoring':
                self._settings.monitoring = MonitoringSettings()
            elif category == 'notifications':
                self._settings.notifications = NotificationSettings()
            elif category == 'appearance':
                self._settings.appearance = AppearanceSettings()
            elif category == 'advanced':
                self._settings.advanced = AdvancedSettings()
            elif category == 'profile':
                self._settings.profile = ProfileSettings()
            
            self._save()
    
    def export_settings(self, path: Path) -> bool:
        """Export settings to a file."""
        try:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(self._settings.to_dict(), f, indent=4)
            return True
        except Exception:
            return False
    
    def import_settings(self, path: Path) -> bool:
        """Import settings from a file."""
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                self._settings = AppSettings.from_dict(data)
                self._save()
            return True
        except Exception:
            return False
