"""
Theme Manager for FileGuard
===========================
Handles application theming with light/dark modes and accent colors.
Creates a modern, polished look that doesn't feel like default Qt.

Design Philosophy:
- Clean, modern aesthetic
- Consistent spacing and typography
- Smooth transitions where appropriate
- Respect system theme preference when set to 'system'
"""

from typing import Dict, Any
from PySide6.QtWidgets import QApplication, QStyleFactory
from PySide6.QtGui import QPalette, QColor, QFont
from PySide6.QtCore import QObject, Signal
import sys

from config.settings_manager import SettingsManager


# Color palettes for light and dark themes
LIGHT_PALETTE = {
    'background': '#ffffff',
    'background_alt': '#f8fafc',
    'surface': '#ffffff',
    'surface_hover': '#f8fafc',
    'surface_active': '#f1f5f9',
    'border': 'rgba(0, 0, 0, 0.08)',
    'border_light': 'rgba(0, 0, 0, 0.04)',
    'border_accent': 'rgba(99, 102, 241, 0.3)',
    'text_primary': '#0f172a',
    'text_secondary': '#475569',
    'text_muted': '#94a3b8',
    'text_inverse': '#ffffff',
    'accent': '#6366f1',               # Indigo - matching dark theme
    'accent_light': '#818cf8',
    'accent_dark': '#4f46e5',
    'accent_subtle': 'rgba(99, 102, 241, 0.08)',
    'success': '#10b981',
    'success_bg': 'rgba(16, 185, 129, 0.08)',
    'warning': '#f59e0b',
    'warning_bg': 'rgba(245, 158, 11, 0.08)',
    'error': '#ef4444',
    'error_bg': 'rgba(239, 68, 68, 0.08)',
    'info': '#6366f1',
    'info_bg': 'rgba(99, 102, 241, 0.08)',
}

DARK_PALETTE = {
    # Refined dark theme - security tool aesthetic
    'background': '#0c0c10',          # Deep dark base
    'background_alt': '#111116',       # Sidebar/alt areas
    'surface': '#18181f',              # Card/panel background
    'surface_hover': '#1f1f28',        # Hover state
    'surface_active': '#262630',       # Active/pressed state
    'border': 'rgba(255, 255, 255, 0.06)',  # Subtle borders
    'border_light': 'rgba(255, 255, 255, 0.03)',  # Very subtle
    'border_accent': 'rgba(99, 102, 241, 0.4)',   # Accent border
    'text_primary': '#f0f0f5',         # Slightly warm white
    'text_secondary': '#9090a0',       # Muted text
    'text_muted': '#505060',           # Very muted text
    'text_inverse': '#0c0c10',         # Dark text on light bg
    'accent': '#6366f1',               # Indigo - less saturated
    'accent_light': '#818cf8',         # Light accent
    'accent_dark': '#4f46e5',          # Dark accent
    'accent_subtle': 'rgba(99, 102, 241, 0.12)',  # Subtle accent bg
    'success': '#34d399',              # Emerald
    'success_bg': 'rgba(52, 211, 153, 0.12)',
    'warning': '#fbbf24',              # Amber
    'warning_bg': 'rgba(251, 191, 36, 0.12)',
    'error': '#f87171',                # Red
    'error_bg': 'rgba(248, 113, 113, 0.12)',
    'info': '#6366f1',                 # Match accent
    'info_bg': 'rgba(99, 102, 241, 0.12)',
}


def get_system_theme() -> str:
    """
    Detect the system's preferred color scheme.
    
    Returns 'dark' or 'light' based on system settings.
    """
    if sys.platform == 'win32':
        try:
            import winreg
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r'Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
            )
            value, _ = winreg.QueryValueEx(key, 'AppsUseLightTheme')
            return 'light' if value == 1 else 'dark'
        except Exception:
            return 'light'
    else:
        # Linux - check for common dark theme indicators
        try:
            import subprocess
            result = subprocess.run(
                ['gsettings', 'get', 'org.gnome.desktop.interface', 'color-scheme'],
                capture_output=True, text=True
            )
            if 'dark' in result.stdout.lower():
                return 'dark'
        except Exception:
            pass
        return 'light'


