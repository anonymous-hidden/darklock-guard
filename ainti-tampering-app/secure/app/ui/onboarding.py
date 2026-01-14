"""
Onboarding Dialog for FileGuard
===============================
First-run setup wizard to guide new users.

Design Philosophy:
- Clear, friendly introduction
- Step-by-step guidance
- Optional: skip for experienced users
"""

from pathlib import Path
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QFrame, QStackedWidget, QFileDialog
)
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QFont

from config.settings_manager import SettingsManager
from service import ProtectionService
from ui.theme import ThemeManager


class OnboardingPage(QFrame):
    """
    A single page in the onboarding flow.
    """
    
    def __init__(
        self,
        icon: str,
        title: str,
        description: str,
        parent=None
    ):
        super().__init__(parent)
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(40, 40, 40, 40)
        layout.setSpacing(24)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        # Icon
        icon_label = QLabel(icon)
        icon_label.setFont(QFont("Segoe UI Emoji", 64))
        icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(icon_label)
        
        # Title
        title_label = QLabel(title)
        title_label.setFont(QFont("Segoe UI", 24, QFont.Weight.Bold))
        title_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title_label.setWordWrap(True)
        layout.addWidget(title_label)
        
        # Description
        desc_label = QLabel(description)
        desc_label.setFont(QFont("Segoe UI", 12))
        desc_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        desc_label.setWordWrap(True)
        desc_label.setProperty("class", "muted")
        layout.addWidget(desc_label)
        
        # Content area for additional widgets
        self.content_layout = QVBoxLayout()
        self.content_layout.setSpacing(16)
        layout.addLayout(self.content_layout)
        
        layout.addStretch()


