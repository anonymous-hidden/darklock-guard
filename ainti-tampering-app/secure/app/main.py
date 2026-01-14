"""
FileGuard - File & Folder Tamper Protection
===========================================
Main entry point for the application.

"If this file changes, I will know — and I can undo it."

A local-only, privacy-focused file protection application that:
- Monitors files you choose to protect
- Detects unauthorized changes
- Can automatically restore from encrypted backups
- Maintains a signed audit log of all events

Design Philosophy:
- Deterministic over heuristic
- Quiet over noisy  
- Transparent over hidden
- User-controlled over automated chaos
- Trust through visibility
"""

import sys
import os
from pathlib import Path

# Add app directory to path for imports
APP_DIR = Path(__file__).parent
sys.path.insert(0, str(APP_DIR))

from PySide6.QtWidgets import QApplication
from PySide6.QtCore import Qt, QCoreApplication
from PySide6.QtGui import QFont, QFontDatabase

from config.settings_manager import SettingsManager
from service import ProtectionService
from ui.main_window import MainWindow
from ui.theme import ThemeManager


def get_app_data_dir() -> Path:
    """
    Get the application data directory.
    
    Windows: %LOCALAPPDATA%/FileGuard
    Linux: ~/.local/share/fileguard
    """
    if sys.platform == 'win32':
        base = Path(os.environ.get('LOCALAPPDATA', Path.home() / 'AppData' / 'Local'))
    else:
        base = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local' / 'share'))
    
    app_dir = base / 'FileGuard'
    app_dir.mkdir(parents=True, exist_ok=True)
    return app_dir


def setup_application() -> QApplication:
    """
    Set up the Qt application with proper configuration.
    """
    # High DPI support
    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )
    
    # Create application
    app = QApplication(sys.argv)
    app.setApplicationName("FileGuard")
    app.setApplicationDisplayName("FileGuard")
    app.setOrganizationName("FileGuard")
    app.setOrganizationDomain("fileguard.local")
    
    # Set application style
    app.setStyle("Fusion")
    
    return app


def main():
    """Main entry point."""
    # Create Qt application
    app = setup_application()
    
    # Get data directories
    app_data_dir = get_app_data_dir()
    config_dir = app_data_dir / 'config'
    config_dir.mkdir(exist_ok=True)
    
    # Initialize settings
    settings_path = config_dir / 'settings.json'
    settings = SettingsManager(settings_path)
    
    # Initialize theme manager
    theme_manager = ThemeManager(settings)
    theme_manager.apply_theme(app)
    
    # Initialize protection service
    service = ProtectionService(app_data_dir, settings)
    
    # Create and show main window
    window = MainWindow(service, settings, theme_manager)
    
    # Apply saved window geometry
    win_settings = settings.window
    if win_settings.x is not None and win_settings.y is not None:
        window.move(win_settings.x, win_settings.y)
    window.resize(win_settings.width, win_settings.height)
    
    if win_settings.maximized:
        window.showMaximized()
    else:
        window.show()
    
    # Start protection service
    service.start()
    
    # Check for first run - show onboarding
    if settings.is_first_run:
        window.show_onboarding()
    
    # Run application
    exit_code = app.exec()
    
    # Cleanup
    service.stop()
    
    # Save window geometry
    if not window.isMaximized():
        geo = window.geometry()
        settings.set('window.x', geo.x())
        settings.set('window.y', geo.y())
        settings.set('window.width', geo.width())
        settings.set('window.height', geo.height())
    settings.set('window.maximized', window.isMaximized())
    
    sys.exit(exit_code)


if __name__ == '__main__':
    main()
