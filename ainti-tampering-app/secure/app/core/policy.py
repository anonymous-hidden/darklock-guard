"""
Protection Policy Engine for FileGuard
======================================
Defines and enforces protection policies for files and folders.
Each protected item has a policy that determines:
- What actions to take on tampering
- What changes to monitor
- How to respond to violations

Design Philosophy:
- Policies are explicit and predictable
- User always knows what will happen
- No hidden behaviors or surprises
"""

from enum import Enum, auto
from dataclasses import dataclass, field
from typing import Optional, List, Set, Callable
from pathlib import Path
import fnmatch


class ProtectionMode(Enum):
    """
    Primary protection modes that determine response to tampering.
    
    These map directly to user-visible options in the UI.
    """
    DETECT_ONLY = 'detect_only'       # Log changes, take no action
    DETECT_ALERT = 'detect_alert'     # Log changes, show notification
    DETECT_RESTORE = 'detect_restore' # Log changes, auto-restore from backup
    SEALED = 'sealed'                 # Prevent ALL modifications
    
    @property
    def description(self) -> str:
        """Human-readable description of this mode."""
        descriptions = {
            self.DETECT_ONLY: "Monitor only - changes are logged but no action taken",
            self.DETECT_ALERT: "Alert on change - shows notification when file is modified",
            self.DETECT_RESTORE: "Auto-restore - automatically restores file from backup",
            self.SEALED: "Sealed - file is locked and cannot be modified",
        }
        return descriptions.get(self, "Unknown mode")
    
    @property
    def icon(self) -> str:
        """Icon identifier for UI display."""
        icons = {
            self.DETECT_ONLY: "eye",
            self.DETECT_ALERT: "bell",
            self.DETECT_RESTORE: "shield-check",
            self.SEALED: "lock",
        }
        return icons.get(self, "file")


class ChangeType(Enum):
    """
    Types of changes that can be detected.
    """
    CONTENT_MODIFIED = auto()   # File contents changed
    PERMISSIONS_CHANGED = auto() # File permissions changed
    RENAMED = auto()            # File was renamed
    DELETED = auto()            # File was deleted
    CREATED = auto()            # New file created (in protected folder)
    MOVED = auto()              # File moved to different location


class ResponseAction(Enum):
    """
    Actions that can be taken in response to changes.
    """
    LOG_ONLY = auto()           # Just record the event
    NOTIFY = auto()             # Show desktop notification
    RESTORE_CONTENT = auto()    # Restore file from backup
    RESTORE_PERMISSIONS = auto() # Restore original permissions
    BLOCK = auto()              # Prevent the change (seal mode)
    QUARANTINE = auto()         # Move changed file to quarantine


@dataclass
class PolicyRule:
    """
    A single rule within a protection policy.
    
    Maps a change type to a response action with optional conditions.
    """
    change_type: ChangeType
    action: ResponseAction
    enabled: bool = True
    
    # Optional conditions
    min_size_change: int = 0    # Only trigger if size changes by at least this much
    notify_cooldown: int = 60   # Seconds between notifications for same file


