"""
Profile View for FileGuard
==========================
User profile and account settings (local-only).
Card-based security information display.

Design Philosophy:
- No cloud account - purely local identity
- Security overview at a glance
- Quick access to security actions
"""

from datetime import datetime
from pathlib import Path
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QFrame, QScrollArea, QLineEdit, QFileDialog
)
from PySide6.QtCore import Qt
from PySide6.QtGui import QFont, QPixmap

from config.settings_manager import SettingsManager
from service import ProtectionService
from ui.theme import ThemeManager


class ProfileCard(QFrame):
    """
    A card showing a profile stat or action.
    """
    
    def __init__(
        self, 
        icon: str, 
        title: str, 
        value: str, 
        theme: ThemeManager,
        parent=None
    ):
        super().__init__(parent)
        self.setProperty("class", "card")
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(8)
        
        icon_label = QLabel(icon)
        icon_label.setFont(QFont("Segoe UI Emoji", 24))
        icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(icon_label)
        
        value_label = QLabel(value)
        value_label.setFont(QFont("Segoe UI", 18, QFont.Weight.Bold))
        value_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(value_label)
        
        title_label = QLabel(title)
        title_label.setProperty("class", "muted")
        title_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(title_label)


class ProfileView(QWidget):
    """
    User profile view with security overview.
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
        self._load_profile()
    
    def _setup_ui(self):
        """Set up the profile UI."""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(32, 32, 32, 32)
        layout.setSpacing(24)
        
        # Header
        title = QLabel("Profile")
        title.setProperty("class", "title")
        title.setFont(QFont("Segoe UI", 24, QFont.Weight.Bold))
        layout.addWidget(title)
        
        # Main content
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        
        content = QWidget()
        content_layout = QVBoxLayout(content)
        content_layout.setContentsMargins(0, 0, 16, 0)
        content_layout.setSpacing(24)
        
        # Profile card
        profile_frame = QFrame()
        profile_frame.setProperty("class", "card")
        profile_layout = QHBoxLayout(profile_frame)
        profile_layout.setContentsMargins(24, 24, 24, 24)
        profile_layout.setSpacing(24)
        
        # Avatar
        avatar_frame = QFrame()
        avatar_frame.setFixedSize(80, 80)
        avatar_frame.setStyleSheet("""
            QFrame {
                background-color: #3b82f6;
                border-radius: 40px;
            }
        """)
        avatar_layout = QVBoxLayout(avatar_frame)
        avatar_layout.setContentsMargins(0, 0, 0, 0)
        
        self.avatar_label = QLabel("👤")
        self.avatar_label.setFont(QFont("Segoe UI Emoji", 32))
        self.avatar_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        avatar_layout.addWidget(self.avatar_label)
        
        profile_layout.addWidget(avatar_frame)
        
        # Name and info
        info_layout = QVBoxLayout()
        info_layout.setSpacing(4)
        
        self.name_input = QLineEdit()
        self.name_input.setFont(QFont("Segoe UI", 16, QFont.Weight.Bold))
        self.name_input.setPlaceholderText("Enter your name")
        self.name_input.setStyleSheet("border: none; background: transparent;")
        self.name_input.editingFinished.connect(self._save_name)
        info_layout.addWidget(self.name_input)
        
        self.email_label = QLabel("Local User")
        self.email_label.setProperty("class", "muted")
        info_layout.addWidget(self.email_label)
        
        info_layout.addStretch()
        profile_layout.addLayout(info_layout, 1)
        
        content_layout.addWidget(profile_frame)
        
        # Security stats grid
        stats_label = QLabel("Security Overview")
        stats_label.setFont(QFont("Segoe UI", 14, QFont.Weight.DemiBold))
        content_layout.addWidget(stats_label)
        
        stats_grid = QHBoxLayout()
        stats_grid.setSpacing(16)
        
        status = self.service.get_status()
        
        self.files_card = ProfileCard(
            "📁", "Protected Files", str(status.protected_count), self.theme
        )
        stats_grid.addWidget(self.files_card)
        
        self.tamper_card = ProfileCard(
            "🛡️", "Threats Blocked", str(status.recent_tamper_count), self.theme
        )
        stats_grid.addWidget(self.tamper_card)
        
        # Calculate days since first protection
        days_protected = self._calculate_days_protected()
        self.days_card = ProfileCard(
            "📅", "Days Protected", str(days_protected), self.theme
        )
        stats_grid.addWidget(self.days_card)
        
        content_layout.addLayout(stats_grid)
        
        # Quick actions
        actions_label = QLabel("Quick Actions")
        actions_label.setFont(QFont("Segoe UI", 14, QFont.Weight.DemiBold))
        content_layout.addWidget(actions_label)
        
        actions_frame = QFrame()
        actions_frame.setProperty("class", "card")
        actions_layout = QVBoxLayout(actions_frame)
        actions_layout.setContentsMargins(16, 16, 16, 16)
        actions_layout.setSpacing(8)
        
        # Export settings
        export_row = QHBoxLayout()
        export_label = QLabel("📤 Export configuration")
        export_row.addWidget(export_label)
        export_row.addStretch()
        export_btn = QPushButton("Export")
        export_btn.clicked.connect(self._export_config)
        export_row.addWidget(export_btn)
        actions_layout.addLayout(export_row)
        
        # Import settings
        import_row = QHBoxLayout()
        import_label = QLabel("📥 Import configuration")
        import_row.addWidget(import_label)
        import_row.addStretch()
        import_btn = QPushButton("Import")
        import_btn.clicked.connect(self._import_config)
        import_row.addWidget(import_btn)
        actions_layout.addLayout(import_row)
        
        # Generate report
        report_row = QHBoxLayout()
        report_label = QLabel("📊 Generate security report")
        report_row.addWidget(report_label)
        report_row.addStretch()
        report_btn = QPushButton("Generate")
        report_btn.clicked.connect(self._generate_report)
        report_row.addWidget(report_btn)
        actions_layout.addLayout(report_row)
        
        content_layout.addWidget(actions_frame)
        
        # Security tips
        tips_label = QLabel("Security Tips")
        tips_label.setFont(QFont("Segoe UI", 14, QFont.Weight.DemiBold))
        content_layout.addWidget(tips_label)
        
        tips_frame = QFrame()
        tips_frame.setProperty("class", "card")
        tips_layout = QVBoxLayout(tips_frame)
        tips_layout.setContentsMargins(16, 16, 16, 16)
        tips_layout.setSpacing(12)
        
        tips = [
            ("💡", "Use Auto-Restore mode for critical files you want to protect from ransomware"),
            ("🔒", "Sealed mode provides the strongest protection - files cannot be modified"),
            ("📅", "Regular backups help ensure you can always recover your files"),
            ("👁️", "Review activity logs periodically to catch suspicious changes"),
        ]
        
        for icon, tip in tips:
            tip_row = QHBoxLayout()
            tip_row.setSpacing(12)
            
            icon_lbl = QLabel(icon)
            icon_lbl.setFont(QFont("Segoe UI Emoji", 14))
            tip_row.addWidget(icon_lbl)
            
            text_lbl = QLabel(tip)
            text_lbl.setWordWrap(True)
            tip_row.addWidget(text_lbl, 1)
            
            tips_layout.addLayout(tip_row)
        
        content_layout.addWidget(tips_frame)
        
        # About section
        about_label = QLabel("About FileGuard")
        about_label.setFont(QFont("Segoe UI", 14, QFont.Weight.DemiBold))
        content_layout.addWidget(about_label)
        
        about_frame = QFrame()
        about_frame.setProperty("class", "card")
        about_layout = QVBoxLayout(about_frame)
        about_layout.setContentsMargins(16, 16, 16, 16)
        about_layout.setSpacing(8)
        
        version_label = QLabel("Version 1.0.0")
        version_label.setFont(QFont("Segoe UI", 12, QFont.Weight.DemiBold))
        about_layout.addWidget(version_label)
        
        desc_label = QLabel(
            "FileGuard is a local-only file protection application.\n"
            "No cloud services, no telemetry, complete privacy.\n\n"
            "Your files, your control."
        )
        desc_label.setProperty("class", "muted")
        desc_label.setWordWrap(True)
        about_layout.addWidget(desc_label)
        
        content_layout.addWidget(about_frame)
        content_layout.addStretch()
        
        scroll.setWidget(content)
        layout.addWidget(scroll, 1)
    
    def _load_profile(self):
        """Load profile settings."""
        name = self.settings.get('profile.name', '')
        if name:
            self.name_input.setText(name)
            
            # Set avatar to first letter
            self.avatar_label.setText(name[0].upper())
            self.avatar_label.setFont(QFont("Segoe UI", 28, QFont.Weight.Bold))
            self.avatar_label.setStyleSheet("color: white;")
    
    def _save_name(self):
        """Save the profile name."""
        name = self.name_input.text().strip()
        self.settings.set('profile.name', name)
        
        if name:
            self.avatar_label.setText(name[0].upper())
            self.avatar_label.setFont(QFont("Segoe UI", 28, QFont.Weight.Bold))
            self.avatar_label.setStyleSheet("color: white;")
        else:
            self.avatar_label.setText("👤")
            self.avatar_label.setFont(QFont("Segoe UI Emoji", 32))
            self.avatar_label.setStyleSheet("")
    
    def _calculate_days_protected(self) -> int:
        """Calculate days since first file was protected."""
        items = self.service.baseline.get_all_protected_items()
        if items:
            earliest = min(item.created_at for item in items)
            return (datetime.now() - earliest).days
        return 0
    
    def _export_config(self):
        """Export configuration to file."""
        from PySide6.QtWidgets import QMessageBox
        
        file_path, _ = QFileDialog.getSaveFileName(
            self,
            "Export Configuration",
            "fileguard_config.json",
            "JSON Files (*.json)"
        )
        
        if file_path:
            if self.settings.export_to_file(Path(file_path)):
                QMessageBox.information(
                    self,
                    "Export Complete",
                    f"Configuration exported to {file_path}"
                )
            else:
                QMessageBox.warning(
                    self,
                    "Export Failed",
                    "Failed to export configuration."
                )
    
    def _import_config(self):
        """Import configuration from file."""
        from PySide6.QtWidgets import QMessageBox
        
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Import Configuration",
            "",
            "JSON Files (*.json)"
        )
        
        if file_path:
            if self.settings.import_from_file(Path(file_path)):
                QMessageBox.information(
                    self,
                    "Import Complete",
                    "Configuration imported successfully.\n"
                    "Some changes may require a restart."
                )
                self._load_profile()
            else:
                QMessageBox.warning(
                    self,
                    "Import Failed",
                    "Failed to import configuration.\n"
                    "The file may be corrupted or invalid."
                )
    
    def _generate_report(self):
        """Generate a security report."""
        from PySide6.QtWidgets import QMessageBox
        
        file_path, _ = QFileDialog.getSaveFileName(
            self,
            "Save Security Report",
            "fileguard_security_report.txt",
            "Text Files (*.txt)"
        )
        
        if file_path:
            report = self._build_report()
            try:
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(report)
                QMessageBox.information(
                    self,
                    "Report Generated",
                    f"Security report saved to {file_path}"
                )
            except Exception as e:
                QMessageBox.warning(
                    self,
                    "Report Failed",
                    f"Failed to generate report: {e}"
                )
    
    def _build_report(self) -> str:
        """Build the security report content."""
        status = self.service.get_status()
        
        lines = [
            "=" * 60,
            "FILEGUARD SECURITY REPORT",
            f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "=" * 60,
            "",
            "PROTECTION STATUS",
            "-" * 40,
            f"Overall Status: {status.overall_status.upper()}",
            f"Protected Files: {status.protected_count}",
            f"Tampered Files: {status.tampered_count}",
            f"Unverified Files: {status.unverified_count}",
            f"Last Verification: {status.last_verification or 'Never'}",
            "",
            "PROTECTED FILES",
            "-" * 40,
        ]
        
        protected = self.service.baseline.get_all_protected()
        for item in protected:
            lines.append(f"  • {item.path}")
            lines.append(f"    Mode: {item.mode.value}")
            lines.append(f"    Added: {item.protected_at}")
            lines.append("")
        
        lines.extend([
            "RECENT ACTIVITY (Last 20 Events)",
            "-" * 40,
        ])
        
        history = self.service.get_activity_history(limit=20)
        for entry in history:
            lines.append(f"  [{entry.timestamp}] {entry.explanation}")
        
        lines.extend([
            "",
            "=" * 60,
            "END OF REPORT",
            "=" * 60,
        ])
        
        return "\n".join(lines)
