"""
Protection Status View for FileGuard
====================================
Shows detailed verification status and allows manual verification runs.

Design Philosophy:
- Clear verification results
- Easy access to run verification
- Detailed integrity check information
"""

from datetime import datetime
from pathlib import Path
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QFrame, QScrollArea, QProgressBar
)
from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QFont

from config.settings_manager import SettingsManager
from service import ProtectionService, ProtectionStatus
from ui.theme import ThemeManager


class VerificationResultItem(QFrame):
    """
    A single verification result item.
    """
    
    def __init__(self, path: str, status: str, theme: ThemeManager, parent=None):
        super().__init__(parent)
        self.theme = theme
        
        layout = QHBoxLayout(self)
        layout.setContentsMargins(16, 12, 16, 12)
        layout.setSpacing(12)
        
        # Status icon
        icons = {
            'unchanged': '✅',
            'modified': '🚨',
            'missing': '❌',
            'error': '⚠️',
        }
        
        icon = icons.get(status, '•')
        icon_label = QLabel(icon)
        icon_label.setFont(QFont("Segoe UI Emoji", 16))
        layout.addWidget(icon_label)
        
        # File info
        file_path = Path(path)
        name_label = QLabel(file_path.name)
        name_label.setFont(QFont("Segoe UI", 11))
        layout.addWidget(name_label, 1)
        
        # Status text
        status_colors = {
            'unchanged': '#22c55e',
            'modified': '#ef4444',
            'missing': '#ef4444',
            'error': '#f59e0b',
        }
        
        status_label = QLabel(status.title())
        status_label.setFont(QFont("Segoe UI", 10, QFont.Weight.DemiBold))
        status_label.setStyleSheet(f"color: {status_colors.get(status, '#6b7280')};")
        layout.addWidget(status_label)


