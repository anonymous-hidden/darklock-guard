"""
Settings View for FileGuard
===========================
Complete settings interface organized by category.
All configuration options in one place.

Design Philosophy:
- Logical grouping of settings
- Clear explanations for each option
- Immediate feedback on changes
"""

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QFrame, QScrollArea, QComboBox, QCheckBox, QSpinBox,
    QLineEdit, QColorDialog, QFormLayout, QGroupBox,
    QTabWidget, QSlider
)
from PySide6.QtCore import Qt
from PySide6.QtGui import QFont, QColor

from config.settings_manager import SettingsManager
from service import ProtectionService
from ui.theme import ThemeManager


class SettingsSection(QGroupBox):
    """
    A collapsible section of settings.
    """
    
    def __init__(self, title: str, parent=None):
        super().__init__(title, parent)
        self.setFont(QFont("Segoe UI", 11, QFont.Weight.DemiBold))
        
        self._layout = QFormLayout()
        self._layout.setSpacing(16)
        self._layout.setContentsMargins(16, 16, 16, 16)
        self.setLayout(self._layout)
    
    def add_row(self, label: str, widget: QWidget, description: str = ""):
        """Add a setting row with optional description."""
        container = QVBoxLayout()
        container.setSpacing(4)
        container.addWidget(widget)
        
        if description:
            desc_label = QLabel(description)
            desc_label.setProperty("class", "muted")
            desc_label.setFont(QFont("Segoe UI", 9))
            desc_label.setWordWrap(True)
            container.addWidget(desc_label)
        
        self._layout.addRow(label, container)


