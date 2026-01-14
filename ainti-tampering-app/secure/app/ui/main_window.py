"""
Main Window for FileGuard
=========================
The primary application window containing the sidebar navigation
and content area with stacked views.

Design Philosophy:
- Clean layout with clear hierarchy
- Sidebar always visible for navigation
- Content area fills remaining space
- Smooth transitions between views
"""

from PySide6.QtWidgets import (
    QMainWindow, QWidget, QHBoxLayout, QVBoxLayout,
    QStackedWidget, QFrame, QMessageBox
)
from PySide6.QtCore import Qt, Signal, Slot
from PySide6.QtGui import QCloseEvent

from config.settings_manager import SettingsManager
from service import ProtectionService
from ui.theme import ThemeManager
from ui.sidebar import Sidebar
from ui.dashboard_view import DashboardView
from ui.protected_files_view import ProtectedFilesView
from ui.activity_view import ActivityView
from ui.status_view import StatusView
from ui.settings_view import SettingsView
from ui.profile_view import ProfileView
from ui.onboarding import OnboardingDialog


class MainWindow(QMainWindow):
    """
    Main application window.
    
    Layout:
    ┌─────────────────────────────────────────────────┐
    │  Sidebar  │         Content Area                │
    │           │                                     │
    │  Dashboard│    [Current View]                   │
    │  Files    │                                     │
    │  Activity │                                     │
    │  Status   │                                     │
    │  Settings │                                     │
    │  About    │                                     │
    │           │                                     │
    │  ─────────│                                     │
    │  Profile  │                                     │
    └─────────────────────────────────────────────────┘
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
        
        self.setWindowTitle("FileGuard")
        self.setMinimumSize(900, 600)
        
        self._setup_ui()
        self._connect_signals()
        
        # Apply theme
        theme.theme_changed.connect(self._on_theme_changed)
    
    def _setup_ui(self):
        """Set up the main window UI."""
        # Central widget
        central = QWidget()
        self.setCentralWidget(central)
        
        # Main layout (horizontal: sidebar | content)
        main_layout = QHBoxLayout(central)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)
        
        # Sidebar
        self.sidebar = Sidebar(self.settings, self.theme)
        main_layout.addWidget(self.sidebar)
        
        # Content area
        content_frame = QFrame()
        content_frame.setObjectName("content_area")
        content_layout = QVBoxLayout(content_frame)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(0)
        
        # Stacked widget for views
        self.view_stack = QStackedWidget()
        content_layout.addWidget(self.view_stack)
        
        main_layout.addWidget(content_frame, 1)  # Stretch factor 1
        
        # Create views
        self._create_views()
    
    def _create_views(self):
        """Create all content views."""
        # Dashboard
        self.dashboard_view = DashboardView(self.service, self.settings, self.theme)
        self.view_stack.addWidget(self.dashboard_view)
        
        # Protected Files
        self.files_view = ProtectedFilesView(self.service, self.settings, self.theme)
        self.view_stack.addWidget(self.files_view)
        
        # Activity
        self.activity_view = ActivityView(self.service, self.settings, self.theme)
        self.view_stack.addWidget(self.activity_view)
        
        # Protection Status
        self.status_view = StatusView(self.service, self.settings, self.theme)
        self.view_stack.addWidget(self.status_view)
        
        # Settings
        self.settings_view = SettingsView(self.service, self.settings, self.theme)
        self.view_stack.addWidget(self.settings_view)
        
        # About (simple placeholder for now)
        self.about_view = self._create_about_view()
        self.view_stack.addWidget(self.about_view)
        
        # Profile (shown when clicking user profile)
        self.profile_view = ProfileView(self.service, self.settings, self.theme)
        self.view_stack.addWidget(self.profile_view)
        
        # Map section IDs to view indices
        self._view_map = {
            'dashboard': 0,
            'files': 1,
            'activity': 2,
            'status': 3,
            'settings': 4,
            'about': 5,
            'profile': 6,
        }
    
    def _create_about_view(self) -> QWidget:
        """Create the About view with polished cards and proper spacing."""
        from PySide6.QtWidgets import QLabel, QVBoxLayout, QHBoxLayout, QScrollArea, QFrame, QSizePolicy
        from PySide6.QtGui import QFont
        
        colors = self.theme.colors
        
        # Main container with scroll
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        
        # Content widget with centered layout
        content = QWidget()
        outer_layout = QHBoxLayout(content)
        outer_layout.setContentsMargins(40, 40, 40, 40)
        
        # Center container with max width
        center_container = QWidget()
        center_container.setMaximumWidth(560)
        center_container.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        
        layout = QVBoxLayout(center_container)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        
        # Top padding
        layout.addSpacing(20)
        
        # Logo
        logo = QLabel("🛡️")
        logo.setFont(QFont("Segoe UI Emoji", 52))
        logo.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(logo)
        
        layout.addSpacing(16)
        
        # App name - Semibold
        name = QLabel("FileGuard")
        name.setFont(QFont("Segoe UI", 28, QFont.Weight.DemiBold))
        name.setAlignment(Qt.AlignmentFlag.AlignCenter)
        name.setStyleSheet(f"color: {colors['text_primary']}; letter-spacing: -0.5px;")
        layout.addWidget(name)
        
        layout.addSpacing(6)
        
        # Version - small, muted
        version = QLabel("Version 1.0.0")
        version.setFont(QFont("Segoe UI", 11))
        version.setAlignment(Qt.AlignmentFlag.AlignCenter)
        version.setStyleSheet(f"color: {colors['text_muted']};")
        layout.addWidget(version)
        
        layout.addSpacing(32)
        
        # Main description card
        desc_card = QFrame()
        desc_card.setStyleSheet(f"""
            QFrame {{
                background-color: {colors['surface']};
                border: 1px solid {colors['border']};
                border-radius: 14px;
            }}
        """)
        desc_layout = QVBoxLayout(desc_card)
        desc_layout.setContentsMargins(28, 24, 28, 24)
        desc_layout.setSpacing(0)
        
        # Section title - Medium weight
        desc_title = QLabel("File & Folder Tamper Protection")
        desc_title.setFont(QFont("Segoe UI", 14, QFont.Weight.Medium))
        desc_title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        desc_title.setStyleSheet(f"color: {colors['text_primary']};")
        desc_layout.addWidget(desc_title)
        
        desc_layout.addSpacing(16)
        
        # Body text - Regular weight, good line height
        desc_body = QLabel(
            "A local-only security application that monitors your important files\n"
            "and ensures they remain unchanged. If something is modified,\n"
            "you'll know — and you can restore it."
        )
        desc_body.setFont(QFont("Segoe UI", 12, QFont.Weight.Normal))
        desc_body.setAlignment(Qt.AlignmentFlag.AlignCenter)
        desc_body.setStyleSheet(f"color: {colors['text_secondary']}; line-height: 1.6;")
        desc_body.setWordWrap(True)
        desc_layout.addWidget(desc_body)
        
        desc_layout.addSpacing(20)
        
        # Feature pills
        pills_widget = QWidget()
        pills_layout = QHBoxLayout(pills_widget)
        pills_layout.setContentsMargins(0, 0, 0, 0)
        pills_layout.setSpacing(12)
        pills_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        for text in ["🔒 No cloud", "📊 No telemetry", "👤 No accounts"]:
            pill = QLabel(text)
            pill.setFont(QFont("Segoe UI", 10))
            pill.setStyleSheet(f"""
                background-color: {colors.get('accent_subtle', 'rgba(99, 102, 241, 0.12)')};
                color: {colors['accent']};
                padding: 6px 12px;
                border-radius: 16px;
            """)
            pills_layout.addWidget(pill)
        
        desc_layout.addWidget(pills_widget)
        
        layout.addWidget(desc_card)
        
        layout.addSpacing(20)
        
        # Privacy card
        privacy_card = QFrame()
        privacy_card.setStyleSheet(f"""
            QFrame {{
                background-color: {colors['surface']};
                border: 1px solid {colors['border']};
                border-radius: 14px;
            }}
        """)
        privacy_layout = QVBoxLayout(privacy_card)
        privacy_layout.setContentsMargins(28, 20, 28, 20)
        privacy_layout.setSpacing(12)
        
        privacy_title = QLabel("Privacy Commitment")
        privacy_title.setFont(QFont("Segoe UI", 12, QFont.Weight.Medium))
        privacy_title.setStyleSheet(f"color: {colors['text_primary']};")
        privacy_layout.addWidget(privacy_title)
        
        privacy_items = [
            "No data is ever sent to external servers",
            "No analytics or telemetry collection",
            "No account or registration required",
            "All encryption keys stay on your device"
        ]
        
        for item in privacy_items:
            item_label = QLabel(f"•  {item}")
            item_label.setFont(QFont("Segoe UI", 11))
            item_label.setStyleSheet(f"color: {colors['text_secondary']};")
            privacy_layout.addWidget(item_label)
        
        layout.addWidget(privacy_card)
        
        layout.addStretch()
        
        # Footer - meta text
        footer = QLabel("© 2026 FileGuard  •  MIT License")
        footer.setFont(QFont("Segoe UI", 10))
        footer.setAlignment(Qt.AlignmentFlag.AlignCenter)
        footer.setStyleSheet(f"color: {colors['text_muted']}; padding: 16px;")
        layout.addWidget(footer)
        
        # Center the container
        outer_layout.addStretch()
        outer_layout.addWidget(center_container)
        outer_layout.addStretch()
        
        scroll.setWidget(content)
        return scroll
    
    def _connect_signals(self):
        """Connect signals between components."""
        # Sidebar navigation
        self.sidebar.navigation_changed.connect(self._on_navigation_changed)
        self.sidebar.profile_clicked.connect(self._on_profile_clicked)
        
        # Service events
        self.service.on_tamper(self._on_tamper_detected)
        self.service.on_status_change(self._on_status_changed)
        
        # View signals
        self.files_view.file_selected.connect(self.activity_view.show_file_history)
        self.dashboard_view.navigate_to.connect(self._on_navigation_changed)
    
    @Slot(str)
    def _on_navigation_changed(self, section_id: str):
        """Handle navigation changes from sidebar."""
        if section_id in self._view_map:
            self.view_stack.setCurrentIndex(self._view_map[section_id])
            
            # Refresh view data when switching
            if section_id == 'dashboard':
                self.dashboard_view.refresh()
            elif section_id == 'files':
                self.files_view.refresh()
            elif section_id == 'activity':
                self.activity_view.refresh()
            elif section_id == 'status':
                self.status_view.refresh()
    
    @Slot()
    def _on_profile_clicked(self):
        """Handle profile widget click."""
        self.view_stack.setCurrentIndex(self._view_map['profile'])
        # Deselect sidebar buttons
        self.sidebar.select_section('')
    
    def _on_tamper_detected(self, event):
        """Handle tamper detection events."""
        # Show notification if enabled
        if self.settings.get('notifications.desktop_notifications', True):
            from PySide6.QtWidgets import QSystemTrayIcon
            # Would show system tray notification here
            pass
        
        # Refresh relevant views
        self.dashboard_view.refresh()
        self.activity_view.refresh()
    
    def _on_status_changed(self, status):
        """Handle protection status changes."""
        self.dashboard_view.update_status(status)
        self.status_view.update_status(status)
    
    def _on_theme_changed(self, theme_name: str):
        """Handle theme changes."""
        # Views may need to refresh their styling
        pass
    
    def show_onboarding(self):
        """Show the first-run onboarding dialog."""
        dialog = OnboardingDialog(self.service, self.settings, self.theme, self)
        if dialog.exec():
            # Onboarding completed
            self.settings.mark_first_run_complete()
            self.dashboard_view.refresh()
            self.files_view.refresh()
    
    def closeEvent(self, event: QCloseEvent):
        """Handle window close."""
        # Check if we should minimize to tray instead
        if self.settings.get('advanced.start_minimized', False):
            # Would minimize to system tray here
            event.ignore()
            self.hide()
        else:
            event.accept()
    
    def navigate_to(self, section: str):
        """
        Navigate to a specific section.
        
        Public method for programmatic navigation.
        """
        self.sidebar.select_section(section)
        self._on_navigation_changed(section)