class StatusView(QWidget):
    """
    Protection status view with verification capabilities.
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
        
        self._is_verifying = False
        
        self._setup_ui()
        self.refresh()
    
    def _setup_ui(self):
        """Set up the view UI."""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(32, 32, 32, 32)
        layout.setSpacing(24)
        
        # Header
        header = QHBoxLayout()
        
        title = QLabel("Protection Status")
        title.setProperty("class", "title")
        title.setFont(QFont("Segoe UI", 24, QFont.Weight.Bold))
        header.addWidget(title)
        
        header.addStretch()
        
        # Verify button
        self.verify_btn = QPushButton("🔍 Verify All Now")
        self.verify_btn.setProperty("class", "primary")
        self.verify_btn.setFixedHeight(40)
        self.verify_btn.clicked.connect(self._on_verify)
        header.addWidget(self.verify_btn)
        
        layout.addLayout(header)
        
        # Status cards row
        cards_layout = QHBoxLayout()
        cards_layout.setSpacing(16)
        
        # Overall status card
        self.status_card = QFrame()
        self.status_card.setProperty("class", "card")
        self.status_card.setMinimumHeight(120)
        status_layout = QVBoxLayout(self.status_card)
        status_layout.setContentsMargins(20, 20, 20, 20)
        
        self.status_icon = QLabel("🛡️")
        self.status_icon.setFont(QFont("Segoe UI Emoji", 32))
        status_layout.addWidget(self.status_icon, alignment=Qt.AlignmentFlag.AlignCenter)
        
        self.status_text = QLabel("Protected")
        self.status_text.setFont(QFont("Segoe UI", 14, QFont.Weight.Bold))
        self.status_text.setAlignment(Qt.AlignmentFlag.AlignCenter)
        status_layout.addWidget(self.status_text)
        
        cards_layout.addWidget(self.status_card)
        
        # Last verification card
        self.last_check_card = QFrame()
        self.last_check_card.setProperty("class", "card")
        self.last_check_card.setMinimumHeight(120)
        last_check_layout = QVBoxLayout(self.last_check_card)
        last_check_layout.setContentsMargins(20, 20, 20, 20)
        
        last_check_title = QLabel("Last Verification")
        last_check_title.setProperty("class", "muted")
        last_check_title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        last_check_layout.addWidget(last_check_title)
        
        self.last_check_time = QLabel("Never")
        self.last_check_time.setFont(QFont("Segoe UI", 18, QFont.Weight.Bold))
        self.last_check_time.setAlignment(Qt.AlignmentFlag.AlignCenter)
        last_check_layout.addWidget(self.last_check_time)
        
        self.last_check_date = QLabel("")
        self.last_check_date.setProperty("class", "muted")
        self.last_check_date.setAlignment(Qt.AlignmentFlag.AlignCenter)
        last_check_layout.addWidget(self.last_check_date)
        
        cards_layout.addWidget(self.last_check_card)
        
        # Files checked card
        self.files_card = QFrame()
        self.files_card.setProperty("class", "card")
        self.files_card.setMinimumHeight(120)
        files_layout = QVBoxLayout(self.files_card)
        files_layout.setContentsMargins(20, 20, 20, 20)
        
        files_title = QLabel("Protected Items")
        files_title.setProperty("class", "muted")
        files_title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        files_layout.addWidget(files_title)
        
        self.files_count = QLabel("0")
        self.files_count.setFont(QFont("Segoe UI", 24, QFont.Weight.Bold))
        self.files_count.setAlignment(Qt.AlignmentFlag.AlignCenter)
        files_layout.addWidget(self.files_count)
        
        cards_layout.addWidget(self.files_card)
        
        layout.addLayout(cards_layout)
        
        # Verification progress (hidden by default)
        self.progress_frame = QFrame()
        self.progress_frame.setProperty("class", "card")
        progress_layout = QVBoxLayout(self.progress_frame)
        progress_layout.setContentsMargins(20, 16, 20, 16)
        
        progress_header = QHBoxLayout()
        progress_label = QLabel("Verifying files...")
        progress_label.setFont(QFont("Segoe UI", 12, QFont.Weight.DemiBold))
        progress_header.addWidget(progress_label)
        progress_header.addStretch()
        self.progress_percent = QLabel("0%")
        self.progress_percent.setProperty("class", "muted")
        progress_header.addWidget(self.progress_percent)
        progress_layout.addLayout(progress_header)
        
        self.progress_bar = QProgressBar()
        self.progress_bar.setFixedHeight(8)
        self.progress_bar.setTextVisible(False)
        progress_layout.addWidget(self.progress_bar)
        
        layout.addWidget(self.progress_frame)
        self.progress_frame.hide()
        
        # Results section
        results_header = QHBoxLayout()
        results_label = QLabel("Verification Results")
        results_label.setFont(QFont("Segoe UI", 14, QFont.Weight.DemiBold))
        results_header.addWidget(results_label)
        results_header.addStretch()
        layout.addLayout(results_header)
        
        # Results list
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        
        self.results_container = QWidget()
        self.results_layout = QVBoxLayout(self.results_container)
        self.results_layout.setContentsMargins(0, 0, 0, 0)
        self.results_layout.setSpacing(8)
        self.results_layout.addStretch()
        
        scroll.setWidget(self.results_container)
        layout.addWidget(scroll, 1)
        
        # Empty state
        self.empty_state = QLabel("Run verification to check file integrity")
        self.empty_state.setProperty("class", "muted")
        self.empty_state.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.empty_state.setFont(QFont("Segoe UI", 14))
        self.results_layout.insertWidget(0, self.empty_state)
        
        # Settings info
        settings_layout = QHBoxLayout()
        settings_info = QLabel(
            f"📅 Automatic verification runs every "
            f"{self.settings.get('monitoring.scan_interval_seconds', 300) // 60} minutes"
        )
        settings_info.setProperty("class", "muted")
        settings_layout.addWidget(settings_info)
        settings_layout.addStretch()
        layout.addLayout(settings_layout)
    
    def refresh(self):
        """Refresh the status display."""
        status = self.service.get_status()
        self.update_status(status)
    
    def update_status(self, status: ProtectionStatus):
        """Update the status displays."""
        # Overall status
        if status.overall_status == 'safe':
            self.status_icon.setText("✅")
            self.status_text.setText("All Protected")
            self.status_text.setStyleSheet("color: #22c55e;")
        elif status.overall_status == 'warning':
            self.status_icon.setText("⚠️")
            self.status_text.setText("Attention Needed")
            self.status_text.setStyleSheet("color: #f59e0b;")
        elif status.overall_status == 'tampered':
            self.status_icon.setText("🚨")
            self.status_text.setText("Tampering Detected")
            self.status_text.setStyleSheet("color: #ef4444;")
        
        # Last verification
        if status.last_verification:
            self.last_check_time.setText(status.last_verification.strftime("%H:%M"))
            self.last_check_date.setText(status.last_verification.strftime("%b %d, %Y"))
        else:
            self.last_check_time.setText("Never")
            self.last_check_date.setText("")
        
        # Files count
        self.files_count.setText(str(status.protected_count))
    
    def _on_verify(self):
        """Handle verify button click."""
        if self._is_verifying:
            return
        
        self._is_verifying = True
        self.verify_btn.setEnabled(False)
        self.verify_btn.setText("Verifying...")
        
        # Show progress
        self.progress_frame.show()
        self.progress_bar.setValue(0)
        self.progress_percent.setText("0%")
        
        # Clear previous results
        for i in reversed(range(self.results_layout.count() - 1)):
            item = self.results_layout.itemAt(i)
            if item.widget() and item.widget() != self.empty_state:
                item.widget().deleteLater()
        
        self.empty_state.hide()
        
        # Run verification
        results = self.service.verify_all()
        
        # Simulate progress animation
        progress = 0
        total = len(results) if results else 1
        
        def update_progress():
            nonlocal progress
            progress += 1
            percent = min(100, int((progress / total) * 100))
            self.progress_bar.setValue(percent)
            self.progress_percent.setText(f"{percent}%")
            
            if progress >= total:
                self._show_results(results)
        
        # Use timer to show progress
        timer = QTimer(self)
        timer.timeout.connect(update_progress)
        timer.start(50)
        
        # Stop after completion
        QTimer.singleShot(50 * total + 100, lambda: self._finish_verification(timer))
    
    def _finish_verification(self, timer: QTimer):
        """Finish verification process."""
        timer.stop()
        self._is_verifying = False
        self.verify_btn.setEnabled(True)
        self.verify_btn.setText("🔍 Verify All Now")
        self.progress_frame.hide()
        self.refresh()
    
    def _show_results(self, results: dict):
        """Display verification results."""
        if not results:
            self.empty_state.show()
            return
        
        # Sort results - issues first
        sorted_results = sorted(
            results.items(),
            key=lambda x: (x[1] == 'unchanged', x[0])
        )
        
        for path, status in sorted_results:
            item = VerificationResultItem(path, status, self.theme)
            self.results_layout.insertWidget(self.results_layout.count() - 1, item)