class OnboardingDialog(QDialog):
    """
    First-run onboarding wizard dialog.
    """
    
    completed = Signal()
    
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
        
        self._current_page = 0
        self._first_file = None
        
        self.setWindowTitle("Welcome to FileGuard")
        self.setFixedSize(600, 500)
        self.setModal(True)
        
        self._setup_ui()
    
    def _setup_ui(self):
        """Set up the onboarding UI."""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        
        # Pages stack
        self.pages = QStackedWidget()
        
        # Page 1: Welcome
        welcome = OnboardingPage(
            "🛡️",
            "Welcome to FileGuard",
            "Your personal file protection system.\n"
            "Keep your important files safe from tampering, ransomware, and accidents."
        )
        self.pages.addWidget(welcome)
        
        # Page 2: How it works
        how_it_works = OnboardingPage(
            "🔒",
            "How FileGuard Works",
            "FileGuard monitors your protected files and can:\n\n"
            "• Detect any changes instantly\n"
            "• Alert you to tampering\n"
            "• Automatically restore files to their original state\n"
            "• Seal files to prevent any modifications"
        )
        self.pages.addWidget(how_it_works)
        
        # Page 3: Privacy
        privacy = OnboardingPage(
            "🏠",
            "100% Local & Private",
            "FileGuard works entirely on your computer.\n\n"
            "• No cloud services\n"
            "• No account required\n"
            "• No data leaves your machine\n"
            "• No telemetry or tracking\n\n"
            "Your files, your control."
        )
        self.pages.addWidget(privacy)
        
        # Page 4: First file
        first_file = OnboardingPage(
            "📁",
            "Protect Your First File",
            "Let's get started! Choose a file you want to protect."
        )
        
        choose_btn = QPushButton("Choose a File to Protect")
        choose_btn.setProperty("class", "primary")
        choose_btn.setFixedHeight(44)
        choose_btn.clicked.connect(self._choose_file)
        first_file.content_layout.addWidget(choose_btn)
        
        self.file_label = QLabel("")
        self.file_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.file_label.setProperty("class", "muted")
        first_file.content_layout.addWidget(self.file_label)
        
        skip_label = QLabel("or skip this step")
        skip_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        skip_label.setProperty("class", "muted")
        skip_label.setFont(QFont("Segoe UI", 10))
        first_file.content_layout.addWidget(skip_label)
        
        self.pages.addWidget(first_file)
        
        # Page 5: Ready
        ready = OnboardingPage(
            "✨",
            "You're All Set!",
            "FileGuard is ready to protect your files.\n\n"
            "Click 'Get Started' to begin using FileGuard.\n"
            "You can protect more files from the dashboard."
        )
        self.pages.addWidget(ready)
        
        layout.addWidget(self.pages, 1)
        
        # Navigation bar
        nav_frame = QFrame()
        nav_frame.setStyleSheet("background-color: rgba(0,0,0,0.05);")
        nav_layout = QHBoxLayout(nav_frame)
        nav_layout.setContentsMargins(24, 16, 24, 16)
        
        # Page indicators
        self.indicators = []
        indicators_layout = QHBoxLayout()
        indicators_layout.setSpacing(8)
        
        for i in range(5):
            indicator = QFrame()
            indicator.setFixedSize(8, 8)
            indicator.setStyleSheet("""
                QFrame {
                    background-color: #d1d5db;
                    border-radius: 4px;
                }
            """)
            self.indicators.append(indicator)
            indicators_layout.addWidget(indicator)
        
        self.indicators[0].setStyleSheet("""
            QFrame {
                background-color: #3b82f6;
                border-radius: 4px;
            }
        """)
        
        nav_layout.addLayout(indicators_layout)
        nav_layout.addStretch()
        
        # Skip button
        self.skip_btn = QPushButton("Skip")
        self.skip_btn.clicked.connect(self._skip)
        nav_layout.addWidget(self.skip_btn)
        
        # Back button
        self.back_btn = QPushButton("Back")
        self.back_btn.clicked.connect(self._prev_page)
        self.back_btn.setEnabled(False)
        nav_layout.addWidget(self.back_btn)
        
        # Next button
        self.next_btn = QPushButton("Next")
        self.next_btn.setProperty("class", "primary")
        self.next_btn.clicked.connect(self._next_page)
        nav_layout.addWidget(self.next_btn)
        
        layout.addWidget(nav_frame)
    
    def _update_indicators(self):
        """Update page indicators."""
        for i, indicator in enumerate(self.indicators):
            if i == self._current_page:
                indicator.setStyleSheet("""
                    QFrame {
                        background-color: #3b82f6;
                        border-radius: 4px;
                    }
                """)
            else:
                indicator.setStyleSheet("""
                    QFrame {
                        background-color: #d1d5db;
                        border-radius: 4px;
                    }
                """)
    
    def _next_page(self):
        """Go to next page."""
        if self._current_page < self.pages.count() - 1:
            self._current_page += 1
            self.pages.setCurrentIndex(self._current_page)
            self._update_indicators()
            
            self.back_btn.setEnabled(True)
            
            if self._current_page == self.pages.count() - 1:
                self.next_btn.setText("Get Started")
                self.skip_btn.hide()
            else:
                self.next_btn.setText("Next")
                self.skip_btn.show()
        else:
            self._finish()
    
    def _prev_page(self):
        """Go to previous page."""
        if self._current_page > 0:
            self._current_page -= 1
            self.pages.setCurrentIndex(self._current_page)
            self._update_indicators()
            
            if self._current_page == 0:
                self.back_btn.setEnabled(False)
            
            self.next_btn.setText("Next")
            self.skip_btn.show()
    
    def _skip(self):
        """Skip onboarding."""
        self._finish()
    
    def _finish(self):
        """Complete onboarding."""
        # Mark onboarding as complete
        self.settings.set('profile.onboarding_completed', True)
        
        # Protect the first file if selected
        if self._first_file:
            self.service.protect_file(
                self._first_file,
                mode=self.service.settings.security.default_protection_mode
            )
        
        self.completed.emit()
        self.accept()
    
    def _choose_file(self):
        """Choose a file to protect."""
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Choose a File to Protect",
            "",
            "All Files (*)"
        )
        
        if file_path:
            self._first_file = Path(file_path)
            self.file_label.setText(f"✓ {self._first_file.name}")
            self.file_label.setStyleSheet("color: #22c55e;")


def should_show_onboarding(settings: SettingsManager) -> bool:
    """
    Check if onboarding should be shown.
    """
    return not settings.get('profile.onboarding_completed', False)
