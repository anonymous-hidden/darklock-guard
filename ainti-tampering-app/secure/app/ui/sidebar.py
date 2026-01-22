"""
Sidebar Navigation for FileGuard
================================
The primary navigation component - a modern left sidebar with
icons and labels for each section, plus a user profile area.

Design Philosophy:
- Clear visual hierarchy
- Current section always visible
- Smooth hover/selection states
- Profile access at bottom
"""

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QFrame, QSizePolicy, QSpacerItem
)
from PySide6.QtCore import Qt, Signal, QSize
from PySide6.QtGui import QFont, QIcon, QPainter, QPainterPath, QColor, QPixmap

from config.settings_manager import SettingsManager
from ui.theme import ThemeManager


class SidebarButton(QPushButton):
    """
    A navigation button for the sidebar.
    
    Features:
    - Icon + text layout
    - Left accent bar when selected
    - Smooth hover effects
    """
    
    def __init__(self, text: str, icon_name: str, theme: ThemeManager, parent=None):
        super().__init__(parent)
        self.setText(text)
        self._icon_name = icon_name
        self._selected = False
        self._theme = theme
        
        # Setup
        self.setCheckable(True)
        self.setFixedHeight(42)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setFont(QFont("Segoe UI", 10, QFont.Weight.Normal))
        
        self._update_style()
    
    def set_selected(self, selected: bool) -> None:
        """Set the selected state."""
        self._selected = selected
        self.setChecked(selected)
        self._update_style()
    
    def _update_style(self) -> None:
        """Update button styling based on state."""
        pass  # Styling handled by global stylesheet + paintEvent
    
    def paintEvent(self, event):
        """Custom paint for icon + text layout with accent bar."""
        super().paintEvent(event)
        
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        
        # Draw left accent bar when selected
        if self._selected:
            accent_color = QColor(self._theme.colors.get('accent', '#6366f1'))
            painter.setBrush(accent_color)
            painter.setPen(Qt.PenStyle.NoPen)
            # 3px accent bar on the left
            accent_path = QPainterPath()
            accent_path.addRoundedRect(0, 6, 3, self.height() - 12, 1.5, 1.5)
            painter.drawPath(accent_path)
        
        # Draw icon placeholder (left side)
        icon_rect = self.rect().adjusted(16, 0, 0, 0)
        icon_rect.setWidth(20)
        
        # Draw icon character (using emoji/unicode for now)
        icons = {
            'dashboard': '📊',
            'files': '📁',
            'activity': '📜',
            'status': '🛡️',
            'settings': '⚙️',
            'about': 'ℹ️',
        }
        
        icon = icons.get(self._icon_name, '•')
        painter.setFont(QFont("Segoe UI Emoji", 11))
        painter.drawText(icon_rect, Qt.AlignmentFlag.AlignVCenter, icon)
        
        painter.end()


class UserProfileWidget(QFrame):
    """
    User profile widget displayed at the bottom of the sidebar.
    
    Shows:
    - Avatar (initials-based)
    - Display name
    - Status text
    
    Clickable to open profile settings.
    """
    
    clicked = Signal()
    
    def __init__(self, settings: SettingsManager, theme: ThemeManager, parent=None):
        super().__init__(parent)
        self.settings = settings
        self.theme = theme
        
        self.setFixedHeight(72)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setProperty("class", "card")
        
        self._setup_ui()
        self._update_from_settings()
        
        # Listen for settings changes
        settings.on_change(self._on_settings_change)
    
    def _setup_ui(self):
        """Set up the widget UI."""
        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(12)
        
        # Avatar
        self.avatar = QLabel()
        self.avatar.setFixedSize(40, 40)
        self.avatar.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.avatar)
        
        # Text container
        text_layout = QVBoxLayout()
        text_layout.setContentsMargins(0, 0, 0, 0)
        text_layout.setSpacing(2)
        
        self.name_label = QLabel()
        self.name_label.setFont(QFont("Segoe UI", 10, QFont.Weight.DemiBold))
        text_layout.addWidget(self.name_label)
        
        self.status_label = QLabel("Local Security Profile")
        self.status_label.setProperty("class", "muted")
        self.status_label.setFont(QFont("Segoe UI", 9))
        text_layout.addWidget(self.status_label)
        
        layout.addLayout(text_layout)
        layout.addStretch()
    
    def _update_from_settings(self):
        """Update display from settings."""
        name = self.settings.get('profile.display_name', 'User')
        self.name_label.setText(name)
        self._update_avatar(name)
    
    def _update_avatar(self, name: str):
        """Generate and display avatar with initials."""
        # Get initials
        parts = name.split()
        if len(parts) >= 2:
            initials = parts[0][0].upper() + parts[-1][0].upper()
        elif name:
            initials = name[0].upper()
        else:
            initials = "?"
        
        # Create avatar pixmap
        size = 40
        pixmap = QPixmap(size, size)
        pixmap.fill(Qt.GlobalColor.transparent)
        
        painter = QPainter(pixmap)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        
        # Draw circle background
        accent = QColor(self.theme.colors.get('accent', '#3b82f6'))
        painter.setBrush(accent)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.drawEllipse(0, 0, size, size)
        
        # Draw initials
        painter.setPen(QColor('#ffffff'))
        painter.setFont(QFont("Segoe UI", 14, QFont.Weight.DemiBold))
        painter.drawText(pixmap.rect(), Qt.AlignmentFlag.AlignCenter, initials)
        
        painter.end()
        
        self.avatar.setPixmap(pixmap)
    
    def _on_settings_change(self, path: str, old_value, new_value):
        """Handle settings changes."""
        if path.startswith('profile.'):
            self._update_from_settings()
    
    def mousePressEvent(self, event):
        """Handle click."""
        self.clicked.emit()
        super().mousePressEvent(event)
    
    def enterEvent(self, event):
        """Handle mouse enter."""
        colors = self.theme.colors
        self.setStyleSheet(f"""
            QFrame {{
                background-color: {colors['surface_hover']};
                border: 1px solid {colors['border']};
                border-radius: 8px;
            }}
        """)
        super().enterEvent(event)
    
    def leaveEvent(self, event):
        """Handle mouse leave."""
        colors = self.theme.colors
        self.setStyleSheet(f"""
            QFrame {{
                background-color: {colors['surface']};
                border: 1px solid {colors['border']};
                border-radius: 8px;
            }}
        """)
        super().leaveEvent(event)