class SettingsView(QWidget):
    """
    Settings view with all configuration options.
    """
    
    def __init__(
        self,
        service: ProtectionService,
        settings: SettingsManager,
        theme: ThemeManager,
        parent=None
    ):
        super().__init__(parent)
        
        self.service = service
        self.settings = settings
        self.theme = theme
        
        self._setup_ui()
        self._load_settings()
    
    def _setup_ui(self):
        """Set up the settings UI."""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(32, 32, 32, 32)
        layout.setSpacing(24)
        
        # Header
        header = QHBoxLayout()
        
        title = QLabel("Settings")
        title.setProperty("class", "title")
        title.setFont(QFont("Segoe UI", 24, QFont.Weight.Bold))
        header.addWidget(title)
        
        header.addStretch()
        
        # Reset button
        reset_btn = QPushButton("Reset to Defaults")
        reset_btn.clicked.connect(self._on_reset)
        header.addWidget(reset_btn)
        
        layout.addLayout(header)
        
        # Tab widget for categories
        tabs = QTabWidget()
        tabs.setDocumentMode(True)
        
        # Security tab
        tabs.addTab(self._create_security_tab(), "🔒 Security")
        
        # Monitoring tab
        tabs.addTab(self._create_monitoring_tab(), "👁️ Monitoring")
        
        # Notifications tab
        tabs.addTab(self._create_notifications_tab(), "🔔 Notifications")
        
        # Appearance tab
        tabs.addTab(self._create_appearance_tab(), "🎨 Appearance")
        
        # Advanced tab
        tabs.addTab(self._create_advanced_tab(), "⚙️ Advanced")
        
        layout.addWidget(tabs, 1)
    
    def _create_security_tab(self) -> QWidget:
        """Create the security settings tab."""
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        
        content = QWidget()
        layout = QVBoxLayout(content)
        layout.setContentsMargins(0, 16, 16, 16)
        layout.setSpacing(16)
        
        # Default protection mode
        section = SettingsSection("Protection Defaults")
        
        self.default_mode = QComboBox()
        self.default_mode.addItem("Monitor Only", "detect_only")
        self.default_mode.addItem("Alert on Change", "detect_alert")
        self.default_mode.addItem("Auto-Restore", "detect_restore")
        self.default_mode.addItem("Sealed (Read-Only)", "sealed")
        self.default_mode.currentIndexChanged.connect(
            lambda: self._save('security.default_protection_mode', 
                             self.default_mode.currentData())
        )
        section.add_row("Default Mode:", self.default_mode,
                       "Applied when adding new files to protection")
        
        self.auto_restore = QCheckBox("Enable auto-restore")
        self.auto_restore.toggled.connect(
            lambda v: self._save('security.auto_restore_enabled', v)
        )
        section.add_row("Auto-Restore:", self.auto_restore,
                       "Automatically restore tampered files from backup")
        
        self.backup_count = QSpinBox()
        self.backup_count.setRange(1, 10)
        self.backup_count.valueChanged.connect(
            lambda v: self._save('security.backup_retention_count', v)
        )
        section.add_row("Backup Versions:", self.backup_count,
                       "Number of backup versions to keep per file")
        
        layout.addWidget(section)
        
        # Confirmations
        section2 = SettingsSection("Confirmations")
        
        self.confirm_restore = QCheckBox("Require confirmation before restoring")
        self.confirm_restore.toggled.connect(
            lambda v: self._save('security.require_confirmation_for_restore', v)
        )
        section2.add_row("Before Restore:", self.confirm_restore)
        
        self.confirm_unprotect = QCheckBox("Require confirmation before removing protection")
        self.confirm_unprotect.toggled.connect(
            lambda v: self._save('security.require_confirmation_for_unprotect', v)
        )
        section2.add_row("Before Unprotect:", self.confirm_unprotect)
        
        layout.addWidget(section2)
        
        # Seal mode
        section3 = SettingsSection("Seal Mode")
        
        self.auto_relock = QSpinBox()
        self.auto_relock.setRange(1, 60)
        self.auto_relock.setSuffix(" minutes")
        self.auto_relock.valueChanged.connect(
            lambda v: self._save('security.seal_mode_auto_relock_minutes', v)
        )
        section3.add_row("Auto-Relock After:", self.auto_relock,
                        "Automatically re-lock sealed files after unlocking")
        
        layout.addWidget(section3)
        layout.addStretch()
        
        scroll.setWidget(content)
        return scroll
    
    def _create_monitoring_tab(self) -> QWidget:
        """Create the monitoring settings tab."""
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        
        content = QWidget()
        layout = QVBoxLayout(content)
        layout.setContentsMargins(0, 16, 16, 16)
        layout.setSpacing(16)
        
        # Scanning
        section = SettingsSection("Periodic Scanning")
        
        self.scan_interval = QSpinBox()
        self.scan_interval.setRange(60, 3600)
        self.scan_interval.setSuffix(" seconds")
        self.scan_interval.setSingleStep(60)
        self.scan_interval.valueChanged.connect(
            lambda v: self._save('monitoring.scan_interval_seconds', v)
        )
        section.add_row("Scan Interval:", self.scan_interval,
                       "How often to verify file integrity (in addition to real-time monitoring)")
        
        self.watcher_debounce = QSpinBox()
        self.watcher_debounce.setRange(100, 2000)
        self.watcher_debounce.setSuffix(" ms")
        self.watcher_debounce.valueChanged.connect(
            lambda v: self._save('monitoring.watcher_debounce_ms', v)
        )
        section.add_row("Debounce Delay:", self.watcher_debounce,
                       "Wait time before processing rapid file changes")
        
        layout.addWidget(section)
        
        # Exclusions
        section2 = SettingsSection("Exclusions")
        
        self.ignore_hidden = QCheckBox("Ignore hidden files")
        self.ignore_hidden.toggled.connect(
            lambda v: self._save('monitoring.ignore_hidden_files', v)
        )
        section2.add_row("Hidden Files:", self.ignore_hidden)
        
        self.ignore_system = QCheckBox("Ignore system files")
        self.ignore_system.toggled.connect(
            lambda v: self._save('monitoring.ignore_system_files', v)
        )
        section2.add_row("System Files:", self.ignore_system)
        
        self.ignored_ext = QLineEdit()
        self.ignored_ext.setPlaceholderText(".tmp, .temp, .log")
        self.ignored_ext.editingFinished.connect(self._save_ignored_extensions)
        section2.add_row("Ignored Extensions:", self.ignored_ext,
                        "Comma-separated list of file extensions to ignore")
        
        layout.addWidget(section2)
        layout.addStretch()
        
        scroll.setWidget(content)
        return scroll
    
    def _create_notifications_tab(self) -> QWidget:
        """Create the notifications settings tab."""
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        
        content = QWidget()
        layout = QVBoxLayout(content)
        layout.setContentsMargins(0, 16, 16, 16)
        layout.setSpacing(16)
        
        section = SettingsSection("Notification Settings")
        
        self.alert_level = QComboBox()
        self.alert_level.addItem("All Events", "all")
        self.alert_level.addItem("Important Only", "important")
        self.alert_level.addItem("Critical Only", "critical")
        self.alert_level.addItem("None", "none")
        self.alert_level.currentIndexChanged.connect(
            lambda: self._save('notifications.alert_level', 
                             self.alert_level.currentData())
        )
        section.add_row("Alert Level:", self.alert_level,
                       "Which events trigger notifications")
        
        self.silent_mode = QCheckBox("Silent mode (no popups)")
        self.silent_mode.toggled.connect(
            lambda v: self._save('notifications.silent_mode', v)
        )
        section.add_row("Silent Mode:", self.silent_mode,
                       "Disable all popup notifications")
        
        self.desktop_notif = QCheckBox("Show desktop notifications")
        self.desktop_notif.toggled.connect(
            lambda v: self._save('notifications.desktop_notifications', v)
        )
        section.add_row("Desktop Notifications:", self.desktop_notif)
        
        self.notif_sound = QCheckBox("Play notification sounds")
        self.notif_sound.toggled.connect(
            lambda v: self._save('notifications.notification_sound', v)
        )
        section.add_row("Sound:", self.notif_sound)
        
        layout.addWidget(section)
        layout.addStretch()
        
        scroll.setWidget(content)
        return scroll
    
    def _create_appearance_tab(self) -> QWidget:
        """Create the appearance settings tab."""
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        
        content = QWidget()
        layout = QVBoxLayout(content)
        layout.setContentsMargins(0, 16, 16, 16)
        layout.setSpacing(16)
        
        section = SettingsSection("Theme")
        
        self.theme_combo = QComboBox()
        self.theme_combo.addItem("System Default", "system")
        self.theme_combo.addItem("Light", "light")
        self.theme_combo.addItem("Dark", "dark")
        self.theme_combo.currentIndexChanged.connect(
            lambda: self._save('appearance.theme', 
                             self.theme_combo.currentData())
        )
        section.add_row("Theme:", self.theme_combo)
        
        # Accent color
        accent_widget = QWidget()
        accent_layout = QHBoxLayout(accent_widget)
        accent_layout.setContentsMargins(0, 0, 0, 0)
        self.accent_preview = QFrame()
        self.accent_preview.setFixedSize(32, 32)
        self.accent_preview.setStyleSheet("border-radius: 4px;")
        accent_layout.addWidget(self.accent_preview)
        
        accent_btn = QPushButton("Choose Color")
        accent_btn.clicked.connect(self._choose_accent_color)
        accent_layout.addWidget(accent_btn)
        accent_layout.addStretch()
        
        section.add_row("Accent Color:", accent_widget)
        
        self.animations = QCheckBox("Enable animations")
        self.animations.toggled.connect(
            lambda v: self._save('appearance.animations_enabled', v)
        )
        section.add_row("Animations:", self.animations)
        
        self.density = QComboBox()
        self.density.addItem("Compact", "compact")
        self.density.addItem("Comfortable", "comfortable")
        self.density.addItem("Spacious", "spacious")
        self.density.currentIndexChanged.connect(
            lambda: self._save('appearance.ui_density', 
                             self.density.currentData())
        )
        section.add_row("UI Density:", self.density)
        
        layout.addWidget(section)
        layout.addStretch()
        
        scroll.setWidget(content)
        return scroll
    
    def _create_advanced_tab(self) -> QWidget:
        """Create the advanced settings tab."""
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        
        content = QWidget()
        layout = QVBoxLayout(content)
        layout.setContentsMargins(0, 16, 16, 16)
        layout.setSpacing(16)
        
        section = SettingsSection("Security & Logging")
        
        self.signed_logs = QCheckBox("Sign audit log entries")
        self.signed_logs.toggled.connect(
            lambda v: self._save('advanced.signed_audit_logs', v)
        )
        section.add_row("Signed Logs:", self.signed_logs,
                       "Cryptographically sign audit entries to detect tampering")
        
        self.debug_logging = QCheckBox("Enable debug logging")
        self.debug_logging.toggled.connect(
            lambda v: self._save('advanced.debug_logging', v)
        )
        section.add_row("Debug Logging:", self.debug_logging,
                       "Log additional information for troubleshooting")
        
        self.dev_mode = QCheckBox("Developer mode")
        self.dev_mode.toggled.connect(
            lambda v: self._save('advanced.developer_mode', v)
        )
        section.add_row("Developer Mode:", self.dev_mode,
                       "Show advanced options and diagnostics")
        
        layout.addWidget(section)
        
        section2 = SettingsSection("Startup")
        
        self.start_minimized = QCheckBox("Start minimized to tray")
        self.start_minimized.toggled.connect(
            lambda v: self._save('advanced.start_minimized', v)
        )
        section2.add_row("Start Minimized:", self.start_minimized)
        
        self.start_with_system = QCheckBox("Start with system")
        self.start_with_system.toggled.connect(
            lambda v: self._save('advanced.start_with_system', v)
        )
        section2.add_row("Auto-Start:", self.start_with_system,
                        "Launch FileGuard when you log in")
        
        layout.addWidget(section2)
        
        # Data management
        section3 = SettingsSection("Data Management")
        
        clear_widget = QWidget()
        clear_layout = QHBoxLayout(clear_widget)
        clear_layout.setContentsMargins(0, 0, 0, 0)
        clear_history_btn = QPushButton("Clear Activity History")
        clear_history_btn.clicked.connect(self._clear_history)
        clear_layout.addWidget(clear_history_btn)
        
        clear_backups_btn = QPushButton("Clear All Backups")
        clear_backups_btn.setProperty("class", "danger")
        clear_backups_btn.clicked.connect(self._clear_backups)
        clear_layout.addWidget(clear_backups_btn)
        clear_layout.addStretch()
        
        section3.add_row("Clear Data:", clear_widget)
        
        # Show backup size
        backup_size = self.service.restore.get_total_backup_size()
        size_str = self._format_size(backup_size)
        size_label = QLabel(f"Total backup size: {size_str}")
        size_label.setProperty("class", "muted")
        section3.add_row("Storage:", size_label)
        
        layout.addWidget(section3)
        
        # Replay onboarding
        section4 = SettingsSection("Help")
        
        onboarding_btn = QPushButton("Replay Onboarding")
        onboarding_btn.clicked.connect(self._replay_onboarding)
        section4.add_row("Onboarding:", onboarding_btn)
        
        layout.addWidget(section4)
        layout.addStretch()
        
        scroll.setWidget(content)
        return scroll
    
    def _load_settings(self):
        """Load current settings into the UI."""
        s = self.settings
        
        # Security
        idx = self.default_mode.findData(s.get('security.default_protection_mode'))
        if idx >= 0:
            self.default_mode.setCurrentIndex(idx)
        
        self.auto_restore.setChecked(s.get('security.auto_restore_enabled', False))
        self.backup_count.setValue(s.get('security.backup_retention_count', 3))
        self.confirm_restore.setChecked(s.get('security.require_confirmation_for_restore', True))
        self.confirm_unprotect.setChecked(s.get('security.require_confirmation_for_unprotect', True))
        self.auto_relock.setValue(s.get('security.seal_mode_auto_relock_minutes', 5))
        
        # Monitoring
        self.scan_interval.setValue(s.get('monitoring.scan_interval_seconds', 300))
        self.watcher_debounce.setValue(s.get('monitoring.watcher_debounce_ms', 500))
        self.ignore_hidden.setChecked(s.get('monitoring.ignore_hidden_files', True))
        self.ignore_system.setChecked(s.get('monitoring.ignore_system_files', True))
        
        ignored = s.get('monitoring.ignored_extensions', [])
        self.ignored_ext.setText(', '.join(ignored))
        
        # Notifications
        idx = self.alert_level.findData(s.get('notifications.alert_level'))
        if idx >= 0:
            self.alert_level.setCurrentIndex(idx)
        
        self.silent_mode.setChecked(s.get('notifications.silent_mode', False))
        self.desktop_notif.setChecked(s.get('notifications.desktop_notifications', True))
        self.notif_sound.setChecked(s.get('notifications.notification_sound', True))
        
        # Appearance
        idx = self.theme_combo.findData(s.get('appearance.theme'))
        if idx >= 0:
            self.theme_combo.setCurrentIndex(idx)
        
        accent = s.get('appearance.accent_color', '#3b82f6')
        self.accent_preview.setStyleSheet(
            f"background-color: {accent}; border-radius: 4px;"
        )
        
        self.animations.setChecked(s.get('appearance.animations_enabled', True))
        
        idx = self.density.findData(s.get('appearance.ui_density'))
        if idx >= 0:
            self.density.setCurrentIndex(idx)
        
        # Advanced
        self.signed_logs.setChecked(s.get('advanced.signed_audit_logs', True))
        self.debug_logging.setChecked(s.get('advanced.debug_logging', False))
        self.dev_mode.setChecked(s.get('advanced.developer_mode', False))
        self.start_minimized.setChecked(s.get('advanced.start_minimized', False))
        self.start_with_system.setChecked(s.get('advanced.start_with_system', False))
    
    def _save(self, path: str, value):
        """Save a setting."""
        self.settings.set(path, value)
    
    def _save_ignored_extensions(self):
        """Save ignored extensions from text field."""
        text = self.ignored_ext.text()
        extensions = [ext.strip() for ext in text.split(',') if ext.strip()]
        self._save('monitoring.ignored_extensions', extensions)
    
    def _choose_accent_color(self):
        """Open color picker for accent color."""
        current = QColor(self.settings.get('appearance.accent_color', '#3b82f6'))
        color = QColorDialog.getColor(current, self, "Choose Accent Color")
        
        if color.isValid():
            hex_color = color.name()
            self._save('appearance.accent_color', hex_color)
            self.accent_preview.setStyleSheet(
                f"background-color: {hex_color}; border-radius: 4px;"
            )
    
    def _on_reset(self):
        """Reset settings to defaults."""
        from PySide6.QtWidgets import QMessageBox
        
        reply = QMessageBox.question(
            self,
            "Reset Settings",
            "Are you sure you want to reset all settings to defaults?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        
        if reply == QMessageBox.StandardButton.Yes:
            self.settings.reset_to_defaults()
            self._load_settings()
    
    def _clear_history(self):
        """Clear activity history."""
        from PySide6.QtWidgets import QMessageBox
        
        reply = QMessageBox.warning(
            self,
            "Clear History",
            "This will permanently delete all activity history.\n"
            "This action cannot be undone.\n\nContinue?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        
        if reply == QMessageBox.StandardButton.Yes:
            self.service.audit.clear()
            QMessageBox.information(self, "Cleared", "Activity history has been cleared.")
    
    def _clear_backups(self):
        """Clear all backups."""
        from PySide6.QtWidgets import QMessageBox
        
        reply = QMessageBox.warning(
            self,
            "Clear Backups",
            "⚠️ WARNING: This will permanently delete ALL backup files.\n"
            "You will not be able to restore protected files after this.\n\n"
            "This action cannot be undone.\n\nAre you absolutely sure?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        
        if reply == QMessageBox.StandardButton.Yes:
            count = self.service.restore.clear_all_backups()
            QMessageBox.information(
                self, 
                "Cleared", 
                f"Deleted {count} backup files."
            )
    
    def _replay_onboarding(self):
        """Replay the onboarding flow."""
        from ui.onboarding import OnboardingDialog
        
        dialog = OnboardingDialog(
            self.service, 
            self.settings, 
            self.theme, 
            self.window()
        )
        dialog.exec()
    
    def _format_size(self, size_bytes: int) -> str:
        """Format bytes as human-readable size."""
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size_bytes < 1024:
                return f"{size_bytes:.1f} {unit}"
            size_bytes /= 1024
        return f"{size_bytes:.1f} TB"
