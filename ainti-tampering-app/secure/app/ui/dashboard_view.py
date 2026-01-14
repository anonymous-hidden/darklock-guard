"""
Dashboard View for FileGuard
============================
The main landing page showing overall protection status,
quick stats, and recent activity.

Design Philosophy:
- At-a-glance status visibility
- Quick actions for common tasks
- Clear visual indicators for protection state
"""

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QFrame, QGridLayout, QScrollArea, QSizePolicy, QFileDialog
)
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QFont

from config.settings_manager import SettingsManager
from service import ProtectionService, ProtectionStatus
from ui.theme import ThemeManager


class StatCard(QFrame):
    """
    A card displaying a single statistic with refined styling.
    """
    
    def __init__(self, title: str, value: str, icon: str, theme: ThemeManager = None, parent=None):
        super().__init__(parent)
        self._theme = theme
        self.setProperty("class", "card")
        self.setMinimumHeight(110)
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 18, 20, 18)
        layout.setSpacing(10)
        
        # Header with icon
        header = QHBoxLayout()
        header.setSpacing(8)
        
        icon_label = QLabel(icon)
        icon_label.setFont(QFont("Segoe UI Emoji", 14))
        header.addWidget(icon_label)
        
        title_label = QLabel(title)
        title_label.setFont(QFont("Segoe UI", 11, QFont.Weight.Normal))
        title_label.setProperty("class", "muted")
        header.addWidget(title_label)
        header.addStretch()
        
        layout.addLayout(header)
        
        # Value with better typography
        self.value_label = QLabel(value)
        self.value_label.setFont(QFont("Segoe UI", 28, QFont.Weight.DemiBold))
        layout.addWidget(self.value_label)
        
        layout.addStretch()
    
    def set_value(self, value: str):
        """Update the displayed value."""
        self.value_label.setText(value)


class StatusBanner(QFrame):
    """
    Large status banner showing overall protection state.
    """
    
    def __init__(self, theme: ThemeManager = None, parent=None):
        super().__init__(parent)
        self._theme = theme
        self.setProperty("class", "card")
        self.setMinimumHeight(130)
        
        layout = QHBoxLayout(self)
        layout.setContentsMargins(28, 24, 28, 24)
        layout.setSpacing(24)
        
        # Status icon
        self.status_icon = QLabel("🛡️")
        self.status_icon.setFont(QFont("Segoe UI Emoji", 44))
        layout.addWidget(self.status_icon)
        
        # Text content
        text_layout = QVBoxLayout()
        text_layout.setSpacing(6)
        
        self.status_title = QLabel("All Systems Protected")
        self.status_title.setFont(QFont("Segoe UI", 20, QFont.Weight.DemiBold))
        text_layout.addWidget(self.status_title)
        
        self.status_subtitle = QLabel("Your protected files are secure and unchanged")
        self.status_subtitle.setFont(QFont("Segoe UI", 12, QFont.Weight.Normal))
        self.status_subtitle.setProperty("class", "muted")
        text_layout.addWidget(self.status_subtitle)
        
        layout.addLayout(text_layout, 1)
        
        # Action button
        self.action_button = QPushButton("Verify Now")
        self.action_button.setProperty("class", "primary")
        self.action_button.setFixedHeight(42)
        self.action_button.setFixedWidth(120)
        layout.addWidget(self.action_button)
    
    def set_status(self, status: str, subtitle: str = ""):
        """
        Update the status display.
        
        Args:
            status: 'safe', 'warning', or 'tampered'
            subtitle: Descriptive text
        """
        if status == 'safe':
            self.status_icon.setText("✅")
            self.status_title.setText("All Systems Protected")
            self.status_title.setStyleSheet("color: #34d399;")  # Emerald
            self.status_subtitle.setText(subtitle or "Your protected files are secure and unchanged")
        elif status == 'warning':
            self.status_icon.setText("⚠️")
            self.status_title.setText("Attention Needed")
            self.status_title.setStyleSheet("color: #fbbf24;")  # Amber
            self.status_subtitle.setText(subtitle or "Some items may need your attention")
        elif status == 'tampered':
            self.status_icon.setText("🚨")
            self.status_title.setText("Tampering Detected")
            self.status_title.setStyleSheet("color: #f87171;")  # Red
            self.status_subtitle.setText(subtitle or "Some protected files have been modified")
        else:
            self.status_icon.setText("🛡️")
            self.status_title.setText("FileGuard Active")
            self.status_title.setStyleSheet("")
            self.status_subtitle.setText(subtitle or "Monitoring your protected files")