class Sidebar(QFrame):
    """
    Main sidebar navigation component.
    
    Contains:
    - App title/logo
    - Navigation buttons
    - User profile (bottom)
    """
    
    navigation_changed = Signal(str)  # Emits section name
    profile_clicked = Signal()
    
    SECTIONS = [
        ('dashboard', 'Dashboard', 'dashboard'),
        ('files', 'Protected Files', 'files'),
        ('activity', 'Activity', 'activity'),
        ('status', 'Protection Status', 'status'),
        ('settings', 'Settings', 'settings'),
        ('about', 'About', 'about'),
    ]
    
    def __init__(self, settings: SettingsManager, theme: ThemeManager, parent=None):
        super().__init__(parent)
        self.settings = settings
        self.theme = theme
        
        self._buttons: dict[str, SidebarButton] = {}
        self._current_section = 'dashboard'
        
        self.setFixedWidth(240)
        self.setProperty("class", "sidebar")
        
        self._setup_ui()
        self._apply_styling()
        
        # Select default section
        self.select_section('dashboard')
    
    def _setup_ui(self):
        """Set up the sidebar UI."""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 16, 12, 12)
        layout.setSpacing(4)
        
        # App title
        title_layout = QHBoxLayout()
        title_layout.setContentsMargins(8, 0, 0, 16)
        
        title_icon = QLabel("🛡️")
        title_icon.setFont(QFont("Segoe UI Emoji", 20))
        title_layout.addWidget(title_icon)
        
        title_label = QLabel("FileGuard")
        title_label.setFont(QFont("Segoe UI", 16, QFont.Weight.Bold))
        title_layout.addWidget(title_label)
        title_layout.addStretch()
        
        layout.addLayout(title_layout)
        
        # Divider
        divider = QFrame()
        divider.setFrameShape(QFrame.Shape.HLine)
        divider.setProperty("class", "divider")
        divider.setFixedHeight(1)
        layout.addWidget(divider)
        
        layout.addSpacing(8)
        
        # Navigation buttons
        for section_id, label, icon in self.SECTIONS:
            btn = SidebarButton(f"    {label}", icon, self.theme)
            btn.clicked.connect(lambda checked, s=section_id: self._on_button_clicked(s))
            self._buttons[section_id] = btn
            layout.addWidget(btn)
        
        # Spacer to push profile to bottom
        layout.addStretch()
        
        # User profile
        self.profile_widget = UserProfileWidget(self.settings, self.theme)
        self.profile_widget.clicked.connect(self.profile_clicked.emit)
        layout.addWidget(self.profile_widget)
    
    def _apply_styling(self):
        """Apply sidebar-specific styling."""
        colors = self.theme.colors
        
        self.setStyleSheet(f"""
            Sidebar {{
                background-color: {colors['background_alt']};
                border: none;
            }}
            
            SidebarButton {{
                background-color: transparent;
                border: none;
                border-radius: 8px;
                text-align: left;
                padding-left: 40px;
                color: {colors['text_secondary']};
                font-weight: 400;
            }}
            
            SidebarButton:hover {{
                background-color: {colors['surface_hover']};
                color: {colors['text_primary']};
            }}
            
            SidebarButton:checked {{
                background-color: {colors.get('accent_subtle', 'rgba(99, 102, 241, 0.12)')};
                color: {colors['accent']};
                font-weight: 500;
            }}
        """)
    
    def _on_button_clicked(self, section_id: str):
        """Handle navigation button click."""
        if section_id != self._current_section:
            self.select_section(section_id)
    
    def select_section(self, section_id: str):
        """
        Select a navigation section.
        
        Args:
            section_id: ID of section to select
        """
        # Deselect all
        for btn in self._buttons.values():
            btn.set_selected(False)
        
        # Select new
        if section_id in self._buttons:
            self._buttons[section_id].set_selected(True)
            self._current_section = section_id
            self.navigation_changed.emit(section_id)
    
    @property
    def current_section(self) -> str:
        """Get currently selected section."""
        return self._current_section