class ThemeManager(QObject):
    """
    Manages application theming and styling.
    
    Provides:
    - Light/Dark/System theme modes
    - Custom accent colors
    - Consistent styling across all widgets
    - Dynamic theme switching
    """
    
    theme_changed = Signal(str)  # Emits theme name when changed
    
    def __init__(self, settings: SettingsManager):
        super().__init__()
        self.settings = settings
        
        # Current effective theme (resolved from 'system' if needed)
        self._current_theme = 'light'
        self._accent_color = settings.get('appearance.accent_color', '#3b82f6')
        
        # Listen for settings changes
        settings.on_change(self._on_settings_change)
    
    def _on_settings_change(self, path: str, old_value: Any, new_value: Any) -> None:
        """Handle settings changes that affect theming."""
        if path == 'appearance.theme':
            self.apply_theme(QApplication.instance())
        elif path == 'appearance.accent_color':
            self._accent_color = new_value
            self.apply_theme(QApplication.instance())
    
    def get_effective_theme(self) -> str:
        """Get the current effective theme (resolved from 'system')."""
        theme_setting = self.settings.get('appearance.theme', 'system')
        
        if theme_setting == 'system':
            return get_system_theme()
        return theme_setting
    
    def get_palette(self) -> Dict[str, str]:
        """Get the color palette for the current theme."""
        theme = self.get_effective_theme()
        palette = DARK_PALETTE.copy() if theme == 'dark' else LIGHT_PALETTE.copy()
        
        # Override accent color
        palette['accent'] = self._accent_color
        palette['accent_hover'] = self._lighten_color(self._accent_color, 10)
        palette['accent_active'] = self._darken_color(self._accent_color, 10)
        
        return palette
    
    def _lighten_color(self, hex_color: str, percent: int) -> str:
        """Lighten a hex color by a percentage."""
        color = QColor(hex_color)
        h, s, l, a = color.getHslF()
        l = min(1.0, l + percent / 100.0)
        color.setHslF(h, s, l, a)
        return color.name()
    
    def _darken_color(self, hex_color: str, percent: int) -> str:
        """Darken a hex color by a percentage."""
        color = QColor(hex_color)
        h, s, l, a = color.getHslF()
        l = max(0.0, l - percent / 100.0)
        color.setHslF(h, s, l, a)
        return color.name()
    
    def apply_theme(self, app: QApplication) -> None:
        """
        Apply the current theme to the application.
        
        Sets up the QPalette and stylesheet for the entire app.
        """
        palette = self.get_palette()
        theme = self.get_effective_theme()
        self._current_theme = theme
        
        # Build and apply stylesheet
        stylesheet = self._build_stylesheet(palette)
        app.setStyleSheet(stylesheet)
        
        # Emit signal for any listeners
        self.theme_changed.emit(theme)
    
    def _build_stylesheet(self, p: Dict[str, str]) -> str:
        """
        Build the complete application stylesheet.
        
        This creates a modern, polished look while maintaining
        readability and usability.
        """
        animations = self.settings.get('appearance.animations_enabled', True)
        density = self.settings.get('appearance.ui_density', 'comfortable')
        
        # Spacing based on density
        spacing = {'compact': 6, 'comfortable': 10, 'spacious': 14}.get(density, 10)
        padding = {'compact': 4, 'comfortable': 8, 'spacious': 12}.get(density, 8)
        
        return f'''
        /* ============================================
           FileGuard Theme Stylesheet
           Theme: {self._current_theme}
           Premium polish with micro-interactions
           ============================================ */
        
        /* Global defaults */
        * {{
            font-family: "Segoe UI", "SF Pro Display", "Helvetica Neue", sans-serif;
            font-size: 13px;
            outline: none;
        }}
        
        QWidget {{
            background-color: {p['background']};
            color: {p['text_primary']};
        }}
        
        /* Main window */
        QMainWindow {{
            background-color: {p['background']};
        }}
        
        /* Content area with subtle left border */
        QFrame#content_area {{
            background-color: {p['background']};
            border-left: 1px solid {p['border']};
        }}
        
        /* Scroll areas */
        QScrollArea {{
            border: none;
            background-color: transparent;
        }}
        
        QScrollArea > QWidget > QWidget {{
            background-color: transparent;
        }}
        
        /* Scrollbars */
        QScrollBar:vertical {{
            background-color: {p['background']};
            width: 10px;
            margin: 0;
        }}
        
        QScrollBar::handle:vertical {{
            background-color: {p['border']};
            min-height: 30px;
            border-radius: 5px;
            margin: 2px;
        }}
        
        QScrollBar::handle:vertical:hover {{
            background-color: {p['text_muted']};
        }}
        
        QScrollBar::add-line:vertical,
        QScrollBar::sub-line:vertical {{
            height: 0;
        }}
        
        QScrollBar:horizontal {{
            background-color: {p['background']};
            height: 10px;
            margin: 0;
        }}
        
        QScrollBar::handle:horizontal {{
            background-color: {p['border']};
            min-width: 30px;
            border-radius: 5px;
            margin: 2px;
        }}
        
        QScrollBar::handle:horizontal:hover {{
            background-color: {p['text_muted']};
        }}
        
        QScrollBar::add-line:horizontal,
        QScrollBar::sub-line:horizontal {{
            width: 0;
        }}
        
        /* Buttons - with smooth transitions */
        QPushButton {{
            background-color: {p['surface']};
            color: {p['text_primary']};
            border: 1px solid {p['border']};
            border-radius: 8px;
            padding: {padding + 2}px {padding * 2 + 4}px;
            font-weight: 500;
            font-size: 13px;
        }}
        
        QPushButton:hover {{
            background-color: {p['surface_hover']};
            border-color: {p['text_muted']};
        }}
        
        QPushButton:pressed {{
            background-color: {p['surface_active']};
        }}
        
        QPushButton:disabled {{
            background-color: {p['surface']};
            color: {p['text_muted']};
            border-color: {p['border_light']};
        }}
        
        /* Primary buttons */
        QPushButton[class="primary"] {{
            background-color: {p['accent']};
            color: {p['text_inverse']};
            border: none;
        }}
        
        QPushButton[class="primary"]:hover {{
            background-color: {p['accent_hover']};
        }}
        
        QPushButton[class="primary"]:pressed {{
            background-color: {p['accent_active']};
        }}
        
        /* Danger buttons */
        QPushButton[class="danger"] {{
            background-color: {p['error']};
            color: white;
            border: none;
        }}
        
        QPushButton[class="danger"]:hover {{
            background-color: {self._darken_color(p['error'], 10)};
        }}
        
        /* Line edits */
        QLineEdit {{
            background-color: {p['surface']};
            color: {p['text_primary']};
            border: 1px solid {p['border']};
            border-radius: 6px;
            padding: {padding}px;
            selection-background-color: {p['accent']};
        }}
        
        QLineEdit:focus {{
            border-color: {p['accent']};
        }}
        
        QLineEdit:disabled {{
            background-color: {p['background_alt']};
            color: {p['text_muted']};
        }}
        
        /* Combo boxes */
        QComboBox {{
            background-color: {p['surface']};
            color: {p['text_primary']};
            border: 1px solid {p['border']};
            border-radius: 6px;
            padding: {padding}px;
            padding-right: 30px;
        }}
        
        QComboBox:hover {{
            border-color: {p['text_muted']};
        }}
        
        QComboBox:focus {{
            border-color: {p['accent']};
        }}
        
        QComboBox::drop-down {{
            border: none;
            width: 24px;
        }}
        
        QComboBox::down-arrow {{
            image: none;
            border-left: 5px solid transparent;
            border-right: 5px solid transparent;
            border-top: 5px solid {p['text_secondary']};
            margin-right: 8px;
        }}
        
        QComboBox QAbstractItemView {{
            background-color: {p['surface']};
            color: {p['text_primary']};
            border: 1px solid {p['border']};
            border-radius: 6px;
            selection-background-color: {p['accent']};
            selection-color: {p['text_inverse']};
            padding: 4px;
        }}
        
        /* Check boxes */
        QCheckBox {{
            color: {p['text_primary']};
            spacing: {spacing}px;
        }}
        
        QCheckBox::indicator {{
            width: 18px;
            height: 18px;
            border: 2px solid {p['border']};
            border-radius: 4px;
            background-color: {p['surface']};
        }}
        
        QCheckBox::indicator:hover {{
            border-color: {p['accent']};
        }}
        
        QCheckBox::indicator:checked {{
            background-color: {p['accent']};
            border-color: {p['accent']};
        }}
        
        /* Radio buttons */
        QRadioButton {{
            color: {p['text_primary']};
            spacing: {spacing}px;
        }}
        
        QRadioButton::indicator {{
            width: 18px;
            height: 18px;
            border: 2px solid {p['border']};
            border-radius: 9px;
            background-color: {p['surface']};
        }}
        
        QRadioButton::indicator:hover {{
            border-color: {p['accent']};
        }}
        
        QRadioButton::indicator:checked {{
            background-color: {p['accent']};
            border-color: {p['accent']};
        }}
        
        /* Spin boxes */
        QSpinBox, QDoubleSpinBox {{
            background-color: {p['surface']};
            color: {p['text_primary']};
            border: 1px solid {p['border']};
            border-radius: 6px;
            padding: {padding}px;
        }}
        
        QSpinBox:focus, QDoubleSpinBox:focus {{
            border-color: {p['accent']};
        }}
        
        /* Sliders */
        QSlider::groove:horizontal {{
            background-color: {p['border']};
            height: 6px;
            border-radius: 3px;
        }}
        
        QSlider::handle:horizontal {{
            background-color: {p['accent']};
            width: 16px;
            height: 16px;
            margin: -5px 0;
            border-radius: 8px;
        }}
        
        QSlider::handle:horizontal:hover {{
            background-color: {p['accent_hover']};
        }}
        
        /* Progress bars */
        QProgressBar {{
            background-color: {p['border']};
            border: none;
            border-radius: 4px;
            height: 8px;
            text-align: center;
        }}
        
        QProgressBar::chunk {{
            background-color: {p['accent']};
            border-radius: 4px;
        }}
        
        /* Tab widget */
        QTabWidget::pane {{
            border: 1px solid {p['border']};
            border-radius: 6px;
            background-color: {p['surface']};
        }}
        
        QTabBar::tab {{
            background-color: transparent;
            color: {p['text_secondary']};
            padding: {padding}px {padding * 2}px;
            border-bottom: 2px solid transparent;
        }}
        
        QTabBar::tab:selected {{
            color: {p['accent']};
            border-bottom-color: {p['accent']};
        }}
        
        QTabBar::tab:hover:!selected {{
            color: {p['text_primary']};
        }}
        
        /* Lists and trees */
        QListWidget, QTreeWidget, QTableWidget {{
            background-color: {p['surface']};
            color: {p['text_primary']};
            border: 1px solid {p['border']};
            border-radius: 6px;
            outline: none;
        }}
        
        QListWidget::item, QTreeWidget::item {{
            padding: {padding}px;
            border-radius: 4px;
        }}
        
        QListWidget::item:selected, QTreeWidget::item:selected {{
            background-color: {p['accent']};
            color: {p['text_inverse']};
        }}
        
        QListWidget::item:hover:!selected, QTreeWidget::item:hover:!selected {{
            background-color: {p['surface_hover']};
        }}
        
        /* Headers */
        QHeaderView::section {{
            background-color: {p['background_alt']};
            color: {p['text_secondary']};
            padding: {padding}px;
            border: none;
            border-bottom: 1px solid {p['border']};
            font-weight: 600;
        }}
        
        /* Group boxes */
        QGroupBox {{
            color: {p['text_primary']};
            font-weight: 600;
            border: 1px solid {p['border']};
            border-radius: 8px;
            margin-top: 12px;
            padding-top: 12px;
        }}
        
        QGroupBox::title {{
            subcontrol-origin: margin;
            subcontrol-position: top left;
            left: 12px;
            padding: 0 8px;
            background-color: {p['background']};
        }}
        
        /* Labels - Typography hierarchy */
        QLabel {{
            color: {p['text_primary']};
            background-color: transparent;
            line-height: 1.5;
        }}
        
        QLabel[class="title"] {{
            font-size: 20px;
            font-weight: 600;
            letter-spacing: -0.3px;
        }}
        
        QLabel[class="subtitle"] {{
            font-size: 14px;
            font-weight: 500;
            color: {p['text_secondary']};
        }}
        
        QLabel[class="section-title"] {{
            font-size: 15px;
            font-weight: 500;
            color: {p['text_primary']};
        }}
        
        QLabel[class="body"] {{
            font-size: 13px;
            font-weight: 400;
            color: {p['text_secondary']};
            line-height: 1.6;
        }}
        
        QLabel[class="muted"] {{
            color: {p['text_muted']};
            font-size: 12px;
        }}
        
        QLabel[class="meta"] {{
            color: {p['text_muted']};
            font-size: 11px;
        }}
        
        /* Cards - Premium feel with hover states */
        QFrame[class="card"] {{
            background-color: {p['surface']};
            border: 1px solid {p['border']};
            border-radius: 12px;
        }}
        
        QFrame[class="card"]:hover {{
            background-color: {p['surface_hover']};
            border-color: {p.get('border_light', p['border'])};
        }}
        
        QFrame[class="card-elevated"] {{
            background-color: {p['surface']};
            border: 1px solid {p['border']};
            border-radius: 14px;
        }}
        
        QFrame[class="card-static"] {{
            background-color: {p['surface']};
            border: 1px solid {p['border']};
            border-radius: 12px;
        }}
        
        QFrame[class="divider"] {{
            background-color: {p['border']};
            max-height: 1px;
        }}
        
        /* Tool tips */
        QToolTip {{
            background-color: {p['surface']};
            color: {p['text_primary']};
            border: 1px solid {p['border']};
            border-radius: 4px;
            padding: 6px 10px;
        }}
        
        /* Menus */
        QMenu {{
            background-color: {p['surface']};
            color: {p['text_primary']};
            border: 1px solid {p['border']};
            border-radius: 8px;
            padding: 4px;
        }}
        
        QMenu::item {{
            padding: 8px 24px;
            border-radius: 4px;
        }}
        
        QMenu::item:selected {{
            background-color: {p['accent']};
            color: {p['text_inverse']};
        }}
        
        QMenu::separator {{
            height: 1px;
            background-color: {p['border']};
            margin: 4px 8px;
        }}
        
        /* Text edit / Plain text edit */
        QTextEdit, QPlainTextEdit {{
            background-color: {p['surface']};
            color: {p['text_primary']};
            border: 1px solid {p['border']};
            border-radius: 6px;
            padding: {padding}px;
            selection-background-color: {p['accent']};
        }}
        
        QTextEdit:focus, QPlainTextEdit:focus {{
            border-color: {p['accent']};
        }}
        
        /* Dialog */
        QDialog {{
            background-color: {p['background']};
        }}
        
        /* Message box */
        QMessageBox {{
            background-color: {p['background']};
        }}
        
        /* Status indicators */
        QLabel[class="status-safe"] {{
            color: {p['success']};
        }}
        
        QLabel[class="status-warning"] {{
            color: {p['warning']};
        }}
        
        QLabel[class="status-danger"] {{
            color: {p['error']};
        }}
        '''
    
    @property
    def colors(self) -> Dict[str, str]:
        """Get current color palette."""
        return self.get_palette()
    
    @property
    def is_dark(self) -> bool:
        """Check if current theme is dark."""
        return self._current_theme == 'dark'