class QuickActionCard(QFrame):
    """
    A quick action button card with hover effects.
    """
    
    clicked = Signal()
    
    def __init__(self, title: str, description: str, icon: str, parent=None):
        super().__init__(parent)
        self.setProperty("class", "card")
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setMinimumHeight(88)
        
        layout = QHBoxLayout(self)
        layout.setContentsMargins(20, 18, 20, 18)
        layout.setSpacing(16)
        
        # Icon
        icon_label = QLabel(icon)
        icon_label.setFont(QFont("Segoe UI Emoji", 22))
        layout.addWidget(icon_label)
        
        # Text
        text_layout = QVBoxLayout()
        text_layout.setSpacing(4)
        
        title_label = QLabel(title)
        title_label.setFont(QFont("Segoe UI", 12, QFont.Weight.Medium))
        text_layout.addWidget(title_label)
        
        desc_label = QLabel(description)
        desc_label.setProperty("class", "muted")
        desc_label.setFont(QFont("Segoe UI", 10, QFont.Weight.Normal))
        text_layout.addWidget(desc_label)
        
        layout.addLayout(text_layout, 1)
        
        # Arrow
        arrow = QLabel("→")
        arrow.setProperty("class", "muted")
        arrow.setFont(QFont("Segoe UI", 14))
        layout.addWidget(arrow)
    
    def mousePressEvent(self, event):
        self.clicked.emit()
        super().mousePressEvent(event)


class RecentActivityItem(QFrame):
    """
    A single recent activity item.
    """
    
    def __init__(self, icon: str, title: str, time: str, parent=None):
        super().__init__(parent)
        
        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(12)
        
        # Icon
        icon_label = QLabel(icon)
        icon_label.setFont(QFont("Segoe UI Emoji", 14))
        layout.addWidget(icon_label)
        
        # Title
        title_label = QLabel(title)
        title_label.setFont(QFont("Segoe UI", 11))
        layout.addWidget(title_label, 1)
        
        # Time
        time_label = QLabel(time)
        time_label.setProperty("class", "muted")
        time_label.setFont(QFont("Segoe UI", 10))
        layout.addWidget(time_label)