@dataclass
class ProtectionPolicy:
    """
    Complete protection policy for a file or folder.
    
    Contains all rules and settings that determine how the item
    is monitored and what happens when changes are detected.
    """
    mode: ProtectionMode
    rules: List[PolicyRule] = field(default_factory=list)
    
    # Monitoring settings
    watch_content: bool = True
    watch_permissions: bool = True
    watch_renames: bool = True
    watch_deletions: bool = True
    
    # Backup settings
    keep_backup: bool = True
    max_backup_versions: int = 3
    
    # Notification settings
    notify_on_restore: bool = True
    silent_mode: bool = False
    
    # Seal mode settings (only applies when mode is SEALED)
    require_unlock_confirmation: bool = True
    auto_relock_minutes: int = 5  # Re-lock after this many minutes
    
    # Exclusion patterns (for folders)
    excluded_patterns: List[str] = field(default_factory=list)
    
    def __post_init__(self):
        """Set up default rules based on protection mode."""
        if not self.rules:
            self.rules = self._default_rules_for_mode(self.mode)
    
    def _default_rules_for_mode(self, mode: ProtectionMode) -> List[PolicyRule]:
        """
        Generate default rules based on protection mode.
        
        These provide sensible defaults that users can customize.
        """
        if mode == ProtectionMode.DETECT_ONLY:
            return [
                PolicyRule(ChangeType.CONTENT_MODIFIED, ResponseAction.LOG_ONLY),
                PolicyRule(ChangeType.PERMISSIONS_CHANGED, ResponseAction.LOG_ONLY),
                PolicyRule(ChangeType.DELETED, ResponseAction.LOG_ONLY),
                PolicyRule(ChangeType.RENAMED, ResponseAction.LOG_ONLY),
            ]
        
        elif mode == ProtectionMode.DETECT_ALERT:
            return [
                PolicyRule(ChangeType.CONTENT_MODIFIED, ResponseAction.NOTIFY),
                PolicyRule(ChangeType.PERMISSIONS_CHANGED, ResponseAction.NOTIFY),
                PolicyRule(ChangeType.DELETED, ResponseAction.NOTIFY),
                PolicyRule(ChangeType.RENAMED, ResponseAction.NOTIFY),
            ]
        
        elif mode == ProtectionMode.DETECT_RESTORE:
            return [
                PolicyRule(ChangeType.CONTENT_MODIFIED, ResponseAction.RESTORE_CONTENT),
                PolicyRule(ChangeType.PERMISSIONS_CHANGED, ResponseAction.RESTORE_PERMISSIONS),
                PolicyRule(ChangeType.DELETED, ResponseAction.RESTORE_CONTENT),
                PolicyRule(ChangeType.RENAMED, ResponseAction.LOG_ONLY),  # Can't auto-restore rename
            ]
        
        elif mode == ProtectionMode.SEALED:
            return [
                PolicyRule(ChangeType.CONTENT_MODIFIED, ResponseAction.BLOCK),
                PolicyRule(ChangeType.PERMISSIONS_CHANGED, ResponseAction.BLOCK),
                PolicyRule(ChangeType.DELETED, ResponseAction.BLOCK),
                PolicyRule(ChangeType.RENAMED, ResponseAction.BLOCK),
            ]
        
        return []
    
    def get_action_for_change(self, change_type: ChangeType) -> Optional[ResponseAction]:
        """
        Determine what action to take for a given change type.
        
        Args:
            change_type: The type of change detected
            
        Returns:
            The response action, or None if no rule matches
        """
        for rule in self.rules:
            if rule.change_type == change_type and rule.enabled:
                return rule.action
        return None
    
    def should_monitor(self, change_type: ChangeType) -> bool:
        """Check if a change type should be monitored."""
        monitoring_map = {
            ChangeType.CONTENT_MODIFIED: self.watch_content,
            ChangeType.PERMISSIONS_CHANGED: self.watch_permissions,
            ChangeType.RENAMED: self.watch_renames,
            ChangeType.DELETED: self.watch_deletions,
            ChangeType.CREATED: True,  # Always watch for new files in folders
            ChangeType.MOVED: self.watch_renames,
        }
        return monitoring_map.get(change_type, True)
    
    def is_path_excluded(self, path: str) -> bool:
        """
        Check if a path matches any exclusion pattern.
        
        Used for folder protection to skip certain files.
        
        Args:
            path: Relative path within the protected folder
            
        Returns:
            True if the path should be excluded from protection
        """
        for pattern in self.excluded_patterns:
            if fnmatch.fnmatch(path, pattern):
                return True
        return False
    
    def to_dict(self) -> dict:
        """Serialize policy to dictionary for storage."""
        return {
            'mode': self.mode.value,
            'rules': [
                {
                    'change_type': rule.change_type.name,
                    'action': rule.action.name,
                    'enabled': rule.enabled,
                    'min_size_change': rule.min_size_change,
                    'notify_cooldown': rule.notify_cooldown,
                }
                for rule in self.rules
            ],
            'watch_content': self.watch_content,
            'watch_permissions': self.watch_permissions,
            'watch_renames': self.watch_renames,
            'watch_deletions': self.watch_deletions,
            'keep_backup': self.keep_backup,
            'max_backup_versions': self.max_backup_versions,
            'notify_on_restore': self.notify_on_restore,
            'silent_mode': self.silent_mode,
            'require_unlock_confirmation': self.require_unlock_confirmation,
            'auto_relock_minutes': self.auto_relock_minutes,
            'excluded_patterns': self.excluded_patterns,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'ProtectionPolicy':
        """Deserialize policy from dictionary."""
        rules = [
            PolicyRule(
                change_type=ChangeType[r['change_type']],
                action=ResponseAction[r['action']],
                enabled=r.get('enabled', True),
                min_size_change=r.get('min_size_change', 0),
                notify_cooldown=r.get('notify_cooldown', 60),
            )
            for r in data.get('rules', [])
        ]
        
        return cls(
            mode=ProtectionMode(data['mode']),
            rules=rules,
            watch_content=data.get('watch_content', True),
            watch_permissions=data.get('watch_permissions', True),
            watch_renames=data.get('watch_renames', True),
            watch_deletions=data.get('watch_deletions', True),
            keep_backup=data.get('keep_backup', True),
            max_backup_versions=data.get('max_backup_versions', 3),
            notify_on_restore=data.get('notify_on_restore', True),
            silent_mode=data.get('silent_mode', False),
            require_unlock_confirmation=data.get('require_unlock_confirmation', True),
            auto_relock_minutes=data.get('auto_relock_minutes', 5),
            excluded_patterns=data.get('excluded_patterns', []),
        )
    
    @classmethod
    def default_for_mode(cls, mode: ProtectionMode) -> 'ProtectionPolicy':
        """Create a default policy for the given mode."""
        return cls(mode=mode)


class PolicyEngine:
    """
    Evaluates policies and determines responses to file events.
    
    This is the decision-making core that takes a detected change
    and determines what action should be taken.
    """
    
    def __init__(self):
        """Initialize the policy engine."""
        # Callbacks for different response actions
        self._action_handlers: dict[ResponseAction, Callable] = {}
    
    def register_handler(self, action: ResponseAction, handler: Callable) -> None:
        """
        Register a handler function for a response action.
        
        Args:
            action: The action type to handle
            handler: Function to call when this action is triggered
        """
        self._action_handlers[action] = handler
    
    def evaluate_change(
        self,
        policy: ProtectionPolicy,
        change_type: ChangeType,
        file_path: Path,
        details: Optional[dict] = None
    ) -> Optional[ResponseAction]:
        """
        Evaluate a change against a policy and determine response.
        
        Args:
            policy: The protection policy for this item
            change_type: Type of change detected
            file_path: Path to the affected file
            details: Optional additional details about the change
            
        Returns:
            The action to take, or None if change should be ignored
        """
        # Check if this change type is monitored
        if not policy.should_monitor(change_type):
            return None
        
        # Check if path is excluded (for folder policies)
        if policy.is_path_excluded(str(file_path)):
            return None
        
        # Get the action for this change type
        action = policy.get_action_for_change(change_type)
        
        # If silent mode is enabled, downgrade NOTIFY to LOG_ONLY
        if action == ResponseAction.NOTIFY and policy.silent_mode:
            action = ResponseAction.LOG_ONLY
        
        return action
    
    def execute_action(
        self,
        action: ResponseAction,
        file_path: Path,
        policy: ProtectionPolicy,
        details: Optional[dict] = None
    ) -> bool:
        """
        Execute a response action.
        
        Args:
            action: Action to execute
            file_path: Affected file path
            policy: Policy that triggered this action
            details: Additional context
            
        Returns:
            True if action executed successfully
        """
        handler = self._action_handlers.get(action)
        
        if handler is None:
            # No handler registered for this action
            return False
        
        try:
            handler(file_path, policy, details or {})
            return True
        except Exception as e:
            print(f"Action handler failed for {action}: {e}")
            return False
    
    @staticmethod
    def describe_action(action: ResponseAction) -> str:
        """Get human-readable description of an action."""
        descriptions = {
            ResponseAction.LOG_ONLY: "Change was logged",
            ResponseAction.NOTIFY: "Desktop notification sent",
            ResponseAction.RESTORE_CONTENT: "File content restored from backup",
            ResponseAction.RESTORE_PERMISSIONS: "File permissions restored",
            ResponseAction.BLOCK: "Change was blocked",
            ResponseAction.QUARANTINE: "Changed file was quarantined",
        }
        return descriptions.get(action, "Unknown action")
    
    @staticmethod
    def describe_change(change_type: ChangeType) -> str:
        """Get human-readable description of a change type."""
        descriptions = {
            ChangeType.CONTENT_MODIFIED: "File content was modified",
            ChangeType.PERMISSIONS_CHANGED: "File permissions were changed",
            ChangeType.RENAMED: "File was renamed",
            ChangeType.DELETED: "File was deleted",
            ChangeType.CREATED: "New file was created",
            ChangeType.MOVED: "File was moved",
        }
        return descriptions.get(change_type, "Unknown change")


# Default exclusion patterns for common files that shouldn't be protected
DEFAULT_EXCLUSIONS = [
    # Temporary files
    "*.tmp",
    "*.temp",
    "~*",
    "*.swp",
    "*.swo",
    
    # System files
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
    
    # Backup files
    "*.bak",
    "*.backup",
    "*.orig",
    
    # Lock files
    "*.lock",
    ".~lock.*",
    
    # Log files (usually not worth protecting)
    "*.log",
]


def create_standard_policy(
    mode: ProtectionMode,
    is_folder: bool = False,
    include_exclusions: bool = True
) -> ProtectionPolicy:
    """
    Create a standard policy with sensible defaults.
    
    Args:
        mode: Protection mode to use
        is_folder: Whether this is for folder protection
        include_exclusions: Whether to include default exclusion patterns
        
    Returns:
        Configured ProtectionPolicy
    """
    policy = ProtectionPolicy.default_for_mode(mode)
    
    if is_folder and include_exclusions:
        policy.excluded_patterns = DEFAULT_EXCLUSIONS.copy()
    
    return policy