class DashboardView(QWidget):
    """
    Main dashboard view showing protection overview.
    """
    
    navigate_to = Signal(str)
    
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
        self.refresh()
    
    def _setup_ui(self):
        """Set up the dashboard UI."""
        # Main scroll area
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        
        # Content widget
        content = QWidget()
        layout = QVBoxLayout(content)
        layout.setContentsMargins(32, 32, 32, 32)
        layout.setSpacing(24)
        
        # Page title
        title = QLabel("Dashboard")
        title.setFont(QFont("Segoe UI", 22, QFont.Weight.DemiBold))
        layout.addWidget(title)
        
        layout.addSpacing(4)
        
        # Status banner
        self.status_banner = StatusBanner(self.theme)
        self.status_banner.action_button.clicked.connect(self._on_verify_clicked)
        layout.addWidget(self.status_banner)
        
        # Stats row
        stats_layout = QHBoxLayout()
        stats_layout.setSpacing(16)
        
        self.protected_count_card = StatCard("Protected Files", "0", "📁")
        stats_layout.addWidget(self.protected_count_card)
        
        self.tamper_events_card = StatCard("Tamper Events (24h)", "0", "🚨")
        stats_layout.addWidget(self.tamper_events_card)
        
        self.last_check_card = StatCard("Last Verification", "Never", "⏱️")
        stats_layout.addWidget(self.last_check_card)
        
        layout.addLayout(stats_layout)
        
        # Quick actions
        actions_label = QLabel("Quick Actions")
        actions_label.setFont(QFont("Segoe UI", 13, QFont.Weight.Medium))
        layout.addWidget(actions_label)
        
        actions_layout = QGridLayout()
        actions_layout.setSpacing(16)
        
        protect_file = QuickActionCard(
            "Protect a File",
            "Add a new file to protection",
            "📄"
        )
        protect_file.clicked.connect(self._on_protect_file)
        actions_layout.addWidget(protect_file, 0, 0)
        
        protect_folder = QuickActionCard(
            "Protect a Folder",
            "Add a folder and all its contents",
            "📁"
        )
        protect_folder.clicked.connect(self._on_protect_folder)
        actions_layout.addWidget(protect_folder, 0, 1)
        
        view_activity = QuickActionCard(
            "View Activity",
            "See recent protection events",
            "📜"
        )
        view_activity.clicked.connect(lambda: self.navigate_to.emit('activity'))
        actions_layout.addWidget(view_activity, 1, 0)
        
        run_verification = QuickActionCard(
            "Run Verification",
            "Check all files right now",
            "🔍"
        )
        run_verification.clicked.connect(self._on_verify_clicked)
        actions_layout.addWidget(run_verification, 1, 1)
        
        layout.addLayout(actions_layout)
        
        # Recent activity section
        recent_label = QLabel("Recent Activity")
        recent_label.setFont(QFont("Segoe UI", 14, QFont.Weight.DemiBold))
        layout.addWidget(recent_label)
        
        self.recent_activity_container = QVBoxLayout()
        self.recent_activity_container.setSpacing(4)
        layout.addLayout(self.recent_activity_container)
        
        # Placeholder for empty state
        self.empty_activity = QLabel("No recent activity")
        self.empty_activity.setProperty("class", "muted")
        self.empty_activity.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.recent_activity_container.addWidget(self.empty_activity)
        
        layout.addStretch()
        
        scroll.setWidget(content)
        
        # Main layout
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.addWidget(scroll)
    
    def refresh(self):
        """Refresh dashboard data."""
        status = self.service.get_status()
        self.update_status(status)
        self._update_recent_activity()
    
    def update_status(self, status: ProtectionStatus):
        """Update the status displays."""
        # Update banner
        subtitle = ""
        if status.last_verification:
            subtitle = f"Last check: {status.last_verification.strftime('%H:%M')}"
        self.status_banner.set_status(status.overall_status, subtitle)
        
        # Update stat cards
        self.protected_count_card.set_value(str(status.protected_count))
        self.tamper_events_card.set_value(str(status.recent_tamper_count))
        
        if status.last_verification:
            time_str = status.last_verification.strftime("%H:%M")
            self.last_check_card.set_value(time_str)
        else:
            self.last_check_card.set_value("Never")
    
    def _update_recent_activity(self):
        """Update the recent activity list."""
        # Clear existing items (except empty placeholder)
        for i in reversed(range(self.recent_activity_container.count())):
            item = self.recent_activity_container.itemAt(i)
            if item.widget() and item.widget() != self.empty_activity:
                item.widget().deleteLater()
        
        # Get recent events
        events = self.service.get_activity_history(limit=5)
        
        if events:
            self.empty_activity.hide()
            
            for entry in events:
                icon = {
                    'file_protected': '✅',
                    'tamper_detected': '🚨',
                    'file_restored': '🔄',
                    'verification_passed': '✓',
                    'service_started': 'ℹ️',
                }.get(entry.event_type.value, '•')
                
                time_str = entry.timestamp.strftime("%H:%M")
                item = RecentActivityItem(icon, entry.explanation, time_str)
                self.recent_activity_container.addWidget(item)
        else:
            self.empty_activity.show()
    
    def _on_verify_clicked(self):
        """Handle verify now button click."""
        self.service.verify_now()
        # Show feedback
        self.status_banner.action_button.setText("Verifying...")
        self.status_banner.action_button.setEnabled(False)
        
        # Re-enable after a moment
        from PySide6.QtCore import QTimer
        QTimer.singleShot(2000, lambda: (
            self.status_banner.action_button.setText("Verify Now"),
            self.status_banner.action_button.setEnabled(True),
            self.refresh()
        ))
    
    def _on_protect_file(self):
        """Handle protect file action."""
        from core.policy import ProtectionMode
        
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Select File to Protect",
            "",
            "All Files (*.*)"
        )
        
        if file_path:
            # Get default mode from settings
            default_mode = self.settings.get('security.default_protection_mode', 'detect_alert')
            mode = ProtectionMode(default_mode)
            
            if self.service.protect_file(file_path, mode):
                self.refresh()
                self.navigate_to.emit('files')
    
    def _on_protect_folder(self):
        """Handle protect folder action."""
        from core.policy import ProtectionMode
        
        folder_path = QFileDialog.getExistingDirectory(
            self,
            "Select Folder to Protect"
        )
        
        if folder_path:
            default_mode = self.settings.get('security.default_protection_mode', 'detect_alert')
            mode = ProtectionMode(default_mode)
            
            if self.service.protect_folder(folder_path, mode):
                self.refresh()
                self.navigate_to.emit('files')
